// server.js — The Co-Founder relay + static host. Node 18+ (uses built-in fetch). No dependencies.
//
// What it does:
//  - serves the app in /public
//  - POST /api/chat: forwards the conversation to the Claude API (keeping your API key secret),
//    streams the reply back, and — if the founder consented — logs the conversation for later learning.
//  - POST /api/feedback: records a thumbs up/down on a reply (great signal for improving the product).
//
// Data choice (set by Adil): capture all conversations WITH a consent notice.
// Conversations are logged only when the request includes consent=true (the app shows a consent
// screen first). Logs go to ./data/conversations.jsonl, feedback to ./data/feedback.jsonl by default.
// To use a real database later, replace the bodies of logConversation() and logFeedback().

const http = require("http");
const fs = require("fs");
const path = require("path");
const { SYSTEM_PROMPT } = require("./knowledge");

// ---- tiny .env loader (so you don't need any packages) ----
(function loadEnv() {
  try {
    const envPath = path.join(__dirname, ".env");
    if (!fs.existsSync(envPath)) return;
    for (const line of fs.readFileSync(envPath, "utf8").split("\n")) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i);
      if (m && !process.env[m[1]]) {
        let v = m[2].trim();
        if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
        process.env[m[1]] = v;
      }
    }
  } catch (e) { /* ignore */ }
})();

const PORT = process.env.PORT || 3000;
const API_KEY = process.env.ANTHROPIC_API_KEY;
const MODEL = process.env.MODEL || "claude-sonnet-4-6";
const API_URL = (process.env.ANTHROPIC_BASE_URL || "https://api.anthropic.com").replace(/\/+$/, "") + "/v1/messages";
const MAX_TOKENS = parseInt(process.env.MAX_TOKENS || "900", 10);
const MAX_TURNS = parseInt(process.env.MAX_HISTORY_TURNS || "24", 10); // cap history sent, to control cost
const ACCESS_CODE = process.env.ACCESS_CODE || ""; // optional shared passcode; if set, /api/chat requires it
const RATE_MAX = parseInt(process.env.RATE_MAX || "40", 10); // max chat requests per IP per window
const RATE_WINDOW_MS = parseInt(process.env.RATE_WINDOW_MS || "600000", 10); // window length (default 10 min)
const DATA_DIR = path.join(__dirname, "data");
const PUBLIC_DIR = path.join(__dirname, "public");

// ---- simple in-memory per-IP rate limiter (resets on restart; per instance) ----
const hits = new Map(); // ip -> [timestamps]
function clientIp(req) {
  const xff = (req.headers["x-forwarded-for"] || "").split(",")[0].trim();
  return xff || (req.socket && req.socket.remoteAddress) || "unknown";
}
function rateLimited(req) {
  const ip = clientIp(req);
  const now = Date.now();
  const arr = (hits.get(ip) || []).filter((t) => now - t < RATE_WINDOW_MS);
  arr.push(now);
  hits.set(ip, arr);
  if (hits.size > 5000) { for (const k of hits.keys()) { if (hits.size <= 5000) break; hits.delete(k); } } // bound memory
  return arr.length > RATE_MAX;
}

if (!API_KEY) {
  console.warn("\n[warning] ANTHROPIC_API_KEY is not set. Copy .env.example to .env and add your key.\n");
}

// ---- logging (swap these bodies for a database later) ----
function logConversation(record) {
  try {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.appendFileSync(path.join(DATA_DIR, "conversations.jsonl"), JSON.stringify(record) + "\n");
  } catch (e) {
    console.error("[log] failed to write conversation:", e.message);
  }
}

function logFeedback(record) {
  try {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.appendFileSync(path.join(DATA_DIR, "feedback.jsonl"), JSON.stringify(record) + "\n");
  } catch (e) {
    console.error("[log] failed to write feedback:", e.message);
  }
}

// ---- static file serving ----
const MIME = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".svg": "image/svg+xml", ".ico": "image/x-icon", ".json": "application/json" };
function serveStatic(req, res) {
  let rel = decodeURIComponent(req.url.split("?")[0]);
  if (rel === "/") rel = "/index.html";
  const filePath = path.join(PUBLIC_DIR, path.normalize(rel));
  if (!filePath.startsWith(PUBLIC_DIR)) { res.writeHead(403); return res.end("forbidden"); }
  fs.readFile(filePath, (err, data) => {
    if (err) { res.writeHead(404); return res.end("not found"); }
    res.writeHead(200, { "Content-Type": MIME[path.extname(filePath)] || "application/octet-stream" });
    res.end(data);
  });
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (c) => { body += c; if (body.length > 2000000) req.destroy(); });
    req.on("end", () => resolve(body));
    req.on("error", reject);
  });
}

// ---- the chat relay ----
async function handleChat(req, res) {
  if (!API_KEY) { res.writeHead(500, { "Content-Type": "application/json" }); return res.end(JSON.stringify({ error: "Server is missing ANTHROPIC_API_KEY." })); }
  if (rateLimited(req)) { res.writeHead(429, { "Content-Type": "application/json" }); return res.end(JSON.stringify({ error: "You're going a bit fast — give it a minute and try again." })); }
  let payload;
  try { payload = JSON.parse(await readBody(req)); } catch { res.writeHead(400); return res.end("bad json"); }

  // optional shared passcode: only enforced if ACCESS_CODE is set on the server
  if (ACCESS_CODE) {
    const supplied = (req.headers["x-access-code"] || payload.code || "").toString();
    if (supplied !== ACCESS_CODE) { res.writeHead(401, { "Content-Type": "application/json" }); return res.end(JSON.stringify({ error: "An access code is needed to use this.", needCode: true })); }
  }

  const incoming = Array.isArray(payload.messages) ? payload.messages : [];
  const messages = incoming
    .filter((m) => m && (m.role === "user" || m.role === "assistant") && typeof m.content === "string" && m.content.trim())
    .map((m) => ({ role: m.role, content: m.content.slice(0, 8000) }))
    .slice(-MAX_TURNS);
  if (!messages.length) { res.writeHead(400); return res.end("no messages"); }

  let upstream;
  try {
    upstream = await fetch(API_URL, {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": API_KEY, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({ model: MODEL, max_tokens: MAX_TOKENS, system: SYSTEM_PROMPT, messages, stream: true }),
    });
  } catch (e) {
    res.writeHead(502, { "Content-Type": "application/json" });
    return res.end(JSON.stringify({ error: "Could not reach the model service." }));
  }

  if (!upstream.ok || !upstream.body) {
    const errText = await upstream.text().catch(() => "");
    res.writeHead(upstream.status || 502, { "Content-Type": "application/json" });
    return res.end(JSON.stringify({ error: "Model error", detail: errText.slice(0, 500) }));
  }

  res.writeHead(200, { "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-cache", "Connection": "keep-alive" });
  const reader = upstream.body.getReader();
  const decoder = new TextDecoder();
  let assistantText = "";
  let buf = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = decoder.decode(value, { stream: true });
      res.write(chunk);
      buf += chunk;
      let idx;
      while ((idx = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, idx); buf = buf.slice(idx + 1);
        const t = line.trim();
        if (t.startsWith("data:")) {
          const json = t.slice(5).trim();
          if (json && json !== "[DONE]") {
            try {
              const evt = JSON.parse(json);
              if (evt.type === "content_block_delta" && evt.delta && evt.delta.text) assistantText += evt.delta.text;
            } catch { /* partial json across chunks */ }
          }
        }
      }
    }
  } catch (e) {
    // client likely disconnected
  }
  res.end();

  if (payload.consent === true) {
    logConversation({
      ts: new Date().toISOString(),
      conversationId: typeof payload.conversationId === "string" ? payload.conversationId : null,
      model: MODEL,
      messages: messages.concat(assistantText ? [{ role: "assistant", content: assistantText }] : []),
    });
  }
}

// ---- thumbs up/down feedback ----
async function handleFeedback(req, res) {
  let payload;
  try { payload = JSON.parse(await readBody(req)); } catch { res.writeHead(400); return res.end("bad json"); }
  const rating = payload.rating === "up" || payload.rating === "down" ? payload.rating : null;
  if (!rating) { res.writeHead(400); return res.end("bad rating"); }
  logFeedback({
    ts: new Date().toISOString(),
    conversationId: typeof payload.conversationId === "string" ? payload.conversationId : null,
    rating,
    reply: typeof payload.reply === "string" ? payload.reply.slice(0, 8000) : null,
    question: typeof payload.question === "string" ? payload.question.slice(0, 8000) : null,
  });
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ ok: true }));
}

const server = http.createServer((req, res) => {
  if (req.method === "POST" && req.url === "/api/chat") return handleChat(req, res);
  if (req.method === "POST" && req.url === "/api/feedback") return handleFeedback(req, res);
  if (req.method === "GET" && req.url === "/healthz") { res.writeHead(200); return res.end("ok"); }
  if (req.method === "GET") return serveStatic(req, res);
  res.writeHead(405); res.end("method not allowed");
});

server.listen(PORT, () => {
  console.log("\n  The Co-Founder is running.");
  console.log("  Open  http://localhost:" + PORT);
  console.log("  Model: " + MODEL + "   Logging: consented conversations -> data/conversations.jsonl\n");
});
