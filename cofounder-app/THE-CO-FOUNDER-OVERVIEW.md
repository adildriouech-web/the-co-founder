# The Co-Founder — Product & Build Overview

*A single reference for everything decided on the product: purpose, plan, knowledge, architecture, deployment, and changes to date. Last updated: June 27, 2026.*

---

## 1. What it is

The Co-Founder is a decision-intelligence chat app for first-time founders. When a founder is alone and stuck on a decision, it acts like a calm, sharp, experienced business partner — not a guru, a coach, a course, or a search engine. Its job is to help them **decide and move**, not to make them feel good.

**Live at:** https://the-co-founder.onrender.com

### Core purpose
Information is abundant; clear judgment is rare. The app supplies the judgment — briefly. It optimizes, in order, for: decision **clarity → quality → actionability → momentum**. If a founder leaves inspired but still doesn't know what to do, it failed.

### Success metrics (what "good" looks like)
- Founders genuinely make **better decisions** matched to their stage, resources, and reversibility (decision quality over feeling good).
- They **come back**.
- It's polished enough to **validate the idea for investors**.
- The **voice is right** — warm, honest, direct, plain-spoken.

Constraints we committed to: low cost, founder-data privacy, a polished look, and fast responses.

---

## 2. Key product decisions

- **Audience:** first-time founders across the **full journey** — from "I have an idea but don't know where to begin" through validation, first sale, pricing, hiring, raising, and scaling. Pre-start founders are the on-ramp, not the sole focus.
- **Core principle — Decision First:** every interaction centers on the real decision and ends with one concrete next step.
- **Anti-guru stance:** never name frameworks or quote famous founders as proof; puncture survivorship/hindsight/luck bias gently.
- **Data handling:** capture all conversations **with a consent notice** (a consent gate appears before first use). Conversations are also kept on the user's device (localStorage) so they can return to them.
- **Design:** sleek, premium **dark theme** (green accent), phone-chat feel.
- **Interaction:** short replies, **tappable option chips** on almost every turn (founders dislike typing), plus **voice in** (mic) and **voice out** (read-aloud).
- **Languages:** the AI replies in whatever language the user types. The interface ships localized in **English, 日本語 (Japanese), and Bahasa Indonesia**, chosen via a top-bar picker (auto-detected from the browser on first visit).

---

## 3. The build plan (phases)

The product was built in strict phases, each reviewed before moving on:

- **Phase 0 — Product Brief:** purpose, audience, principles, success metrics, north star.
- **Phase 1 — Knowledge base:** frameworks organized by *decision*, not by thinker.
- **Phase 2 — Decision engine:** how the app reads a situation and picks the highest-leverage move.
- **Phase 2.5 — Founder Decision Graph:** the journey map (the "moat").
- **Phase 3 — System prompt:** the voice, rules, and behavior.
- **Phase 4 — Working app:** the actual chat application, then hosting.

---

## 4. Knowledge base (Phase 1)

Frameworks are organized **by the decision they serve**, tagged, and quality-checked.

**Tags on every framework:** family · reversibility (one-way vs two-way door) · stage (0–6) · evidence strength. Cautionary "deep-pockets-only" plays are flagged WARN.

**Families:** Opportunity, Product, Sales, Hiring, Capital, Growth, Crisis.

**Anti-Guru Check:** each framework was screened for survivorship, hindsight, and luck bias before inclusion.

**Regional distribution** (so advice reflects how builders worldwide decide, not just Silicon Valley): ~25% East Asia, 20% Southeast Asia, 20% Western, 15% South Asia, 10% Middle East, 10% other.

The running app uses a **condensed** version of this library baked into `knowledge.js` (kept server-side, never sent to the browser), distilled from the fuller Phase-1 source for speed and cost.

---

## 5. Decision engine (Phase 2)

The app silently reads four things, mostly by listening:

- **Stage:** searching → idea → validation → first revenue → repeatable revenue → growth → scale.
- **Reservoir:** money + time; full-time or side.
- **Reversibility:** one-way vs two-way door — this sets the tempo. Reversible → move fast, the cost of finding out is tiny. Irreversible → slow down, run a quick premortem. It watches for the classic trap: agonizing over a reversible thing while rushing an irreversible one.
- **The real decision:** often not the one the founder asked about.

It also scans for the common ways founders sink and names the one it sees, briefly.

---

## 6. Founder Decision Graph (Phase 2.5)

The journey map the engine locates founders on, pre-empting the **next** cliff:

N0 Idea → N1 Validation → N2 Customer talks → N3 Offer (who/what/price) → N4 First sale → N5 Repeatable sales → N6 Systems → N7 Hiring → N8 Grow/focus/scale — plus a **Crisis** path that applies at any node (stabilize → see clearly → choose one: cut / pivot / exit). Each node has its trigger to advance and its characteristic failure cliff.

---

## 7. System prompt & voice (Phase 3)

- **Diagnose before prescribing:** on a new or open problem, ask 1–2 sharp questions about the actual business (what they sell, exactly who the customer is, the price, what they've tried, what the evidence says) before recommending anything. Quick diagnosis, not an interrogation — don't guess on the essentials.
- **Strategic, not generic:** every recommendation is tied to the founder's specific situation, with the *why* and the trade-off — never a bare tactic. When useful, name 2–3 real options in a phrase, then the pick and why it beats the others. (Added after the first real user feedback: a generic "cold-call from Google Maps" answer felt "too basic.")
- **Brevity, but depth:** default to a few short sentences then one next step — no headers or bullet walls. Depth comes from sharper thinking, not length.
- **Voice:** warm and on their side; plain words a 16-year-old gets; honest about uncertainty; direct enough to disagree. Replies in the user's language.
- **Flow:** reflect the worry → name the real decision → strategic take with the key trade-off → one concrete next step.
- **Tappable options** on almost every turn, emitted as a special `OPTIONS: a | b | c` line the app renders as buttons.
- **Always ends with momentum** — a concrete, doable-now step, pulling from the tactical playbooks when useful.
- **Safety:** on big legal/money/tax/health calls, help them think then point to a real professional; on signs of burnout or distress, slow down and point to real support.

---

## 8. App architecture (Phase 4)

**Stack:** a zero-dependency **Node.js (18+) HTTP server** that both serves the front-end and proxies the model API. No build step, no framework.

**Files (under `cofounder-app/`):**
- `server.js` — serves `public/`, exposes `POST /api/chat` (streams the reply via SSE), `POST /api/feedback`, `GET /api/stats` (token-protected analytics), and `GET /healthz`. Keeps the API key server-side. Reads all config from env vars. Delegates all logging to `db.js`.
- `db.js` — storage + first-party analytics. Writes consented conversations/feedback to Neon Postgres when `DATABASE_URL` is set, else to `data/*.jsonl`; computes the `/api/stats` aggregates. Swap-in point for any other backend.
- `knowledge.js` — the system prompt + condensed knowledge (the "brain"), server-side only.
- `public/index.html` — the entire front-end in one file (dark UI, streaming render, consent gate, multi-chat localStorage, cross-session memory profile, anonymous `clientId`, mic input, read-aloud, tappable chips).
- `public/admin.html` — token-gated analytics dashboard (founders, returning founders, conversations, daily activity).
- `package.json` — `start: node server.js`, Node ≥ 18, one dependency (`@neondatabase/serverless`).

**Data flow:** browser → `/api/chat` → server adds the system prompt + knowledge → Anthropic Messages API (model **claude-sonnet-4-6**, streaming) → streamed back to the browser token by token.

**Key settings (env vars):** `ANTHROPIC_API_KEY`, `MODEL` (default claude-sonnet-4-6), `PORT` (host-assigned), `MAX_TOKENS=900` (room for strategic depth without essays), `MAX_HISTORY_TURNS=24` (caps history sent, controls cost), `ACCESS_CODE` (optional — if set, the app requires a shared passcode), `RATE_MAX`/`RATE_WINDOW_MS` (per-IP rate limit, default 40 requests / 10 min).

**Abuse protection:** the public `/api/chat` endpoint has a built-in per-IP rate limiter (on by default) so the exposed relay can't be scripted to run up API costs. An optional shared access code (off by default; flip on by setting `ACCESS_CODE`) can gate the app to invited testers.

**Features in the UI:** multiple saved conversations, streaming replies, consent gate, tappable option chips, mic (speech-to-text), read-aloud toggle (text-to-speech), language picker, mobile-responsive drawer.

**Multi-language:** a `langSel` picker offers English / 日本語 / Bahasa Indonesia. All interface text (header, starter questions, consent screen, buttons, labels, placeholder, footer) lives in an `I18N` dictionary in `index.html`; the choice is saved in localStorage and auto-detected from `navigator.language` on first visit. Voice input (`recog.lang`) and read-aloud (`utterance.lang`) follow the selected language. The model itself is instructed (in `knowledge.js`) to reply in the same language the user writes in — including the option chips — so languages beyond these three also work in conversation, even though the fixed UI chrome stays in the three localized languages.

---

## 9. Deployment

- **Host:** Render free Web Service (Node). Service name `the-co-founder`. Auto-deploys from GitHub on every push to `main`.
- **Repo:** `adildriouech-web/the-co-founder` (the app lives in the `cofounder-app/` subfolder).
- **Render config:** Root Directory `cofounder-app`, Build Command `npm install`, Start Command `node server.js`. Env vars set in Render (never committed): `ANTHROPIC_API_KEY` (required); `DATABASE_URL` (Neon Postgres connection string — enables durable storage); `STATS_TOKEN` (any long random string — protects the analytics endpoint/dashboard).
- **Cost / limits:** $0/month on the free tier. It **spins down after ~15 min idle**, so the first visit after idle takes ~50s to wake, then it's fast. Render required a card on file (verification only) and a non-blank build command even for the free tier.
- **Updating it:** edit the files and push/re-upload to the GitHub repo — Render rebuilds automatically. Behavior/voice lives in `knowledge.js`; the interface in `public/index.html`.

---

## 10. Changes made after launch

- Starter screen now shows **7 full-journey questions**, including "I want to start a business but have no idea where to begin."
- **Knowledge expanded:** more frameworks and depth per family; failure patterns now include **early-warning signs**; added a set of **tactical playbooks** (customer interviews, landing-page/price/smoke tests, concierge MVP, first-10-customers, weekly focus, premortem, kill/continue, and a "no idea yet" starter).
- **Thumbs up/down feedback removed** from replies.
- **Multi-language** — UI localized in English / 日本語 / Bahasa Indonesia (top-bar picker, auto-detected), and the model replies in the user's language.
- **Diagnose-first / strategic behavior** — after the first real tester (Jessy) said answers were "too basic," the prompt was changed to ask about the business before prescribing and to give specific, strategic advice with the reasoning. Reply cap raised 700 → 900 for depth.
- **Abuse protection + link preview** — per-IP rate limiting on the chat endpoint (with an optional access-code gate), plus Open Graph meta tags and a favicon so the shared link shows a proper preview.

---

## 11. Known follow-ups / open items

- **Durable storage + analytics — DONE (June 28, 2026).** Logging was moved out of `server.js` into a new `db.js`. When `DATABASE_URL` is set, consented conversations + feedback are written to **Neon (serverless Postgres, free tier)** over HTTP, surviving redeploys/spin-downs; with no `DATABASE_URL` it falls back to the old `data/*.jsonl` files so local dev is unchanged. First-party analytics are derived from the same tables (conversations, returning founders, return rate, daily activity, feedback) and exposed via a token-protected `GET /api/stats` plus a simple dashboard at **`/admin.html`** (gated by `STATS_TOKEN`). The front-end now sends a stable anonymous `clientId` (localStorage `cf_client`) so returning founders can be counted without identifying anyone. No third-party analytics scripts. *Activation:* set `DATABASE_URL` and `STATS_TOKEN` in Render (see §9).
- **Rotate the Anthropic API key** (one was shared in chat during setup) and **set a spend limit** in the Anthropic console before sharing widely. *(Still open — requires console access; secrets are entered by the owner.)*
- The app has **no live web access and no access to the user's own data** — it reasons from its baked-in knowledge plus the conversation only.

---

## 12. North star

Better decisions, faster, with less confusion and more confidence. Be the judgment — briefly.
