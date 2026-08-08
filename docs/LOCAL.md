# Running BlindLuv locally

The goal here is a local setup where **every part works** — including the
on-chain half — and where switching to production later is a config change,
not a rewrite.

The trick is a **fork**. Anvil forks Monad testnet, so the USDC at
`0x534b2f3A21130d7a60830c2Df862319e593943A3` is the *real* Circle contract with
real EIP-3009 behaviour. What the fork adds is money: it can mint MON and USDC
out of thin air. That is what removes the faucet from the critical path — not
by working around the captcha, but by not needing it.

The AI still calls your real 9Router, so the matching you see locally is the
matching you get in production.

---

## Setup

**Prerequisites:** Node 20+, and Foundry (`curl -L https://foundry.paradigm.xyz | bash && foundryup`).

```bash
# terminal 1 — the local chain
cd web
npm run chain:local

# terminal 2 — deploy + fund
npm run setup:local -- 0xYourMetaMaskAddress 0xASecondAddress
```

Pass **two** addresses. Matching needs two profiles, and testing alone with one
wallet means the second one has no USDC when it tries to stake.

The setup script funds each with 1,000,000 MON and 1000 USDC, deploys
`BlindLuv.sol`, authorises the agent, and writes `NEXT_PUBLIC_CHAIN_MODE`,
`NEXT_PUBLIC_LOCAL_RPC_URL` and `NEXT_PUBLIC_BLINDLUV_ADDRESS` into
`web/.env.local`.

Add the AI keys to `web/.env.local` (see [9ROUTER-SETUP.md](9ROUTER-SETUP.md)):

```
AI_BASE_URL=http://103.142.21.213:20128/v1
AI_API_KEY=sk-...
AI_MODEL=cc/claude-sonnet-5
```

Then:

```bash
npm run dev
```

### MetaMask

| Field | Value |
| --- | --- |
| Network name | BlindLuv Local |
| RPC URL | `http://127.0.0.1:8545` |
| Chain ID | `31337` |
| Currency | MON |

The chain id is deliberately **31337, not 10143** — a wallet with both
configured under the same id would silently route transactions to the wrong
network.

---

## Verifying it works

```bash
npm run e2e:local
```

Drives the whole flow as two users and asserts each step:

```
1. profiles              ✓ built by cc/claude-sonnet-5
1b. commitments          ✓ published on-chain
2. discovery             ✓ 1 match, gender filter excluded 1
3. agent opens session   ✓ #5
4. staking               ✓ both staked, session unlocked
5. x402 reveal           ✓ 402 → sign → settle → identity disclosed
6. concierge             ✓ also 402s
7. attendance            ✓ both confirmed, stake returned
                         before=1000.000000  after=999.950000  (only the 0.05 fee)
```

That last line is the whole product in one assertion: the stake came back, and
the only money that moved was the agent's fee.

---

## Freshly funded wallets cannot spend immediately

This one only appears on real Monad, so the fork will never show it to you.

Monad's **reserve balance** puts a 10 MON floor under every EOA, and consensus
budgets a sender's gas against `min(10 MON, lagged_state_balance)` — where the
lagged state trails by three blocks. Fund a new wallet and send from it right
away and you get:

```
Signer had insufficient balance
```

even though the money is provably there:

```
$ cast balance 0x2785… --rpc-url https://testnet-rpc.monad.xyz --block finalized
500000000000000000
```

The balance is visible; the *gas budget* is not yet. So waiting for the receipt
is not enough, and neither is waiting for the balance to appear — the thing to
wait for is **blocks**. `smoke-testnet.mjs` waits four, and retries once more on
the same error, because a three-block window is still a race under load.

The mirror image of the rule is the **emptying transaction** exception: an
undelegated account that has been quiet for three blocks *may* spend below the
reserve. That is the only reason a sweep is possible, and it is what lets the
smoke test return its leftover MON instead of stranding half a MON per run in a
discarded wallet — which matters when the only refill is a captcha-gated faucet.

---

## Two things this surfaced

### EIP-7702 wallets cannot pay via x402 `exact`

USDC validates authorizations with Circle's `SignatureChecker`, which routes
any address **with code** down the EIP-1271 path instead of plain ECDSA. An
EIP-7702-delegated EOA has code. If its delegate does not implement
`isValidSignature` correctly, the transfer reverts with the unhelpful
`FiatTokenV2: invalid signature`.

This is not hypothetical. Anvil's default accounts already carry 7702
delegations **on real Monad testnet** — their keys are public, so anyone could
set them:

```
$ cast code 0x70997970C51812dc3A010C7d01b50e0d17dc79C8 --rpc-url https://testnet-rpc.monad.xyz
0xef01006bd9b71559e3b2013596726a4e2ca1ee97189606
  └─ 0xef0100 = EIP-7702 delegation designator
```

So: **never use Anvil's default keys as test users here.** `e2e-local.mjs`
generates fresh ones. The facilitator now detects this and returns
`payer_has_eip7702_delegation` instead of a mystifying revert.

### Settlement failure must not disclose

Verification runs before the work and settlement after it, so a signature that
verified but could not be broadcast used to still return the identity. That
violates the rule the product rests on. `settleAndRespond` now returns `402`
and withholds the payload when settlement fails — losing the work already done
is the cheaper mistake.

---

## Moving to production

Nothing in the code changes. `NEXT_PUBLIC_CHAIN_MODE` picks the target and
everything else follows from it:

| | Local | Production |
| --- | --- | --- |
| `NEXT_PUBLIC_CHAIN_MODE` | `local` | `testnet` (or unset) |
| Chain | Anvil fork, id 31337 | Monad testnet, id 10143 |
| `NEXT_PUBLIC_BLINDLUV_ADDRESS` | written by the setup script | from the real deploy |
| USDC | same address, forked | same address, real |
| 9Router | same endpoint | same endpoint |
| Store | in-memory | Upstash Redis |
| Explorer links | hidden (a fork has none) | MonadVision |

All four steps are **done** — the contract is live at
[`0xbD32698e…24c64`](https://testnet.monadexplorer.com/address/0xbD32698e3A4E68856d6545CC02823F837AF24c64),
verified, and the deployment runs on Upstash.

### Checking a live deployment

```bash
OPERATOR_PRIVATE_KEY=0x… \
BLINDLUV=0xbD32698e3A4E68856d6545CC02823F837AF24c64 \
APP=https://blindluv-id.vercel.app \
npm run smoke:testnet
```

The production sibling of `e2e:local`. It drives the same flow against the real
contract as far as MON alone allows, then **says which steps it skipped** —
staking and settlement need USDC, and testnet USDC comes from the same
captcha-gated faucet. A smoke test that hid that would be worse than none.

It funds two throwaway wallets from the operator and sweeps them back at the
end, so a run costs about **0.05 MON** rather than the 1 MON it strands
without the sweep.

---

## Troubleshooting

| Symptom | Cause |
| --- | --- |
| `MissingProfile` on "Meet this person" | one side never published their commitment on-chain — step 1 has a "Publish commitment" button |
| `FiatTokenV2: invalid signature` | the payer has an EIP-7702 delegation; use a plain EOA |
| Matches from a previous run appear | the in-memory store persists until the server restarts; `e2e-local.mjs` uses a unique city per run to stay isolated |
| `stake` reverts with `0xe438f8ce` | `AlreadyStaked` — that session already has your stake |
| Everything says "Heuristic" | `AI_BASE_URL` / `AI_API_KEY` / `AI_MODEL` missing; check `/api/config` |
