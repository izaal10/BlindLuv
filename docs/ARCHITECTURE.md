# Architecture

## What goes on-chain, and what deliberately does not

| On-chain (Monad) | Off-chain (server) |
| --- | --- |
| `sessionId`, both addresses | names, photos, ages |
| AI compatibility score (`uint8`) | raw free-text answers |
| `profileCommitment` — keccak256 hash | the AI interest vector |
| `matchProof` — keccak256 hash | chat history, contact details |
| stake amount, status, deadlines | venue suggestions |

The two hashes are the hinge. `profileCommitment` is
`keccak256(traits ‖ interests ‖ dealBreakers ‖ city ‖ salt)` with the salt held
server-side; `matchProof` binds a score to both commitments. Together they let
anyone verify later that a match really was computed over the profiles it
claims — without those profiles ever being public.

---

## The seven-step flow

| # | Step | Where it happens |
| --- | --- | --- |
| 01 | Connect wallet | client — wallet is the only identity primitive |
| 02 | Write a blind profile → agent builds an interest vector → publish commitment | server (9Router) + Monad |
| 03 | Blind discovery — score, reasons, shared interests, no identity | server (9Router) |
| 04 | The agent opens a date session on Monad | agent wallet → Monad |
| 05 | Both sides stake USDC | Monad |
| 06 | `HTTP 402` → sign EIP-3009 → facilitator settles → identity revealed | x402 + Monad |
| 07 | Concierge proposes venues (second, cheaper x402 call) | server (9Router) |

---

## Contract API

`contracts/src/BlindLuv.sol`

| Function | Who | What |
| --- | --- | --- |
| `commitProfile(bytes32)` | anyone | publish/rotate your profile commitment |
| `revokeProfile()` | anyone | withdraw from matching |
| `openSession(...)` | authorised agent | record a match: score, proof, stake |
| `stake(uint256)` | participant | lock your half; the second stake unlocks |
| `confirmAttendance(uint256)` | participant | both confirm → both refunded in full |
| `settle(uint256)` | anyone | after the window: attendee claims a no-show's stake |
| `cancelExpired(uint256)` | anyone | rescue a stake when the other side never paid |

### Session lifecycle

```
        openSession()                stake() ×2
None ──────────────► Pending ──────────────────► Active
                        │                          │
                        │ cancelExpired()          ├── confirmAttendance() ×2 ─► Completed  (both refunded)
                        ▼                          │
                    Cancelled                      ├── settle(), one confirmed ─► Forfeited  (attendee takes both)
                    (refunded)                     │
                                                   └── settle(), none confirmed ─► Cancelled (both refunded)
```

The stake is a commitment device, not a fee. Show up and you get all of it back.
A mutual no-show refunds both — nobody's fault to profit from.

---

## Monad-specific engineering notes

**Gas is charged on the limit, not on usage.** An inflated estimate is money out
of the user's pocket. Every write path calls `estimateContractGas` against live
state and adds at most 10%, capped by a measured ceiling in
`web/src/lib/chain.ts`.

**Cold state access costs ~4× Ethereum** (SLOAD 8,100 vs 2,100; account access
10,100 vs 2,600). `Session` is packed into four slots:

```
slot 0  userA (160) │ score (8) │ status (8) │ 4 bools (32)
slot 1  userB (160) │ stakeAmount uint96 (96)          ← exactly 256 bits
slot 2  matchProof (bytes32)
slot 3  stakeDeadline (64) │ attendanceDeadline (64) │ agent (160)
```

Every external function reads each slot at most once.

**`eth_sendRawTransactionSync`.** Writes use wagmi's `useWriteContractSync`, so
the receipt arrives in the same call instead of a submit-then-poll round trip —
worth doing on a chain with 400ms blocks and 800ms finality.

**Block tags.** Reads that must reflect a stake the user just sent use `latest`
(the speculatively-executed head). Monad's execution lags consensus by three
blocks, but `eth_call` simulates against speculative state, so `latest` is both
fast and accurate here.

**Reserve balance.** Accounts below 10 MON are limited to one transaction per
~1.2s. Fine for a demo; fund the operator wallet above 10 MON if you plan to
fire transactions in quick succession.

---

## Measured gas (Ethereum pricing, from `forge test --gas-report`)

| Function | Median | Max |
| --- | ---: | ---: |
| `commitProfile` | 45,488 | 45,488 |
| `openSession` | 151,676 | 151,676 |
| `stake` | 58,915 | 70,941 |
| `confirmAttendance` | 33,417 | 56,399 |
| `settle` | 46,924 | 53,960 |

Monad's cold-access surcharge pushes real costs higher, which is why the
frontend estimates against live state rather than trusting these numbers. The
ceilings in `chain.ts` exist only to catch a runaway estimate.

---

## Off-chain store

`web/src/lib/store.ts` is an in-memory `Map`, on purpose: it holds raw profile
answers, the interest vector, and contact details — exactly the data that must
not be public — and resetting on restart makes that boundary obvious during a
demo.

**Before this touches a real person's data**, swap it for Postgres with
per-user encryption at rest. On Vercel this also matters operationally:
serverless instances do not share memory, so profiles created on one instance
are invisible to another. It is fine for a single-session demo and wrong for
production.
