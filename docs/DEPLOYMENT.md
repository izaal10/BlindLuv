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

### Why you want KV

`web/src/lib/store.ts` holds profiles off-chain. Without KV it uses an
in-process `Map` — and **serverless instances do not share memory**, so two
users can land on different instances and never see each other's profiles.

Fix it in one step: Vercel dashboard → **Storage → Create → Upstash Redis**, then
"Connect to Project". Vercel injects `KV_REST_API_URL` and `KV_REST_API_TOKEN`
automatically and the store switches over with no code change. Confirm with:

```bash
curl -s https://your-app.vercel.app/api/config | jq .stats.backend   # "kv"
```

Records carry a 7-day TTL (`KV_TTL_SECONDS`) so a public demo does not
accumulate personal data indefinitely.

### The localhost trap

A Vercel function cannot reach `http://localhost:20128`. If `AI_BASE_URL` points
at loopback, `/api/config` returns `unreachableFromServerless: true` and the
status panel says so — matching silently falls back to the heuristic scorer
rather than erroring. Expose 9Router publicly first.

---

## 2. Monad testnet contract

### Fund the operator wallet

Deployment needs testnet MON. The public faucet is captcha-gated, so this step
cannot be automated:

- <https://faucet.monad.xyz> — paste the operator address
- Accounts under 10 MON are throttled to one transaction per ~1.2s
  ([reserve balance](https://docs.monad.xyz/developer-essentials/reserve-balance)),
  so fund above 10 MON if you plan to fire transactions back to back.

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

---

## 3. Getting test USDC

Stakes and x402 fees are paid in Circle USDC on Monad testnet
(`0x534b2f3A21130d7a60830c2Df862319e593943A3`, 6 decimals). Users need a small
balance; the facilitator and agent wallets need MON for gas but never hold user
funds.

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
