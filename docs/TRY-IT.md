# Trying BlindLuv on Monad testnet

Everything is live: **<https://blindluv-id.vercel.app>**

You need a wallet, a little MON for gas, and a little USDC for the stake and the
agent's fee. Both are free testnet money.

---

## The one thing to get right about addresses

`0x534b2f3A21130d7a60830c2Df862319e593943A3` is the **USDC token contract**. It
is not a destination — it is the thing that *keeps the ledger* of who holds
USDC.

> **Do not send USDC to it.** Tokens sent to their own token contract are
> unrecoverable. There is no owner to send them back.

When a faucet "sends you USDC", it calls that contract and it credits *your*
address. So the address you care about is your own MetaMask address.

Three addresses appear in this app; only one of them is ever a destination:

| Address | What it is | Send funds to it? |
| --- | --- | --- |
| `0x534b2f…43A3` | the USDC token contract | **never** |
| `0xbD3269…4c64` | BlindLuv's escrow contract | only via the **Stake** button, never by hand |
| `0xeB63Fa…f72f` | the operator wallet (agent + x402 relayer) | only MON, only to keep the service running |

---

## 1. Add the network

In the app, the wallet menu has **Add Monad Testnet to my wallet**. That is the
whole step. To do it by hand:

| Field | Value |
| --- | --- |
| Network name | Monad Testnet |
| RPC URL | `https://testnet-rpc.monad.xyz` |
| Chain ID | `10143` |
| Currency symbol | MON |
| Block explorer | `https://testnet.monadscan.com` |

## 2. Get MON — for gas

<https://faucet.monad.xyz>, claim to your own address. The captcha is an
anti-abuse control; do it in the browser, it takes a few seconds.

You need very little. Publishing a commitment costs about **0.008 MON**.

> Aim above **10 MON** if you can. Monad's
> [reserve balance](https://docs.monad.xyz/developer-essentials/reserve-balance)
> throttles accounts below that to roughly one transaction every 1.2 seconds.
> It still works, it just feels sticky.

## 3. Get USDC — for the stake and the fee

**<https://faucet.circle.com>** — Circle's own faucet, and Monad Testnet is one
of its supported networks. Pick *Monad Testnet*, paste your address, claim.

- **20 USDC** per claim, per address, every 2 hours.
- That is ~130 full runs of this app.

Then add the token to MetaMask so you can see it: **Import tokens** →
`0x534b2f3A21130d7a60830c2Df862319e593943A3` → symbol `USDC`, decimals `6`.

<details>
<summary>If faucet.circle.com will not load for you</summary>

Some Indonesian ISPs (Moratelindo among them) resolve it into the
`trustpositif` filter, so the TLS certificate fails to match and the page never
opens. It is a DNS-level block, not a problem with the faucet.

Switching your DNS to `1.1.1.1` or `8.8.8.8` is usually enough.

</details>

### What it actually costs to run through once

| Step | Cost |
| --- | --- |
| Publish commitment | ~0.008 MON |
| Stake | 0.10 USDC — **returned** when you both confirm attendance |
| x402 reveal fee | 0.05 USDC — kept by the agent |
| Concierge (optional) | 0.02 USDC |

So one full round trip costs **0.05 USDC** and gives the 0.10 back. Under a
tenth of a cent, if this were real money.

---

## 4. Click through it

1. **Connect wallet.** Nothing else on the site works first — your wallet *is*
   your account. No email, no password.
2. **Write your profile.** City, who you are and who you want to meet, your age
   and the ages you want to meet, and a few honest sentences about what you are
   into. The button stays disabled until the required fields are filled, and it
   tells you which are missing.

   Gender and age never reach the AI. They filter who you see, in plain code,
   before the model runs — both mutually, so you are only shown to people whose
   stated preferences include you.
3. **Publish your commitment.** One transaction. It puts a *hash* of your
   profile on Monad — not the profile. This is what lets the contract later
   prove your profile existed at match time without ever having stored it.
4. **See who you match with.** The agent reads both profiles and returns a
   compatibility score with its reasons. No names, no photos, no contact.
5. **Meet this person.** The agent opens a session on-chain, then you both
   stake 0.10 USDC.
6. **Reveal.** Pay 0.05 USDC via x402 — you sign a message, not a transaction,
   so this step needs **no MON at all**. Identity appears only when both of you
   have staked.
7. **Talk.** A chat opens under the revealed identity. Sign once to enter — it
   proves you own the wallet, costs nothing, and is what makes the sender of a
   message something the server *knows* rather than something the client claims.
   See [CHAT.md](CHAT.md).
8. **Confirm attendance.** Both confirm, both stakes come back.

Once you stake, the app asks whether it may send notifications. It uses that for
exactly two things — the other side staking, and a reply arriving — and only
when the tab is in the background.

---

## Troubleshooting

| Symptom | Cause |
| --- | --- |
| "Create my profile" is greyed out | a required field is empty — the line under the button names it |
| Wrong-network banner | your wallet is not on chain 10143; use the switch button in the header |
| Connect does nothing | reload after installing MetaMask — the wallet injects itself at page load |
| `MissingProfile` when opening a session | one side skipped step 3; commitments must be on-chain first |
| `FiatTokenV2: invalid signature` on reveal | the paying wallet has an EIP-7702 delegation — use a plain EOA |
| Everything is labelled `Heuristic` | the AI gateway is unreachable; check `/api/config` |

`GET /api/config` is the honest answer to "is this thing actually working":

```bash
curl -s https://blindluv-id.vercel.app/api/config
```

```json
{ "contract": "0xbD32698e3A4E68856d6545CC02823F837AF24c64",
  "capabilities": { "aiAgent": true, "x402Settlement": true, "onchainAgent": true },
  "stats": { "backend": "kv" } }
```
