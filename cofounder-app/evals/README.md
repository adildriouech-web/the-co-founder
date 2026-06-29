# The Co-Founder — eval safety net

A lightweight regression suite that checks the **behaviors** we've tuned still hold after a deploy.
It does not test content recall ("does it know framework X") — it tests how the co-founder *behaves*:
replies in the user's language, applies frameworks **silently** (never names them, never name-drops
famous people), gives a concrete next step, handles a struggling founder with care, and keeps the voice
plain rather than dumping bullets.

## Run it

After every deploy (or before committing a prompt/KB change):

```bash
node evals/run-evals.js
```

Options:

```bash
# point at a different environment
BASE_URL=http://localhost:3000 node evals/run-evals.js
BASE_URL=https://staging.example.com node evals/run-evals.js

# longer timeout if the free-tier dyno is cold-starting
TIMEOUT_MS=180000 node evals/run-evals.js
```

No dependencies — just Node 18+ (uses built-in `fetch`). The first request may take ~50s if the
Render free instance is asleep; the runner pings `/healthz` first to warm it.

## What you get

Each case prints `pass` / `warn` / `FAIL`:

- **FAIL** (auto) — a behavior we care about broke. Examples: it named a framework, name-dropped a
  founder, replied in the wrong language, or missed a required cue. The process exits non-zero, so this
  can gate a deploy in CI.
- **warn** (auto) — worth a glance but not necessarily wrong (e.g. it said a borderline word like
  "flywheel", mentioned a company the founder might have raised themselves, or used a lot of bullets).
- **? MANUAL** — things a regex grades badly (tone, empathy, intellectual honesty). The full reply is
  saved so you can read it.

Every reply and result is written to `evals/last-report.json` for review.

## The global rules (checked on every case)

- **Silent frameworks** — hard fail if the reply says a framework name (OODA, Kano, crossing the chasm,
  guanxi, kaizen, RICE, gap selling, …). The whole point is that the depth is applied invisibly.
- **No guru name-drops** — hard fail if it cites a famous founder/investor as authority (Jobs, Musk,
  Buffett, Thiel, Sun Tzu, …).
- **Company-as-proof** — soft warn if it names a well-known company; fine if the founder raised it,
  a problem only if it's used as "look how they did it" proof.

## Adding cases

Edit `eval-set.json`. A case looks like:

```json
{
  "id": "short-id",
  "category": "language | silent-frameworks | wellbeing | ...",
  "intent": "one line on what this guards",
  "profile": "optional carried founder profile (tests cross-session memory + language)",
  "messages": [{ "role": "user", "content": "the founder's message" }],
  "checks": {
    "expectLang": "en | es | fr",
    "mustContainAny": ["device", "summary"],
    "mustNotContain": ["wu wei"],
    "warnIfContains": ["clean slate"],
    "warnIfMissingAny": ["reversible", "test"],
    "expectActionable": true,
    "maxBullets": 8
  },
  "manualNote": "what a human should eyeball in the reply"
}
```

Keep cases behavior-focused and few — a tight, trusted suite you actually run beats a big one you ignore.

## A note on the language check

Language detection here is a keyword heuristic — a smoke signal, not a classifier. If a language case
warns or fails, glance at the saved reply to confirm before treating it as real.
