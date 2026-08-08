# Getting your 9Router API key

Step-by-step. You only need to hand over three values at the end:
`AI_BASE_URL`, `AI_API_KEY`, `AI_MODEL`.

> **Read this first:** 9Router is software *you run*. There is no
> `api.9router.com` to sign up for. So "getting a key" means starting your own
> 9Router and copying the key it generates for you.

---

## Step 1 — Run 9Router

```bash
npm install -g 9router
9router
```

The dashboard opens at <http://localhost:20128>.

---

## Step 2 — Connect a provider that gives you Claude

Dashboard → **Providers**. Pick whichever you have:

| Provider | Cost | Gets you |
| --- | --- | --- |
| **Kiro AI** | free, ~50 credits/month, no signup | Claude Sonnet 4.5 — easiest start |
| **OpenCode Free** | free, no auth | rotating free models |
| **Claude Code** | your existing subscription | the newest Sonnet/Opus you have access to |
| **GitHub Copilot** | your existing subscription | Claude Sonnet |
| **Anthropic** | pay per token | anything on your account |

For BlindLuv, **Kiro AI is enough** — profile-building and scoring are only a
few hundred tokens per call.

Connect via OAuth or paste an API key, depending on the provider.

---

## Step 3 — Copy the API key

Dashboard → **Endpoint** (or Settings) → copy the generated key.

This key authenticates *you to your own router*. It is not a Claude key.

---

## Step 4 — Find your model ID

Dashboard → **Models**, or ask the router:

```bash
curl -s http://localhost:20128/v1/models \
  -H "Authorization: Bearer YOUR_KEY" | jq '.data[].id' | grep -i sonnet
```

IDs are provider-prefixed. Typical results:

```
cc/claude-sonnet-4-6      ← Claude Code subscription
kr/claude-sonnet-4.5      ← Kiro free tier
gh/claude-sonnet-4.6      ← GitHub Copilot
```

Copy the exact string. **Do not guess it** — the catalogue depends on which
providers you connected, and a wrong ID fails every call.

Once BlindLuv is configured you can also just hit
`https://blindluv-app.vercel.app/api/models`, which returns a `sonnet`
shortlist from your router.

---

## Step 5 — Make it reachable from Vercel

This is the step people miss. Your deployed app runs on Vercel's servers, and
**they cannot reach your laptop's `localhost`**.

### Quickest: Cloudflare Tunnel

```bash
cloudflared tunnel --url http://localhost:20128
```

Prints a public `https://<random>.trycloudflare.com`. Your `AI_BASE_URL` is
that URL **plus `/v1`**. The hostname changes on restart unless you create a
named tunnel — fine for a demo, not for a hackathon judging window.

### Sturdier: Docker on a VPS

```bash
docker run -d --name 9router -p 20128:20128 \
  -e REQUIRE_API_KEY=true \
  -e NODE_ENV=production \
  -e AUTH_COOKIE_SECURE=true \
  -v ~/.9router:/root/.9router \
  ghcr.io/decolua/9router:latest
```

Put it behind TLS and use `https://your-domain/v1`.

### Free and always-on: Hugging Face Space

9Router's README links a walkthrough. Good middle ground if you have no VPS.

> ⚠️ **Set `REQUIRE_API_KEY=true` on anything internet-facing.** By default
> 9Router does **not** check the bearer token on `/v1/*`. Exposed without it,
> anyone who finds the URL can spend your connected subscriptions.

---

## Current deployment

Configured and live:

```
AI_BASE_URL=http://103.142.21.213:20128/v1
AI_MODEL=cc/claude-sonnet-5
```

Available on that router: `cc/claude-sonnet-5`, `cc/claude-opus-5`,
`cc/claude-fable-5`, `cc/claude-haiku-4-5-20251001`.

> ⚠️ **The endpoint is plain HTTP.** Vercel reaches it fine — server-to-server
> calls have no mixed-content rule — but the API key and every profile answer
> cross the public internet unencrypted, and anyone on the path can read both.
> Put a TLS reverse proxy (Caddy gets you a certificate in one line) or a
> Cloudflare Tunnel in front of it before this handles anyone's real data.

---

## Step 6 — Give me the three values

```
AI_BASE_URL=https://your-public-url/v1
AI_API_KEY=...
AI_MODEL=kr/claude-sonnet-4.5
```

I set them on Vercel and redeploy. Or do it yourself:

```bash
cd web
printf 'https://your-public-url/v1' | vercel env add AI_BASE_URL production
printf 'your-key'                   | vercel env add AI_API_KEY production
printf 'kr/claude-sonnet-4.5'       | vercel env add AI_MODEL production
vercel --prod
```

Confirm:

```bash
curl -s https://blindluv-app.vercel.app/api/config | jq .ai
# configured: true, unreachableFromServerless: false
```

Then every match card is labelled with your model name instead of `Heuristic`.

---

## Local-only alternative

If exposing 9Router is a hassle, run BlindLuv locally against it — the agent
works fully, only the public URL loses it:

```bash
cd web
echo 'AI_BASE_URL=http://localhost:20128/v1' >> .env.local
echo 'AI_API_KEY=your-key'                   >> .env.local
echo 'AI_MODEL=kr/claude-sonnet-4.5'         >> .env.local
npm run dev
```
