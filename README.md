# BlindLuv

**Match anonymously. Commit economically. Meet in person.**

An autonomous privacy dating agent on Monad. An AI matchmaker scores compatibility
from what people actually wrote — never a photo — x402 charges its fee over plain
HTTP, and Monad holds a mutual stake that turns a blind match into an economic
commitment. Identity stays hidden until **both** sides have paid.

Built with [monskills](https://skills.devnads.com). AI routed through
[9Router](https://9router.com).

**Live:** <https://blindluv-id.vercel.app>
· <https://blind-luv.vercel.app>
· <https://blindluv-app.vercel.app>
· <https://blindluv-dating.vercel.app>
· <https://blindluv-ai.vercel.app>
· <https://getblindluv.vercel.app>
· <https://blindluv-testnet.vercel.app>
· <https://blindluv-monad.vercel.app>
· <https://blindluv-x402.vercel.app>

`blindluv.vercel.app` itself is held by a **different Vercel account**
(`nandobalam's projects`) and cannot be claimed from this login — see
[docs/DEPLOYMENT.md](docs/DEPLOYMENT.md#claiming-blindluvvercelapp).

| Doc | What's in it |
| --- | --- |
| [docs/TRY-IT.md](docs/TRY-IT.md) | **start here to use it** — wallet, network, getting MON and USDC, the whole click-through |
| [docs/WHY-MONAD.md](docs/WHY-MONAD.md) | what the chain is actually doing here, and what would break on Ethereum |
| [docs/LOCAL.md](docs/LOCAL.md) | run everything locally on a Monad fork, no faucet needed |
| [docs/TESTING.md](docs/TESTING.md) | connect MetaMask, add Monad Testnet, get MON and USDC |
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

## Live addresses

| | |
| --- | --- |
| `BlindLuv.sol` | [`0xbD32698e3A4E68856d6545CC02823F837AF24c64`](https://testnet.monadscan.com/address/0xbD32698e3A4E68856d6545CC02823F837AF24c64) · source verified |
| Chain | Monad Testnet · `10143` |
| USDC | [`0x534b2f3A21130d7a60830c2Df862319e593943A3`](https://testnet.monadscan.com/address/0x534b2f3A21130d7a60830c2Df862319e593943A3) — Circle `FiatTokenV2_2`, **a token contract, never a destination** |
| Model | `cc/claude-sonnet-5` via self-hosted 9Router |

Free testnet money: **MON** from <https://faucet.monad.xyz>, **USDC** from
<https://faucet.circle.com> (20 per address every 2 hours, Monad Testnet is
supported). Full walkthrough in [docs/TRY-IT.md](docs/TRY-IT.md).

---

## Quick start

```bash
# everything working locally, including the on-chain half
cd web && npm install
npm run chain:local                                    # terminal 1
npm run setup:local -- 0xYourWallet 0xSecondWallet     # terminal 2
npm run dev
npm run e2e:local                                      # asserts the whole flow
```

Anvil forks Monad testnet, so USDC is the real contract with real EIP-3009 —
the fork just adds money, which removes the captcha-gated faucet from the
critical path. Full walkthrough in [docs/LOCAL.md](docs/LOCAL.md).

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
                        e2e-local.mjs   full flow on a fork, 18 assertions
                        smoke-testnet.mjs  live deployment, 22 assertions
docs/                  the guides linked at the top
```

---

## What Monad is actually doing

The chain holds the three things that must be neither trusted nor forgeable:

1. **The stake** — an escrow you have to trust is not an escrow. There is no
   admin function that can move a staked USDC.
2. **The commitment** — a salted hash of your profile, which proves it existed
   at match time while revealing nothing about it.
3. **The unlock condition** — `isUnlocked(sessionId)` is only true once *both*
   sides staked, so nobody can buy their way to another person's contact.

Matching, profiles and identity are all off-chain, deliberately.
[docs/WHY-MONAD.md](docs/WHY-MONAD.md) has the full argument, including the
three Monad behaviours that each produced a bug before they produced a fix.

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
| x402 facilitator | complete · verified against live Monad testnet |
| Frontend (7-step flow) | complete · typechecks, lints and builds clean |
| Vercel deployment | **live and public** — 9 aliases, all on the same production build |
| AI agent | **live** — Claude Sonnet 5 (`cc/claude-sonnet-5`) via self-hosted 9Router, smoke-tested in production |
| Monad contract deployment | **live** — [`0xbD32698e…24c64`](https://testnet.monadscan.com/address/0xbD32698e3A4E68856d6545CC02823F837AF24c64), verified on Monadscan + Sourcify |
| KV persistence | **live** — Upstash Redis; `/api/config` reports `backend: "kv"` |
| Indexer (activity feed) | not started — the only thing in the original design that is not built |

Two test suites, and they cover different halves:

```bash
npm run e2e:local        # 18 assertions — the WHOLE flow, incl. staking and x402 settlement
npm run smoke:testnet    # 22 assertions — the LIVE deployment, as far as MON alone reaches
```

`smoke:testnet` deliberately reports staking and settlement as **skipped**
rather than passing them: those need USDC in the generated wallets. It says so
in its output instead of quietly stopping short.

### Progress log

| Done | What |
| --- | --- |
| ✅ | `BlindLuv.sol` — commitments, session escrow, mutual stake, attendance settlement · 18/18 tests |
| ✅ | Storage packed into 4 slots, because Monad's cold SLOAD is 8,100 gas not 2,100 |
| ✅ | Hand-rolled x402 v1 wire format — the SDK has no Monad network |
| ✅ | Self-hosted x402 facilitator with six-condition verification |
| ✅ | AI matchmaker on Claude Sonnet 5 via 9Router, deterministic scorer as fallback |
| ✅ | Gender + "who you want to meet" as a hard filter **before** the model, in plain code |
| ✅ | 4-step wizard, wallet-gated, EIP-6963 multi-wallet discovery |
| ✅ | Local Anvil fork of Monad testnet — real USDC, minted money, no faucet |
| ✅ | `NEXT_PUBLIC_CHAIN_MODE` switches local ↔ testnet with no code change |
| ✅ | Deployed and verified on Monad testnet |
| ✅ | Upstash Redis, so serverless instances share profiles |
| ✅ | Vercel production, 9 aliases |
| ⬜ | Envio indexer for a public activity feed |

### Bugs found and fixed along the way

| | |
| --- | --- |
| Settlement failure still disclosed identity | verify runs before the work, settle after — a payment that verified but failed to broadcast handed over the identity for free. `settleAndRespond` now returns 402 and withholds the payload |
| EIP-7702 payers got `FiatTokenV2: invalid signature` | USDC routes any address *with code* down EIP-1271. The facilitator now detects delegation up front and says so |
| Serverless instances did not share profiles | confirmed live (`0 profiles` right after creating two), fixed with the KV adapter |
| Freshly funded wallets could not spend | Monad budgets gas against 3-block-lagged state; wait for blocks, not receipts |
| "Switch to Monad Testnet" shown in local mode | the app wanted chain 31337 — the message named the one network that would not work. All network copy now reads `CHAIN_LABEL` |
| "Create my profile" was dead with no explanation | two required fields are easy to miss; the button now names what is missing |

### What still needs you

| # | Item | Why |
| --- | --- | --- |
| 1 | Claim testnet USDC from <https://faucet.circle.com> | needed for staking and the x402 fee — 20 USDC covers ~130 runs |
| 2 | Rotate the 9Router API key *eventually* | it was briefly readable in this public repo. Fine for testing; not fine if this ever holds real credit |
