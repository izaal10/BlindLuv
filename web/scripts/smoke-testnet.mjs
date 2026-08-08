/**
 * Smoke-tests the deployed app against the real Monad testnet contract.
 *
 *   OPERATOR_PRIVATE_KEY=0x… APP=https://blindluv-id.vercel.app \
 *   BLINDLUV=0x… node scripts/smoke-testnet.mjs
 *
 * This is the production sibling of `e2e-local.mjs`. The difference is money:
 * a fork can mint USDC, testnet cannot. So the on-chain half is driven as far
 * as MON alone allows — commitments and the agent's session — and the staking
 * and x402 settlement steps are reported as skipped rather than silently
 * dropped, because a smoke test that hides what it did not check is worse than
 * no smoke test.
 *
 * Two throwaway EOAs are generated per run and funded from the operator. Never
 * reuse well-known keys here: on Monad testnet the Anvil defaults already
 * carry EIP-7702 delegations someone else set, which breaks USDC signatures.
 */
import { createPublicClient, createWalletClient, defineChain, formatEther, http, parseAbi, parseEther } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

const RPC = process.env.MONAD_RPC ?? "https://testnet-rpc.monad.xyz";
const APP = (process.env.APP ?? "https://blindluv-id.vercel.app").replace(/\/+$/, "");
const USDC = "0x534b2f3A21130d7a60830c2Df862319e593943A3";
const BLINDLUV = process.env.BLINDLUV ?? process.env.NEXT_PUBLIC_BLINDLUV_ADDRESS;
const OPERATOR = process.env.OPERATOR_PRIVATE_KEY;

/** Enough for a commitProfile at testnet gas prices, with room to spare. */
const FUNDING = parseEther(process.env.FUNDING_MON ?? "0.5");

/** Monad charges on gas_limit, not gas used, so this is a real cost, not a cap. */
const COMMIT_GAS = 80_000n;

const monadTestnet = defineChain({
  id: 10143,
  name: "Monad Testnet",
  nativeCurrency: { name: "MON", symbol: "MON", decimals: 18 },
  rpcUrls: { default: { http: [RPC] } },
});

const alice = privateKeyToAccount(generatePrivateKey());
const bob = privateKeyToAccount(generatePrivateKey());

/** Matching is scoped by city, so a unique one keeps runs from colliding. */
const CITY = `Smoke-${Math.random().toString(36).slice(2, 8)}`;

/**
 * The public RPC allows 15 requests/second and this script is read-heavy —
 * receipt polling alone can exceed that. viem's own retry does not help,
 * because the limiter answers with a JSON-RPC error rather than a retryable
 * HTTP status, so the throttle surfaces as a failed assertion.
 *
 * Spacing calls at the transport keeps that from happening at all, and keeps
 * a smoke test from reporting "the app is broken" when the RPC only said
 * "slow down".
 */
const MIN_INTERVAL_MS = 120;
let rpcChain = Promise.resolve();
const throttledFetch = (input, init) => {
  const turn = rpcChain.then(() => fetch(input, init));
  rpcChain = turn.then(
    () => new Promise((resolve) => setTimeout(resolve, MIN_INTERVAL_MS)),
    () => new Promise((resolve) => setTimeout(resolve, MIN_INTERVAL_MS)),
  );
  return turn;
};

const transport = http(RPC, { retryCount: 6, retryDelay: 800, batch: false, fetchFn: throttledFetch });
const pub = createPublicClient({ chain: monadTestnet, transport });
const wallet = (account) => createWalletClient({ account, chain: monadTestnet, transport });

const erc20 = parseAbi(["function balanceOf(address) view returns (uint256)"]);
const blind = parseAbi([
  "function commitProfile(bytes32)",
  "function profileCommitment(address) view returns (bytes32)",
  "function isAgent(address) view returns (bool)",
  "function isUnlocked(uint256) view returns (bool)",
]);

const post = async (path, body) => {
  const res = await fetch(APP + path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: res.status, json: await res.json().catch(() => ({})) };
};

let failures = 0;
const ok = (label, cond, extra = "") => {
  console.log(`${cond ? "  ✓" : "  ✗"} ${label}${extra ? "  — " + extra : ""}`);
  if (!cond) failures++;
  return cond;
};
const skip = (label, why) => console.log(`  · ${label}  — skipped: ${why}`);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Monad's reserve balance makes a freshly funded wallet unusable for a moment.
 *
 * Consensus budgets a sender's gas against `min(10 MON, lagged_state_balance)`,
 * where the lagged state trails by three blocks. A wallet funded an instant ago
 * has the money at `finalized` — the balance is genuinely there, we check — but
 * the budget still sees zero, and the next transaction is rejected with
 * "Signer had insufficient balance". That reads like the funding failed when it
 * plainly did not.
 *
 * Waiting for the receipt is not enough, and neither is waiting for the balance
 * to appear: the thing to wait for is *blocks*. Four covers the three-block
 * window with one to spare.
 */
async function waitForFundingToSettle(address, minimum) {
  const fundedAt = await pub.getBlockNumber();
  for (let attempt = 0; attempt < 40; attempt++) {
    const [settled, now] = await Promise.all([
      pub.getBalance({ address, blockTag: "finalized" }),
      pub.getBlockNumber(),
    ]);
    if (settled >= minimum && now >= fundedAt + 4n) return settled;
    await sleep(400);
  }
  throw new Error(`funding for ${address} never became spendable`);
}

/**
 * Retry a send that trips the reserve-balance rule.
 *
 * The window above is a heuristic about a consensus-side accounting rule, so it
 * can still lose a race under load. Retrying is cheap and only ever costs time;
 * failing the run here would report a broken app for a transient condition.
 */
async function sendWithReserveRetry(send, attempts = 5) {
  for (let attempt = 1; ; attempt++) {
    try {
      return await send();
    } catch (error) {
      const reserve = /insufficient balance/i.test(error?.details ?? error?.message ?? "");
      if (!reserve || attempt >= attempts) throw error;
      await sleep(2_000);
    }
  }
}

async function main() {
  if (!BLINDLUV) throw new Error("BLINDLUV (contract address) not set");
  if (!OPERATOR) throw new Error("OPERATOR_PRIVATE_KEY not set");
  const operator = privateKeyToAccount(OPERATOR.startsWith("0x") ? OPERATOR : `0x${OPERATOR}`);

  console.log(`app       ${APP}`);
  console.log(`contract  ${BLINDLUV}`);
  console.log(`operator  ${operator.address}\n`);

  // ---- 0. the deployment is what /api/config claims it is -----------------
  console.log("0. deployed configuration");
  const config = await fetch(`${APP}/api/config`).then((r) => r.json());
  ok("chain is Monad testnet", config.chainId === 10143, `chainId=${config.chainId}`);
  ok(
    "contract matches the deploy",
    config.contract?.toLowerCase() === BLINDLUV.toLowerCase(),
    config.contract ?? "null",
  );
  ok("profiles are in shared storage", config.stats?.backend === "kv", `backend=${config.stats?.backend}`);
  ok("AI agent is live", config.capabilities?.aiAgent === true, config.ai?.model);
  ok("contract has code on-chain", (await pub.getCode({ address: BLINDLUV }))?.length > 2);
  ok("agent wallet is authorised", await pub.readContract({ address: BLINDLUV, abi: blind, functionName: "isAgent", args: [config.wallets.agent] }));

  // ---- 1. two profiles, built by the model --------------------------------
  console.log("\n1. profiles");
  const a = await post("/api/profile", {
    address: alice.address,
    city: CITY,
    gender: "woman",
    seeking: ["man"],
    likes: "specialty coffee, weekend hiking, building software, long conversations about books",
    dislikes: "smoking",
    displayName: "Alice",
    contact: "@alice",
  });
  ok("alice profile", a.status === 200, a.json?.profile?.source);

  const b = await post("/api/profile", {
    address: bob.address,
    city: CITY,
    gender: "man",
    seeking: ["woman"],
    likes: "blockchain engineering, coffee, trail running, travelling",
    dislikes: "smoking",
    displayName: "Bob",
    contact: "@bob",
  });
  ok("bob profile", b.status === 200, b.json?.profile?.source);

  // A third profile the gender filter must exclude before the model runs.
  const chris = privateKeyToAccount(generatePrivateKey());
  const c = await post("/api/profile", {
    address: chris.address,
    city: CITY,
    gender: "man",
    seeking: ["man"],
    likes: "coffee, cycling, photography, cooking",
    dislikes: "smoking",
    displayName: "Chris",
    contact: "@chris",
  });
  ok("third profile stored", c.status === 200);

  /**
   * The real point of this check. In-memory storage is per-instance, so on
   * Vercel two users can land on different lambdas and never see each other.
   * Reading a profile back proves it went somewhere shared.
   */
  const readback = await fetch(`${APP}/api/profile?address=${alice.address}`).then((r) => r.json());
  ok("profile survives a separate request", readback?.commitment === a.json.commitment);

  // ---- 2. commitments on-chain, paid for with real testnet MON ------------
  console.log("\n2. publish commitments on Monad testnet");
  for (const [who, account, res] of [["alice", alice, a], ["bob", bob, b]]) {
    const funding = await wallet(operator).sendTransaction({ to: account.address, value: FUNDING });
    await pub.waitForTransactionReceipt({ hash: funding });
    await waitForFundingToSettle(account.address, FUNDING);

    const hash = await sendWithReserveRetry(() =>
      wallet(account).writeContract({
        address: BLINDLUV,
        abi: blind,
        functionName: "commitProfile",
        args: [res.json.commitment],
        gas: COMMIT_GAS,
      }),
    );
    const rec = await pub.waitForTransactionReceipt({ hash });
    ok(`${who} committed`, rec.status === "success", hash);

    const stored = await pub.readContract({ address: BLINDLUV, abi: blind, functionName: "profileCommitment", args: [account.address] });
    ok(`${who}'s commitment reads back`, stored === res.json.commitment);
  }

  // ---- 3. discovery: gender filter first, then the model ------------------
  console.log("\n3. discovery");
  const d = await post("/api/discover", { address: alice.address });
  const matches = d.json?.matches ?? [];
  ok("alice sees exactly 1 match", matches.length === 1, `${matches.length} match(es)`);
  const match = matches[0];
  ok("match is bob", match?.counterparty?.toLowerCase() === bob.address.toLowerCase());
  ok("scored by the AI, not the fallback", match?.source === "router", `source=${match?.source} score=${match?.score}`);
  ok("the score comes with reasons", (match?.reasons?.length ?? 0) > 0);
  ok("identity is withheld at this stage", match?.displayName === undefined && match?.contact === undefined);

  // ---- 4. the agent opens the session on the real contract ----------------
  console.log("\n4. agent opens a session on-chain");
  const s = await post("/api/session/open", { matchId: match.id, address: alice.address });
  ok("session opened", s.status === 200, `#${s.json?.sessionId} tx=${s.json?.transaction}`);
  if (s.status !== 200) console.log(`     ${JSON.stringify(s.json)}`);

  // ---- 5. x402 challenge --------------------------------------------------
  console.log("\n5. x402 gate");
  const challenge = await post("/api/reveal", { matchId: match.id, address: alice.address });
  ok("reveal is 402 before payment", challenge.status === 402, challenge.json?.error);
  const req = challenge.json?.accepts?.[0];
  ok("challenge names Monad testnet USDC", req?.asset?.toLowerCase() === USDC.toLowerCase() && req?.extra?.chainId === 10143);
  ok("challenge is the `exact` scheme", req?.scheme === "exact", `network=${req?.network}`);

  // ---- 6. what testnet cannot reach without USDC --------------------------
  console.log("\n6. staking and settlement");
  const balance = await pub.readContract({ address: USDC, abi: erc20, functionName: "balanceOf", args: [alice.address] });
  if (balance === 0n) {
    skip("both stake → session unlocks", "these wallets are generated per run and hold 0 USDC");
    skip("x402 pays and reveals identity", "same");
    skip("attendance confirmed, stake returned", "same");
    console.log("     Covered end-to-end by `npm run e2e:local`, where the fork mints USDC");
    console.log("     against this same contract. To exercise them here instead, claim USDC");
    console.log("     at https://faucet.circle.com (Monad Testnet, 20 per 2h) and drive the");
    console.log("     flow from the UI with a wallet you control.");
  } else {
    ok("test wallet holds USDC — run the full flow manually", true, `${balance} atomic units`);
  }

  /**
   * Give the MON back.
   *
   * Testnet MON arrives through a captcha-gated faucet, so a smoke test that
   * strands half a MON in a discarded wallet on every run quietly drains the
   * operator and eventually stops the whole deployment working. Monad's
   * "emptying transaction" exception exists exactly for this: an undelegated
   * account that has been quiet for three blocks may spend below the reserve,
   * which is the only way a sweep is possible at all.
   */
  console.log("\n7. return unused MON to the operator");
  for (const [who, account] of [["alice", alice], ["bob", bob]]) {
    try {
      await sleep(2_000); // let the account go quiet, per the emptying rule
      const balance = await pub.getBalance({ address: account.address });
      const price = await pub.getGasPrice();
      const cost = 21_000n * (price + price / 4n);
      if (balance <= cost) {
        skip(`sweep ${who}`, "balance below the cost of the sweep itself");
        continue;
      }
      const hash = await sendWithReserveRetry(() =>
        wallet(account).sendTransaction({
          to: operator.address,
          value: balance - cost,
          gas: 21_000n,
          maxFeePerGas: price + price / 4n,
        }),
      );
      await pub.waitForTransactionReceipt({ hash });
      ok(`swept ${who}`, true, `${formatEther(balance - cost)} MON returned`);
    } catch (error) {
      // A failed sweep costs testnet MON, not correctness. Say so and move on.
      skip(`sweep ${who}`, (error?.details ?? error?.shortMessage ?? "unknown").slice(0, 80));
    }
  }

  const left = await pub.getBalance({ address: operator.address });
  console.log(`\noperator MON remaining: ${formatEther(left)}`);
  console.log(failures === 0 ? "\nAll checks passed." : `\n${failures} check(s) failed.`);
  process.exitCode = failures === 0 ? 0 : 1;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
