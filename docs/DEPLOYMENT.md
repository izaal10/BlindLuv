# Deployment

Three independent things get deployed. None of them blocks the others — the app
runs with all of them missing and tells you what is off.

1. **The web app** → Vercel
2. **The contract** → Monad testnet
3. **9Router** → wherever you like (see [9ROUTER.md](9ROUTER.md))

---

## 1. Vercel

The project root is `web/`. From the repo root:

```bash
cd web
vercel --prod
```

Or connect the GitHub repo in the Vercel dashboard and set **Root Directory** to
`web`.

### Claiming `blindluv.vercel.app`

The bare `blindluv.vercel.app` subdomain is **already assigned to another Vercel
account**, so it cannot be added from this one:

```json
{"error":{"code":"owned-on-other-team","domain":"blindluv.vercel.app",
 "message":"Cannot add blindluv.vercel.app since it's already assigned to another project.",
 "teamName":"nandobalam's projects"}}
```

`.vercel.app` subdomains are globally unique and there is no transfer flow, so
freeing it means logging into **that** account and removing the domain from the
project holding it (Project → Settings → Domains → Remove), or deleting that
project outright. Once released:

```bash
cd web
vercel domains add blindluv.vercel.app
vercel alias set <latest-deployment-url> blindluv.vercel.app
```

Until then the app is served on the nine aliases listed in the
[README](../README.md), all pointing at the same production deployment.

### Environment variables

Set these in **Project → Settings → Environment Variables**. Everything is
optional; each missing group just switches a capability off.

| Variable | Scope | Notes |
| --- | --- | --- |
| `AI_BASE_URL` | server | Must be a **public HTTPS URL**, not localhost — see below |
| `AI_API_KEY` | server | From your 9Router dashboard |
| `AI_MODEL` | server | e.g. `cc/claude-sonnet-4-6`; find yours via `/api/models` |
| `NEXT_PUBLIC_BLINDLUV_ADDRESS` | build | From the contract deploy |
| `NEXT_PUBLIC_MONAD_RPC_URL` | build | Defaults to the public RPC |
| `AGENT_PRIVATE_KEY` | server | Agent wallet; needs testnet MON |
| `FACILITATOR_PRIVATE_KEY` | server | x402 relayer; needs testnet MON |
| `AGENT_WALLET_ADDRESS` | server | Where x402 fees land |
| `KV_REST_API_URL` / `KV_REST_API_TOKEN` | server | **Recommended** — see below |

```bash
# non-interactive
printf 'https://ai.example.com/v1' | vercel env add AI_BASE_URL production
printf 'sk_your_key'               | vercel env add AI_API_KEY production
printf 'cc/claude-sonnet-4-6'      | vercel env add AI_MODEL production
vercel --prod            # redeploy so the new values take effect
```

> `NEXT_PUBLIC_*` values are inlined at build time, so changing one requires a
> redeploy, not just a restart.

### Connecting Upstash Redis (do this before demoing)

`web/src/lib/store.ts` holds profiles off-chain. Without Redis it falls back to
an in-process `Map` — and **serverless instances do not share memory**, so two
people can land on different instances and never see each other's profiles.
This is the single most likely thing to make a live demo look broken.

Either route works; the code accepts both naming conventions.

**Route A — Upstash console** (you already have an account):

1. <https://console.upstash.com/redis> → **Create Database**
2. Name it `blindluv`, pick the region nearest your Vercel region, Free tier
3. Open the database → **REST API** tab → copy `UPSTASH_REDIS_REST_URL` and
   `UPSTASH_REDIS_REST_TOKEN`
4. Set them on Vercel:

```bash
cd web
printf 'https://xxx.upstash.io' | vercel env add UPSTASH_REDIS_REST_URL production
printf 'AXXXaSJ...'             | vercel env add UPSTASH_REDIS_REST_TOKEN production
vercel --prod                    # env vars only apply to a new deployment
```

**Route B — Vercel Marketplace**: Vercel dashboard → **Storage → Create →
Upstash Redis → Connect to Project**. Vercel injects `KV_REST_API_URL` and
`KV_REST_API_TOKEN` itself; just redeploy.

Confirm:

```bash
curl -s https://blindluv-app.vercel.app/api/config | jq .stats.backend   # "kv"
```

Records carry a 7-day TTL (`KV_TTL_SECONDS`) so a public demo does not
accumulate personal data indefinitely. The free tier is far more than this
needs — a profile is well under a kilobyte.

### The localhost trap

A Vercel function cannot reach `http://localhost:20128`. If `AI_BASE_URL` points
at loopback, `/api/config` returns `unreachableFromServerless: true` and the
status panel says so — matching silently falls back to the heuristic scorer
rather than erroring. Expose 9Router publicly first.

---

## 2. Monad testnet contract

> **Already done.** `BlindLuv` is live at
> [`0xbD32698e3A4E68856d6545CC02823F837AF24c64`](https://testnet.monadscan.com/address/0xbD32698e3A4E68856d6545CC02823F837AF24c64),
> source-verified on Monadscan and MonadVision, with the agent authorised at
> construction. The rest of this section is what to repeat for a fresh deploy.

### Fund the operator wallet

Deployment needs testnet MON in
`0xeB63Fa41DFf47C09D68E2Ad3582299F81da5f72f`.

**The faucet captcha is not really the obstacle — you probably don't need the
faucet at all.** The captcha is an anti-abuse control and shouldn't be worked
around, but there is a simpler path: if your own MetaMask already holds testnet
MON, just send some across. It is the same testnet money.

```
MetaMask → Monad Testnet → Send
  to:     0xeB63Fa41DFf47C09D68E2Ad3582299F81da5f72f
  amount: 15 MON
```

That covers the contract deploy, `setAgent`, and a long run of agent sessions
and x402 settlements.

If your wallet is also empty, claim once in the browser — the captcha only
blocks scripts, not you:

- <https://faucet.monad.xyz> — claim to **your own** address, then forward
- Alternatives if it is rate-limited: the Monad Discord `#faucet` channel, or
  any of the third-party Monad testnet faucets

**Aim above 10 MON.** Below that, Monad's
[reserve balance](https://docs.monad.xyz/developer-essentials/reserve-balance)
rule throttles an account to one transaction per ~1.2s, which makes the agent
feel broken when it opens sessions back to back.

Check it landed:

```bash
cast balance 0xeB63Fa41DFf47C09D68E2Ad3582299F81da5f72f \
  --rpc-url https://testnet-rpc.monad.xyz
```

```bash
export PATH="$HOME/.foundry/bin:$PATH"
cast balance $OPERATOR --rpc-url https://testnet-rpc.monad.xyz
```

### Deploy

```bash
cd contracts
export PK=0x...                       # operator private key
export AGENT_ADDRESS=0x...            # the AI agent's wallet
export OWNER_ADDRESS=0x...            # admin

forge script script/Deploy.s.sol:Deploy \
  --rpc-url monad_testnet --broadcast --private-key $PK
```

Authorise the agent and wire the frontend:

```bash
cast send $BLINDLUV "setAgent(address,bool)" $AGENT_ADDRESS true \
  --rpc-url monad_testnet --private-key $PK

printf "$BLINDLUV" | vercel env add NEXT_PUBLIC_BLINDLUV_ADDRESS production
vercel --prod
```

### Verify on all three explorers with one call

```bash
cd contracts
forge verify-contract $BLINDLUV src/BlindLuv.sol:BlindLuv \
  --chain 10143 --show-standard-json-input > /tmp/standard-input.json
jq '.metadata' out/BlindLuv.sol/BlindLuv.json > /tmp/metadata.json

ARGS=$(cast abi-encode "constructor(address,address,uint96,address)" \
  0x534b2f3A21130d7a60830c2Df862319e593943A3 $AGENT_ADDRESS 10000 $OWNER_ADDRESS)

jq -n --slurpfile si /tmp/standard-input.json --slurpfile fm /tmp/metadata.json \
  --arg addr "$BLINDLUV" --arg args "${ARGS#0x}" '{
    chainId: 10143,
    contractAddress: $addr,
    contractName: "src/BlindLuv.sol:BlindLuv",
    compilerVersion: "v0.8.28+commit.7893614a",
    standardJsonInput: $si[0],
    foundryMetadata: $fm[0],
    constructorArgs: $args
  }' > /tmp/verify.json

curl -X POST https://agents.devnads.com/v1/verify \
  -H "Content-Type: application/json" -d @/tmp/verify.json
```

This covers MonadVision, Socialscan and Monadscan in one request — prefer it
over `forge verify-contract` against a single explorer.

`jq` is not always installed; the payload is plain JSON, so building it in
Python works just as well. A `partial match` from MonadVision alongside a
`Pass - Verified` from Monadscan is the normal result when Sourcify already
holds a runtime match for the same address.

---

## 3. Getting test USDC

Stakes and x402 fees are paid in Circle USDC on Monad testnet
(`0x534b2f3A21130d7a60830c2Df862319e593943A3`, 6 decimals).

**<https://faucet.circle.com>** — Circle's own faucet, Monad Testnet is a
supported network. 20 USDC per address every 2 hours, which is ~130 full runs.

> That address is the **token contract**, not a destination. Sending USDC to it
> destroys the tokens — there is no owner who can return them. A faucet does not
> send *to* it; it calls it, and it credits *you*.

Users need a small balance. The facilitator and agent wallets need MON for gas
but never hold user funds.

---

## Post-deploy checklist

```bash
APP=https://your-app.vercel.app

curl -s $APP/api/config | jq '{ai, capabilities, stats}'
curl -s $APP/api/models | jq '.sonnet'
curl -s $APP/api/x402/facilitator/supported | jq '.settlement'

# 402 challenge should come back with payment requirements
curl -s -X POST $APP/api/reveal -H 'Content-Type: application/json' \
  -d '{"address":"0x1111111111111111111111111111111111111111","matchId":"x"}' | jq
```

A green run looks like: `ai.configured: true` with a non-loopback host,
`stats.backend: "kv"`, `settlement.available: true`, and a `402` carrying
`accepts[0]`.

### Or run the whole thing

```bash
cd web
OPERATOR_PRIVATE_KEY=0x… \
BLINDLUV=0xbD32698e3A4E68856d6545CC02823F837AF24c64 \
APP=https://blindluv-id.vercel.app \
npm run smoke:testnet
```

22 assertions against the live deployment: config, AI matching with the gender
filter, real on-chain commitments, the agent opening a session, and the x402
challenge. Staking and settlement are **reported as skipped** — they need USDC,
which you can claim at <https://faucet.circle.com> — so read the output, not
just the exit code. Those three are covered end-to-end by `npm run e2e:local`
against the same contract on a fork.

The script funds two throwaway wallets from the operator and sweeps them back,
so a run costs ~0.05 MON. Expect it to pause a couple of seconds after funding:
see [LOCAL.md](LOCAL.md#freshly-funded-wallets-cannot-spend-immediately) for why
a wallet with a visible balance still cannot spend yet.
