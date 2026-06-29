#!/usr/bin/env node
/* The Co-Founder — behavioral regression runner (zero dependencies, Node 18+).
 *
 * Sends each case in eval-set.json to POST {BASE}/api/chat and scores the reply.
 * Run after every deploy:   node evals/run-evals.js
 * Against a custom URL:      BASE_URL=https://staging.example.com node evals/run-evals.js
 * Local server:             BASE_URL=http://localhost:3000 node evals/run-evals.js
 *
 * Two kinds of checks:
 *   - AUTO  : pass/fail/warn decided here (language, silent-frameworks, no name-drops, keywords, bullets).
 *   - MANUAL: printed with the reply for a human to eyeball (things models grade better than regex).
 * Exit code is non-zero if any AUTO check FAILS, so this can gate a deploy in CI.
 */
const fs = require("fs");
const path = require("path");

const BASE = (process.env.BASE_URL || "https://the-co-founder.onrender.com").replace(/\/+$/, "");
let SET; // loaded lazily in main() so the scoring engine can be required for unit tests
const TIMEOUT_MS = parseInt(process.env.TIMEOUT_MS || "120000", 10); // generous: free-tier cold start

// ---- GLOBAL checks applied to EVERY reply ---------------------------------
// Named frameworks the co-founder must apply SILENTLY (never say the name to a user).
const FRAMEWORK_NAMES = [
  "first principles","second-order thinking","ooda loop","bayesian","circle of competence",
  "five forces","5 forces","seven powers","7 powers","jobs to be done","jtbd","spin selling",
  "challenger sale","meddic","aarrr","pirate metrics","crossing the chasm","rice score",
  "rice prioritization","kano model","van westendorp","blue ocean","disruptive innovation",
  "category design","counter-positioning","kaizen","nemawashi","hoshin kanri","andon cord",
  "hansei","omotenashi","wu wei","guanxi","rendanheyi","keiretsu","chaebol","jugaad",
  "arthashastra","nunchi","ubuntu","harambee","asabiyyah","gap selling","situational leadership",
  "extreme ownership","cash conversion cycle","bar raiser"
];
// Soft: generic-enough words the model MIGHT say plainly; flag for review, don't fail.
const FRAMEWORK_SOFT = ["flywheel","premortem","pre-mortem","margin of safety","unit economics","north star"];
// Famous people cited as authority — a guru name-drop is a hard fail.
const GURU_NAMES = [
  "steve jobs","elon musk"," bezos","jeff bezos","warren buffett"," buffett","peter thiel"," thiel",
  "paul graham","sun tzu","clayton christensen","geoffrey moore","reid hoffman","sam altman",
  "marc andreessen","mark zuckerberg"," drucker","steve blank","ben horowitz","naval"
];
// Companies named as proof — soft warn (a founder may legitimately mention them themselves).
const COMPANY_SOFT = ["airbnb","uber","dropbox","stripe","tesla","kodak","nokia","blockbuster","webvan","wework","netflix","amazon"];

// ---- language heuristic (smoke signal, manual-confirmable) ------------------
const LANG_MARKERS = {
  en: [" the "," you "," your "," and "," for "," that "," with "," what "," should "," this "],
  es: ["¿","¡"," que "," para "," con "," una "," por "," cómo "," qué "," tu "," negocio "," clientes "],
  fr: [" le "," les "," des "," une "," vous "," pour "," votre "," avec "," qu'"," à "," est "," votre "]
};
function guessLang(t) {
  const s = " " + t.toLowerCase() + " ";
  let best = "en", bestN = -1;
  for (const [lang, marks] of Object.entries(LANG_MARKERS)) {
    let n = 0; for (const m of marks) n += s.split(m).length - 1;
    if (n > bestN) { bestN = n; best = lang; }
  }
  return best;
}
const has = (t, term) => t.toLowerCase().includes(term.toLowerCase());
const countBullets = (t) => (t.match(/^\s*[•\-\*]\s+/gm) || []).length;
function looksActionable(t) {
  const lc = t.toLowerCase();
  const cues = ["this week","next step","start by","try ","talk to","list ","write down","reach out","send ","ask ","pick ","go and","first step","today","by friday"];
  if (cues.some((c) => lc.includes(c))) return true;
  return /\?\s*$/.test(t.trim()); // a focused question back is an acceptable "next step"
}

// ---- call the live app -----------------------------------------------------
function stripControl(t) {
  // drop the model's UI control lines (OPTIONS: chips, MEMORY: profile) before scoring
  return t.split("\n").filter((l) => !/^\s*\**\s*(OPTIONS|MEMORY)\s*\**\s*:/i.test(l)).join("\n").trim();
}
function extractText(raw) {
  // Tolerant SSE/text parser: pull text out of Anthropic-style deltas, else treat as plain text.
  let out = "";
  let sawData = false;
  for (const line of raw.split("\n")) {
    const m = line.match(/^data:\s?(.*)$/);
    if (!m) continue;
    sawData = true;
    const payload = m[1].trim();
    if (!payload || payload === "[DONE]") continue;
    try {
      const o = JSON.parse(payload);
      if (o?.delta?.text) out += o.delta.text;                       // Anthropic text_delta
      else if (o?.delta?.content) out += o.delta.content;            // alt
      else if (typeof o?.text === "string") out += o.text;
      else if (o?.choices?.[0]?.delta?.content) out += o.choices[0].delta.content; // OpenAI-style
    } catch { /* ignore non-JSON data lines */ }
  }
  return sawData ? out : raw; // if it wasn't SSE, the body was probably plain text
}
async function ask(c) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(BASE + "/api/chat", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ messages: c.messages, profile: c.profile || "" }),
      signal: ctrl.signal,
    });
    const raw = await res.text();
    if (!res.ok) return { ok: false, error: "HTTP " + res.status + ": " + raw.slice(0, 200) };
    return { ok: true, text: stripControl(extractText(raw)) };
  } catch (e) {
    return { ok: false, error: e.name === "AbortError" ? "timeout (" + TIMEOUT_MS + "ms)" : e.message };
  } finally { clearTimeout(timer); }
}

// ---- scoring ---------------------------------------------------------------
function score(c, text) {
  const fails = [], warns = [], manual = [];
  // global: silent frameworks
  for (const f of FRAMEWORK_NAMES) if (has(text, f)) fails.push("named a framework: \"" + f + "\"");
  for (const f of FRAMEWORK_SOFT) if (has(text, f)) warns.push("said \"" + f + "\" (ok if plain-language, check it's not lecturing)");
  // global: no guru name-drops / company-as-proof
  for (const g of GURU_NAMES) if (has(text, g)) fails.push("name-dropped a person: \"" + g.trim() + "\"");
  for (const co of COMPANY_SOFT) if (has(text, co)) warns.push("mentioned company \"" + co + "\" (ok if the founder raised it; fail if cited as proof)");
  const ch = c.checks || {};
  if (ch.expectLang) { const g = guessLang(text); if (g !== ch.expectLang) fails.push("expected " + ch.expectLang + " reply, looked like " + g); }
  if (ch.mustNotContain) for (const t of ch.mustNotContain) if (has(text, t)) fails.push("contains forbidden: \"" + t + "\"");
  if (ch.mustContainAny) if (!ch.mustContainAny.some((t) => has(text, t))) fails.push("missing all of: [" + ch.mustContainAny.join(", ") + "]");
  if (ch.warnIfContains) for (const t of ch.warnIfContains) if (has(text, t)) warns.push("contains discouraged: \"" + t + "\"");
  if (ch.warnIfMissingAny) if (!ch.warnIfMissingAny.some((t) => has(text, t))) warns.push("none of (soft): [" + ch.warnIfMissingAny.join(", ") + "]");
  if (ch.expectActionable && !looksActionable(text)) warns.push("no obvious concrete next step / question");
  if (typeof ch.maxBullets === "number" && countBullets(text) > ch.maxBullets) warns.push("too many bullets (" + countBullets(text) + " > " + ch.maxBullets + ") — voice regression");
  if (c.manualNote) manual.push(c.manualNote);
  return { fails, warns, manual };
}

// ---- run -------------------------------------------------------------------
async function main() {
  SET = JSON.parse(fs.readFileSync(path.join(__dirname, "eval-set.json"), "utf8"));
  console.log("Co-Founder eval — target: " + BASE + "\n" + "=".repeat(64));
  try { await fetch(BASE + "/healthz", { method: "GET" }).catch(() => {}); } catch {} // warm the dyno
  let pass = 0, fail = 0, warnCases = 0; const report = [];
  for (const c of SET.cases) {
    process.stdout.write("• " + c.id.padEnd(34) + " ");
    const r = await ask(c);
    if (!r.ok) { console.log("ERROR — " + r.error); fail++; report.push({ id: c.id, status: "error", error: r.error }); continue; }
    const { fails, warns, manual } = score(c, r.text);
    const status = fails.length ? "FAIL" : warns.length ? "warn" : "pass";
    if (status === "FAIL") fail++; else pass++;
    if (status === "warn") warnCases++;
    console.log(status === "pass" ? "pass" : status === "warn" ? "warn" : "FAIL");
    for (const f of fails) console.log("      ✗ " + f);
    for (const w of warns) console.log("      ! " + w);
    for (const m of manual) console.log("      ? MANUAL: " + m);
    report.push({ id: c.id, category: c.category, status, fails, warns, manual, reply: r.text });
  }
  console.log("=".repeat(64));
  console.log("AUTO: " + pass + " ok, " + warnCases + " with warnings, " + fail + " FAILED  (of " + SET.cases.length + ")");
  console.log("Manual-review items are marked '? MANUAL' above — read the saved replies for those.");
  const out = path.join(__dirname, "last-report.json");
  fs.writeFileSync(out, JSON.stringify({ base: BASE, ranAt: new Date().toISOString(), report }, null, 2));
  console.log("Full replies + results saved to " + out);
  process.exit(fail > 0 ? 1 : 0);
}
if (require.main === module) main();
module.exports = { score, guessLang, extractText, stripControl, looksActionable, countBullets };
