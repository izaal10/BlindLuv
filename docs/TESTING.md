# Testing BlindLuv on Monad Testnet

Everything here uses testnet money. Use a throwaway wallet anyway.

---

## 1. Connect MetaMask

Open <https://blindluv-app.vercel.app> and click **Connect wallet**. You get a
picker listing every wallet the browser exposes, not a guess at one.

If the list is empty, no wallet extension is installed — install
[MetaMask](https://metamask.io/download/) and **reload the page**. Extensions
announce themselves at page load, so a wallet installed in another tab will not
appear until you refresh.

### Add Monad Testnet

The same picker has **"Add Monad Testnet to my wallet"**. Click it and approve —
that is usually all you need, and it works before connecting.

Manual entry, if you prefer:

| Field | Value |
| --- | --- |
| Network name | Monad Testnet |
| RPC URL | `https://testnet-rpc.monad.xyz` |
| Chain ID | `10143` |
| Currency symbol | `MON` |
| Block explorer | `https://testnet.monadexplorer.com` |

Once connected on the wrong network, a gold **Switch to Monad Testnet** button
appears in the header.

### If connecting still fails

| Symptom | Cause |
| --- | --- |
| Button does nothing, no popup | MetaMask popup was suppressed — open the extension manually; there is usually a pending request |
| "Connector not found" | Wallet installed after the page loaded. Reload |
| Connects, then drops on refresh | Was a real bug (SSR state was not persisted); fixed with cookie storage. Hard-reload once to clear the old state |
| Wrong account connects | MetaMask → Connected sites → disconnect this site, then reconnect |

Errors are now printed in a red bar under the header rather than swallowed, so
whatever goes wrong should tell you what it was.

---

## 2. Get testnet MON

You need MON for gas on every on-chain action.

- <https://faucet.monad.xyz> — paste your address, solve the captcha

Balances below **10 MON** are throttled to one transaction per ~1.2 seconds by
Monad's [reserve balance](https://docs.monad.xyz/developer-essentials/reserve-balance)
rule. It still works, just slowly — take more than 10 MON if the faucet allows.

Check it:

```bash
cast balance 0xYourAddress --rpc-url https://testnet-rpc.monad.xyz
```

---

## 3. Get testnet USDC

Stakes and x402 fees are paid in Circle USDC:

```
0x534b2f3A21130d7a60830c2Df862319e593943A3   (6 decimals)
```

Add it in MetaMask → **Import tokens** → paste that address.

You need very little: the default reveal fee is `0.05 USDC`, the concierge
`0.02`, and the stake `0.10` per side. Under half a dollar covers a full run.

---

## 4. What works right now, and what does not

The status panel on the landing page is the source of truth — it reads the live
server config on every load.

| Step | Works today? |
| --- | --- |
| 01 Connect wallet | ✅ |
| 02 Write a blind profile | ✅ (labelled `Heuristic` until 9Router is set) |
| 02 Publish commitment on-chain | ⛔ needs the contract deployed |
| 03 Blind discovery | ✅ |
| 04 Agent opens a session | ⛔ needs the contract + `AGENT_PRIVATE_KEY` |
| 05 Stake USDC | ⛔ needs the contract |
| 06 x402 reveal | ⚠️ emits a correct `402`; settling needs `FACILITATOR_PRIVATE_KEY` |
| 07 Concierge | ⚠️ same |

So today you can connect, write a profile, and see the agent score a match.
The on-chain half turns on the moment the contract is deployed — see
[DEPLOYMENT.md](DEPLOYMENT.md).

### Seeing a match at all

Discovery needs **two profiles in the same city**. Create one, then switch to a
second MetaMask account, reload, and create another with the same city. Then
click **Find matches**.

> ⚠️ Until Upstash Redis is connected, profiles live in one serverless
> instance's memory — your two profiles can land on different instances and
> never see each other. The status panel warns when this is the case.

---

## 5. Checking the API directly

```bash
APP=https://blindluv-app.vercel.app

curl -s $APP/api/config | jq '{ai, capabilities, stats}'

curl -s -X POST $APP/api/profile -H 'Content-Type: application/json' -d '{
  "address":"0x1111111111111111111111111111111111111111",
  "city":"Jakarta","likes":"coffee, hiking, blockchain",
  "dislikes":"smoking","conversationStyle":"direct",
  "displayName":"Alice","contact":"@alice"}' | jq

# should be 402 with payment requirements
curl -s -X POST $APP/api/reveal -H 'Content-Type: application/json' \
  -d '{"address":"0x1111111111111111111111111111111111111111","matchId":"<id>"}' | jq
```

The x402 signature path can be exercised end to end against live Monad without
spending anything:

```bash
cd web && node scripts/x402-probe.mjs <matchId>
```

A valid signature from an empty wallet returns `insufficient_funds` — meaning
the signature verified and only the on-chain balance check failed.
