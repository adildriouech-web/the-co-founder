// db.js — durable storage + first-party analytics for The Co-Founder.
//
// Storage backend: Neon (serverless Postgres) when DATABASE_URL is set; otherwise it
// falls back to the original ./data/*.jsonl append files so local dev works with no DB.
//
// Why Neon: Render's free web service has no persistent disk, so logs written to the
// container reset on every redeploy/spin-down. Neon is a free external Postgres reached
// over HTTP (fetch), keeping this app close to zero-dependency.
//
// Privacy: rows are only written when the founder consented (the server gates on consent),
// matching the product's data-handling commitment. Analytics are first-party — derived from
// the same tables, no third-party scripts, exposed only through a token-protected endpoint.

const fs = require("fs");
const path = require("path");

const DATA_DIR = path.join(__dirname, "data");
const DATABASE_URL = process.env.DATABASE_URL || "";

let sql = null;          // Neon tagged-template query function, when configured
let backend = "jsonl";   // "neon" | "jsonl"
let ready = false;       // schema initialized (neon) or dir ensured (jsonl)

// ---- backend init ---------------------------------------------------------
async function init() {
  if (DATABASE_URL) {
    try {
      const { neon } = require("@neondatabase/serverless");
      sql = neon(DATABASE_URL);
      await sql`CREATE TABLE IF NOT EXISTS conversations (
        id BIGSERIAL PRIMARY KEY,
        ts TIMESTAMPTZ NOT NULL DEFAULT now(),
        conversation_id TEXT,
        client_id TEXT,
        model TEXT,
        num_messages INT,
        messages JSONB
      )`;
      await sql`CREATE TABLE IF NOT EXISTS feedback (
        id BIGSERIAL PRIMARY KEY,
        ts TIMESTAMPTZ NOT NULL DEFAULT now(),
        conversation_id TEXT,
        client_id TEXT,
        rating TEXT,
        reply TEXT,
        question TEXT
      )`;
      await sql`CREATE INDEX IF NOT EXISTS conversations_ts_idx ON conversations(ts)`;
      await sql`CREATE INDEX IF NOT EXISTS conversations_client_idx ON conversations(client_id)`;
      backend = "neon";
      ready = true;
      console.log("  Storage: Neon Postgres (durable).");
      return;
    } catch (e) {
      console.error("[db] Neon init failed, falling back to jsonl:", e.message);
      sql = null;
    }
  }
  try { if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true }); } catch (e) { /* ignore */ }
  backend = "jsonl";
  ready = true;
  console.log("  Storage: local data/*.jsonl (ephemeral — set DATABASE_URL for durable storage).");
}

// ---- writes (fire-and-forget; never throw into the request path) ----------
async function logConversation(record) {
  try {
    if (backend === "neon") {
      await sql`INSERT INTO conversations (ts, conversation_id, client_id, model, num_messages, messages)
        VALUES (${record.ts || new Date().toISOString()}, ${record.conversationId || null},
                ${record.clientId || null}, ${record.model || null},
                ${Array.isArray(record.messages) ? record.messages.length : null},
                ${JSON.stringify(record.messages || [])})`;
    } else {
      fs.appendFileSync(path.join(DATA_DIR, "conversations.jsonl"), JSON.stringify(record) + "\n");
    }
  } catch (e) {
    console.error("[db] logConversation failed:", e.message);
  }
}

async function logFeedback(record) {
  try {
    if (backend === "neon") {
      await sql`INSERT INTO feedback (ts, conversation_id, client_id, rating, reply, question)
        VALUES (${record.ts || new Date().toISOString()}, ${record.conversationId || null},
                ${record.clientId || null}, ${record.rating || null},
                ${record.reply || null}, ${record.question || null})`;
    } else {
      fs.appendFileSync(path.join(DATA_DIR, "feedback.jsonl"), JSON.stringify(record) + "\n");
    }
  } catch (e) {
    console.error("[db] logFeedback failed:", e.message);
  }
}

// ---- first-party analytics ------------------------------------------------
async function getStats() {
  if (backend === "neon") return statsFromNeon();
  return statsFromJsonl();
}

async function statsFromNeon() {
  const [tot] = await sql`SELECT
      count(*)::int AS turns,
      count(distinct conversation_id)::int AS conversations,
      count(distinct client_id)::int AS founders,
      max(ts) AS last_active,
      count(*) FILTER (WHERE ts > now() - interval '7 days')::int AS turns_7d,
      count(distinct conversation_id) FILTER (WHERE ts > now() - interval '7 days')::int AS conversations_7d,
      count(distinct client_id) FILTER (WHERE ts > now() - interval '7 days')::int AS founders_7d
    FROM conversations`;
  const [ret] = await sql`SELECT count(*)::int AS returning FROM (
      SELECT client_id FROM conversations WHERE client_id IS NOT NULL
      GROUP BY client_id HAVING count(distinct conversation_id) >= 2) t`;
  const daily = await sql`SELECT to_char(date_trunc('day', ts), 'YYYY-MM-DD') AS day,
      count(*)::int AS turns, count(distinct conversation_id)::int AS conversations,
      count(distinct client_id)::int AS founders
    FROM conversations WHERE ts > now() - interval '14 days' GROUP BY 1 ORDER BY 1`;
  const fb = await sql`SELECT rating, count(*)::int AS n FROM feedback GROUP BY rating`;
  const feedback = { up: 0, down: 0 };
  for (const r of fb) { if (r.rating === "up") feedback.up = r.n; if (r.rating === "down") feedback.down = r.n; }
  const founders = tot.founders || 0, ret_n = ret.returning || 0;
  return {
    backend,
    totals: {
      conversations: tot.conversations || 0,
      turns: tot.turns || 0,
      founders,
      returningFounders: ret_n,
      returnRate: founders ? +(ret_n / founders).toFixed(3) : 0,
      lastActive: tot.last_active || null,
    },
    last7Days: { conversations: tot.conversations_7d || 0, turns: tot.turns_7d || 0, founders: tot.founders_7d || 0 },
    daily,
    feedback,
  };
}

// jsonl fallback — compute the same shape from the append files (best-effort, for local dev)
async function statsFromJsonl() {
  const readLines = (f) => {
    try { return fs.readFileSync(path.join(DATA_DIR, f), "utf8").split("\n").filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean); }
    catch { return []; }
  };
  const convs = readLines("conversations.jsonl");
  const fbs = readLines("feedback.jsonl");
  const dayKey = (ts) => (ts || "").slice(0, 10);
  const convIds = new Set(), clientIds = new Set();
  const byClientConv = new Map(); // client -> set of conversation_id
  const dayMap = new Map();       // day -> {turns, convSet, clientSet}
  const now = Date.now(), wk = now - 7 * 864e5;
  let turns7 = 0; const conv7 = new Set(), client7 = new Set();
  let lastActive = null;
  for (const r of convs) {
    const cid = r.conversationId || null, cl = r.clientId || null, ts = r.ts || null;
    if (cid) convIds.add(cid);
    if (cl) clientIds.add(cl);
    if (cl) { if (!byClientConv.has(cl)) byClientConv.set(cl, new Set()); if (cid) byClientConv.get(cl).add(cid); }
    if (ts && (!lastActive || ts > lastActive)) lastActive = ts;
    const d = dayKey(ts);
    if (d) { if (!dayMap.has(d)) dayMap.set(d, { turns: 0, convSet: new Set(), clientSet: new Set() }); const e = dayMap.get(d); e.turns++; if (cid) e.convSet.add(cid); if (cl) e.clientSet.add(cl); }
    if (ts && Date.parse(ts) >= wk) { turns7++; if (cid) conv7.add(cid); if (cl) client7.add(cl); }
  }
  let returning = 0; for (const s of byClientConv.values()) if (s.size >= 2) returning++;
  const daily = [...dayMap.entries()].sort((a, b) => a[0] < b[0] ? -1 : 1).slice(-14)
    .map(([day, e]) => ({ day, turns: e.turns, conversations: e.convSet.size, founders: e.clientSet.size }));
  const feedback = { up: 0, down: 0 };
  for (const r of fbs) { if (r.rating === "up") feedback.up++; if (r.rating === "down") feedback.down++; }
  const founders = clientIds.size;
  return {
    backend,
    totals: {
      conversations: convIds.size, turns: convs.length, founders,
      returningFounders: returning, returnRate: founders ? +(returning / founders).toFixed(3) : 0,
      lastActive,
    },
    last7Days: { conversations: conv7.size, turns: turns7, founders: client7.size },
    daily, feedback,
  };
}

// ---- read transcripts (for the in-browser viewer + weekly digest) ----
async function getConversations({ limit = 50, sinceDays = null } = {}) {
  limit = Math.max(1, Math.min(parseInt(limit, 10) || 50, 500));
  if (backend === "neon") {
    // Dedupe to ONE row per conversation (the latest turn holds the full transcript). Rows with no
    // conversation_id stay distinct (keyed on their own id). Then order newest-first and limit.
    const rows = sinceDays
      ? await sql`SELECT * FROM (
            SELECT DISTINCT ON (COALESCE(conversation_id, id::text)) ts, conversation_id AS "conversationId",
                   client_id AS "clientId", messages
            FROM conversations WHERE ts > now() - make_interval(days => ${parseInt(sinceDays, 10)})
            ORDER BY COALESCE(conversation_id, id::text), ts DESC
          ) t ORDER BY t.ts DESC LIMIT ${limit}`
      : await sql`SELECT * FROM (
            SELECT DISTINCT ON (COALESCE(conversation_id, id::text)) ts, conversation_id AS "conversationId",
                   client_id AS "clientId", messages
            FROM conversations
            ORDER BY COALESCE(conversation_id, id::text), ts DESC
          ) t ORDER BY t.ts DESC LIMIT ${limit}`;
    return rows.map((r) => ({ ts: r.ts, conversationId: r.conversationId, clientId: r.clientId,
      messages: typeof r.messages === "string" ? safeParse(r.messages) : (r.messages || []) }));
  }
  // jsonl fallback
  let rows = [];
  try {
    rows = fs.readFileSync(path.join(DATA_DIR, "conversations.jsonl"), "utf8")
      .split("\n").filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
  } catch { rows = []; }
  if (sinceDays) { const cut = Date.now() - parseInt(sinceDays, 10) * 864e5; rows = rows.filter((r) => r.ts && Date.parse(r.ts) >= cut); }
  rows.sort((a, b) => (a.ts < b.ts ? 1 : -1));
  // Dedupe to the latest row per conversationId (the full transcript); keep rows with no id distinct.
  const seen = new Set(); const deduped = [];
  for (const r of rows) {
    const key = r.conversationId || ("__" + (r.ts || Math.random()));
    if (seen.has(key)) continue;
    seen.add(key); deduped.push(r);
  }
  return deduped.slice(0, limit).map((r) => ({ ts: r.ts, conversationId: r.conversationId || null, clientId: r.clientId || null, messages: r.messages || [] }));
}
function safeParse(s) { try { return JSON.parse(s); } catch { return []; } }

module.exports = { init, logConversation, logFeedback, getStats, getConversations, get backend() { return backend; }, get ready() { return ready; } };
