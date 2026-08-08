# BlindLuv

**Match anonymously. Commit economically. Meet in person.**

An autonomous privacy dating agent on Monad. An AI matchmaker scores compatibility
from what people actually wrote — never a photo — x402 charges its fee over plain
HTTP, and Monad holds a mutual stake that turns a blind match into an economic
commitment. Identity stays hidden until **both** sides have paid.

Built with [monskills](https://skills.devnads.com). AI routed through
[9Router](https://9router.com).

**Live:** <https://blindluv-app.vercel.app>
· <https://blindluv-monad.vercel.app>
· <https://blindluv-x402.vercel.app>

| Doc | What's in it |
| --- | --- |
| [docs/TESTING.md](docs/TESTING.md) | **start here** — connect MetaMask, add Monad Testnet, get MON and USDC |
| [docs/9ROUTER-SETUP.md](docs/9ROUTER-SETUP.md) | **getting your API key**, step by step |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | how the pieces fit, what's on-chain vs off-chain, the contract API |
| [docs/9ROUTER.md](docs/9ROUTER.md) | how the agent talks to the gateway, and why it is built defensively |
| [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) | Vercel, Monad contract deploy, explorer verification |
| [docs/X402.md](docs/X402.md) | the payment protocol, and why the facilitator is self-hosted |

---

## The idea in one rule

> No payment, no disclosure — and one person's payment is never enough.

Two independent gates guard every reveal:

1. **x402** — the caller paid the agent's service fee (`HTTP 402` → `X-PAYMENT` → settle).
2. **Monad** — both participants staked, so the session is `Active` on-chain.

Paying alone reveals nothing. That asymmetry is the whole product: nobody can buy
their way to another person's contact details.

---

## Architecture at a glance

```
                    User A                          User B
                      │                               │
                 wallet connect                  wallet connect
                      │                               │
                      ▼                               ▼
              ┌───────────────────────────────────────────┐
              │  Next.js dApp  (wagmi v3 · viem)          │
              └───────────────┬───────────────────────────┘
                              │  free text
                              ▼
              ┌───────────────────────────────────────────┐
              │  AI Match Agent → 9Router → Claude Sonnet │
              │   interest vector · compatibility · why   │
              │   never sees a photo, name, or age        │
              └───────────────┬───────────────────────────┘
                              │  score + reasons, identity withheld
                              ▼
              ┌───────────────────────────────────────────┐
              │  x402 gate      HTTP 402 Payment Required │
              │   EIP-3009 signature · no MON needed      │
              └───────────────┬───────────────────────────┘
                              │  facilitator broadcasts
                              ▼
              ┌───────────────────────────────────────────┐
              │  Monad Testnet  ·  BlindLuv.sol           │
              │   commitment · score · mutual USDC stake  │
              └───────────────┬───────────────────────────┘
                              │  both staked
                              ▼
                     identity · chat · venue
```

---

## Quick start

```bash
# contracts
cd contracts
forge test                       # 18 passing

# web
cd ../web
cp .env.example .env.local       # every value is optional
npm install
npm run dev
```

The app boots with **no configuration at all**. The status panel on the landing
page names exactly which capabilities are live and which are switched off, so a
half-configured deployment never pretends to be a whole one.

| Missing | Effect |
| --- | --- |
| `AI_BASE_URL` / `AI_API_KEY` / `AI_MODEL` | matching falls back to the deterministic scorer; every card is labelled `Heuristic` |
| `NEXT_PUBLIC_BLINDLUV_ADDRESS` | on-chain steps disabled |
| `AGENT_PRIVATE_KEY` | the agent cannot open sessions |
| `FACILITATOR_PRIVATE_KEY` | x402 payments verify but cannot settle |

### Trying the agent without a real gateway

```bash
node scripts/mock-9router.mjs 20128        # terminal 1
AI_BASE_URL=http://localhost:20128/v1 \
AI_API_KEY=test AI_MODEL=cc/claude-sonnet-4-6 npm run dev   # terminal 2
```

The mock deliberately wraps its replies in ``` fences and leading prose, because
that is what gateway-routed models actually do — it exercises the defensive JSON
extractor rather than a happy path.

---

## Repository layout

```
contracts/            Foundry project
  src/BlindLuv.sol      commitments + date-session escrow
  test/BlindLuv.t.sol   18 tests, incl. a stake round-trip fuzz
  script/Deploy.s.sol   deploy script
web/                  Next.js 16 app (App Router)
  src/lib/ai/           agent · 9Router client · deterministic fallback
  src/lib/x402/         x402 types, self-hosted facilitator, client payer
  src/app/api/          profile · discover · session · reveal · concierge · models
  scripts/              mock 9Router · live x402 probe
docs/                 the four guides linked at the top
```

---

## The one design rule about the AI

The agent is given **only** stated interests, values, and conversation style. It
never receives a photo, a name, or an age, because the server never sends one.
Scoring people on appearance is both the obvious thing to build and the thing
most likely to encode bias, so the capability simply is not wired up.

The system prompt also pushes for honesty over flattery: mediocre matches are
supposed to land in the 40s, and scores above 85 are reserved for real overlap.
A matchmaker that tells everyone they are a 95% match is not a matchmaker.

---

## Status

| Component | State |
| --- | --- |
| `BlindLuv.sol` | complete · 18/18 tests passing |
| AI agent via 9Router + deterministic fallback | complete · verified against a mock gateway, incl. failure path |
| x402 facilitator | complete · verified against live Monad testnet |
| Frontend (7-step flow) | complete · typechecks, lints and builds clean |
| Vercel deployment | **live and public** at the URLs above |
| Monad contract deployment | **pending** — needs testnet MON in the operator wallet |
| 9Router endpoint | **pending** — needs a publicly reachable instance + key |
| KV persistence | **pending** — connect Upstash Redis, see [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) |
| Indexer (activity feed) | not started |

### What still needs you

Three things, each independent. The app runs and is honest about all three.

| # | Blocker | Why I can't do it |
| --- | --- | --- |
| 1 | Testnet MON in `0xeB63Fa41DFf47C09D68E2Ad3582299F81da5f72f` | the Monad faucet is captcha-gated |
| 2 | A public 9Router URL + API key | 9Router is software you host; there is no hosted API to point at |
| 3 | Upstash Redis connected in Vercel | provisioning now goes through an interactive Marketplace OAuth flow |
