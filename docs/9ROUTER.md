# Wiring the AI agent through 9Router

BlindLuv's matchmaker talks to [9Router](https://9router.com)
([source](https://github.com/decolua/9router)) — a self-hosted gateway that
fronts 60+ AI providers behind a single **OpenAI-compatible** endpoint, with
three-tier fallback when a subscription hits its quota.

---

## The one thing to get right first

> **9Router runs on `http://localhost:20128` by default. A Vercel function
> cannot reach your localhost.**

This is the single most important constraint in this document. There is no
hosted `api.9router.com` to point at — 9Router is software you run. So there
are two different setups depending on where BlindLuv is running:

| Where BlindLuv runs | What `AI_BASE_URL` should be |
| --- | --- |
| Your own machine (`npm run dev`) | `http://localhost:20128/v1` |
| Vercel (or any serverless host) | a **public HTTPS URL** for your 9Router instance |

BlindLuv detects this rather than failing silently: if `AI_BASE_URL` points at
loopback, `/api/config` reports `unreachableFromServerless: true` and the status
panel says so in plain language.

---

## Configuration

Three environment variables. All three must be set, or the agent falls back to
the deterministic scorer.

```bash
AI_BASE_URL=https://your-9router.example.com/v1   # the /v1 suffix is required
AI_API_KEY=sk_...                                 # from the 9Router dashboard
AI_MODEL=cc/claude-sonnet-4-6                     # provider-prefixed, see below
AI_TIMEOUT_MS=45000                               # optional
```

---

## Finding your Sonnet model ID

9Router model IDs are **provider-prefixed**, and the catalogue changes as you
connect providers or as they hit quota. There is no single fixed string for
"Sonnet 5" — it depends which provider is serving it to you.

Observed prefixes:

| Prefix | Provider | Example |
| --- | --- | --- |
| `cc/` | Claude Code subscription | `cc/claude-sonnet-4-6` |
| `kr/` | Kiro (free tier) | `kr/claude-sonnet-4.5` |
| `gh/` | GitHub Copilot | `gh/claude-sonnet-4.6` |
| `cu/` | Cursor | `cu/claude-4.5-sonnet-thinking` |

**Do not guess.** BlindLuv ships an endpoint that asks your router directly:

```bash
curl -s https://your-blindluv.vercel.app/api/models | jq
```

```json
{
  "count": 5,
  "configured": "cc/claude-sonnet-4-6",
  "sonnet": ["cc/claude-sonnet-4-6", "kr/claude-sonnet-4.5", "gh/claude-sonnet-4.6"],
  "models": ["cc/claude-opus-4-7", "cc/claude-sonnet-4-6", "..."]
}
```

The `sonnet` array is every model whose ID contains "sonnet". Copy the one you
want into `AI_MODEL`. You can also filter: `/api/models?q=sonnet`.

Equivalently, straight from the router: `GET {AI_BASE_URL}/models` with
`Authorization: Bearer {AI_API_KEY}`.

---

## Making 9Router reachable from Vercel

Pick whichever you prefer — 9Router's README documents all of these.

### Docker on a VPS (most robust)

```bash
docker run -d --name 9router -p 20128:20128 \
  -e REQUIRE_API_KEY=true \
  -e NODE_ENV=production \
  -e AUTH_COOKIE_SECURE=true \
  -v ~/.9router:/root/.9router \
  ghcr.io/decolua/9router:latest
```

Put it behind a reverse proxy with TLS, then
`AI_BASE_URL=https://ai.yourdomain.com/v1`.

### Cloudflare Tunnel (no public IP needed)

```bash
cloudflared tunnel --url http://localhost:20128
```

Gives you a `https://<random>.trycloudflare.com` URL. Fine for a demo; the
hostname changes on restart unless you create a named tunnel.

### Hugging Face Space

Free and always-on. 9Router's README links a walkthrough video.

> **Always set `REQUIRE_API_KEY=true` on anything internet-facing.** By default
> 9Router does not check the bearer token on `/v1/*`, which would leave your
> connected provider subscriptions open to the world.

---

## How BlindLuv talks to it

`web/src/lib/ai/router.ts` speaks plain OpenAI chat-completions over `fetch` —
no SDK, so there is nothing to keep in sync with a gateway that forwards to 60+
different upstreams.

```
POST {AI_BASE_URL}/chat/completions
Authorization: Bearer {AI_API_KEY}

{ "model": "{AI_MODEL}", "messages": [...], "stream": false }
```

Three deliberate robustness choices, because a gateway is a moving target:

**1. `response_format` is attempted, then dropped.** JSON mode support varies by
upstream provider, and 9Router forwards the field verbatim — so a provider that
rejects it would fail the whole call. BlindLuv tries `{"type":"json_object"}`
once and transparently retries without it on a 4xx. JSON reliability where it
exists, no availability cost where it does not.

**2. JSON is extracted defensively.** Gateway-routed models wrap output in
` ```json ` fences and prose often enough that a bare `JSON.parse` is not good
enough. `extractJson` strips fences, then scans for the first balanced object
while ignoring braces inside strings.

**3. Every field is validated before use.** A model that returns `score: "high"`
or omits `traits` does not corrupt a profile — each value is range-checked and
type-checked, and anything missing falls back to the deterministic result.

If any of that fails, the request still succeeds using
`web/src/lib/ai/heuristic.ts`, and the UI labels the card `Heuristic` instead of
the model name. A dating app that 500s because a gateway is down is not a demo,
it is a broken page.

---

## Verifying without a real gateway

```bash
cd web
node scripts/mock-9router.mjs 20128
AI_BASE_URL=http://localhost:20128/v1 AI_API_KEY=test AI_MODEL=cc/claude-sonnet-4-6 npm run dev
```

Verified behaviour with the mock:

```
profile  → source: router     (fenced JSON + prose prefix parsed correctly)
discover → source: router, score 78, reasons cite both profiles
gateway killed mid-run → source: heuristic, HTTP 200   (degrades, never 500s)
```

---

## Cost note

9Router's Tier-3 providers (Kiro, iFlow, Qwen, OpenCode) are free, and its
built-in RTK / Caveman token savers cut 20–65% of tokens. BlindLuv's calls are
small — a profile build and a compatibility score are a few hundred tokens each
— so a free tier is genuinely enough to run the whole demo.
