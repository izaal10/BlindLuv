/**
 * Drives the whole BlindLuv flow against the local fork, as two users.
 *
 *   node scripts/e2e-local.mjs
 *
 * Covers what a browser click-through would: profile → gender filter →
 * AI scoring → agent opens a session → both stake → x402 pays and reveals →
 * both confirm attendance and get their stake back.
 */
import {
  concat,
  createPublicClient,
  createWalletClient,
  defineChain,
  http,
  keccak256,
  pad,
  parseAbi,
  toHex,
} from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

const RPC = process.env.LOCAL_RPC ?? "http://127.0.0.1:8545";
const APP = process.env.APP ?? "http://localhost:3000";
const USDC = "0x534b2f3A21130d7a60830c2Df862319e593943A3";
const BLINDLUV = process.env.NEXT_PUBLIC_BLINDLUV_ADDRESS;

const chain = defineChain({
  id: 31337,
  name: "local",
  nativeCurrency: { name: "MON", symbol: "MON", decimals: 18 },
  rpcUrls: { default: { http: [RPC] } },
});

/**
 * Freshly generated, deliberately NOT Anvil's default accounts.
 *
 * Those keys are public, so on Monad testnet they already carry EIP-7702
 * delegations someone else set. A delegated account has code, which sends
 * USDC's SignatureChecker down the EIP-1271 path instead of plain ECDSA, and
 * the transfer reverts with "FiatTokenV2: invalid signature". Fresh keys have
 * no delegation and behave like the real users they stand in for.
 */
const alice = privateKeyToAccount(generatePrivateKey());
const bob = privateKeyToAccount(generatePrivateKey());

/**
 * A unique city per run. Matching is scoped by city, so without this the
 * profiles left behind by a previous run would show up as extra candidates
 * and the assertions below would be measuring the wrong thing.
 */
const CITY = `Jakarta-${Math.random().toString(36).slice(2, 8)}`;

const pub = createPublicClient({ chain, transport: http(RPC) });
const wallet = (account) => createWalletClient({ account, chain, transport: http(RPC) });

const erc20 = parseAbi([
  "function approve(address,uint256) returns (bool)",
  "function balanceOf(address) view returns (uint256)",
]);
const blind = parseAbi([
  "function commitProfile(bytes32)",
  "function stake(uint256)",
  "function confirmAttendance(uint256)",
  "function isUnlocked(uint256) view returns (bool)",
]);

const post = async (path, body, headers = {}) => {
  const res = await fetch(APP + path, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
  return { status: res.status, json: await res.json().catch(() => ({})) };
};

const ok = (label, cond, extra = "") => {
  console.log(`${cond ? "  ✓" : "  ✗"} ${label}${extra ? "  — " + extra : ""}`);
  if (!cond) process.exitCode = 1;
  return cond;
};

/**
 * Self-funding: this test drives two users, and the setup script only funds
 * the wallets you name. Rather than depending on that, it tops itself up.
 */
async function fund(address) {
  const call = (method, params) =>
    fetch(RPC, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    }).then((r) => r.json());

  await call("anvil_setBalance", [address, "0xD3C21BCECCEDA1000000"]);
  const slot = keccak256(concat([pad(address), pad(toHex(9))]));
  await call("anvil_setStorageAt", [USDC, slot, pad(toHex(1000n * 1_000_000n))]);
}

async function main() {
  if (!BLINDLUV) throw new Error("NEXT_PUBLIC_BLINDLUV_ADDRESS not set");
  console.log(`contract ${BLINDLUV}\n`);

  for (const acct of [alice, bob]) await fund(acct.address);

  // ---- 1. profiles, with opposite-but-compatible gender preferences -------
  console.log("1. profiles");
  const a = await post("/api/profile", {
    address: alice.address,
    city: CITY,
    gender: "woman",
    seeking: ["man"],
    age: 29,
    ageMin: 25,
    ageMax: 38,
    likes: "specialty coffee, weekend hiking, building software, long conversations",
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
    age: 32,
    ageMin: 24,
    ageMax: 36,
    likes: "blockchain, coffee, running, travelling",
    dislikes: "smoking",
    displayName: "Bob",
    contact: "@bob",
  });
  ok("bob profile", b.status === 200, b.json?.profile?.source);

  // A third profile that the gender filter must exclude.
  const c = await post("/api/profile", {
    address: privateKeyToAccount(generatePrivateKey()).address,
    city: CITY,
    gender: "man",
    seeking: ["man"],
    age: 30,
    ageMin: 25,
    ageMax: 40,
    likes: "coffee, cycling, photography, cooking",
    dislikes: "smoking",
    displayName: "Chris",
    contact: "@chris",
  });
  ok("third profile (should be filtered out for alice)", c.status === 200);

  // A fourth whose gender is fine but whose age is outside alice's stated
  // range, so the two filters are shown to be independent rather than one
  // covering for the other.
  const d4 = await post("/api/profile", {
    address: privateKeyToAccount(generatePrivateKey()).address,
    city: CITY,
    gender: "man",
    seeking: ["woman"],
    age: 61,
    ageMin: 18,
    ageMax: 99,
    likes: "coffee, hiking, software, long conversations about books",
    dislikes: "smoking",
    displayName: "Dave",
    contact: "@dave",
  });
  ok("fourth profile (should be filtered out by age)", d4.status === 200);

  // The contract will not open a session for anyone without an on-chain
  // commitment, so both sides must publish before matching can proceed.
  console.log("\n1b. publish commitments on-chain");
  for (const [who, account, res] of [["alice", alice, a], ["bob", bob, b]]) {
    const hash = await wallet(account).writeContract({
      address: BLINDLUV,
      abi: blind,
      functionName: "commitProfile",
      args: [res.json.commitment],
    });
    const rec = await pub.waitForTransactionReceipt({ hash });
    ok(`${who} committed`, rec.status === "success");
  }

  // ---- 2. discovery -------------------------------------------------------
  console.log("\n2. discovery");
  const d = await post("/api/discover", { address: alice.address });
  const matches = d.json?.matches ?? [];
  ok("alice sees exactly 1 match", matches.length === 1, `${matches.length} match(es)`);
  ok(
    "gender filter excluded the incompatible profile",
    d.json?.filteredByGender === 1,
    `filteredByGender=${d.json?.filteredByGender}`,
  );
  ok(
    "age filter excluded the out-of-range profile",
    d.json?.filteredByAge === 1,
    `filteredByAge=${d.json?.filteredByAge}`,
  );
  const match = matches[0];
  ok("match is bob", match?.counterparty?.toLowerCase() === bob.address.toLowerCase());
  ok("scored by the AI", match?.source === "router", `source=${match?.source} score=${match?.score}`);

  // ---- 2b. what a reload would find --------------------------------------
  console.log("\n2b. state survives a reload");
  const stateA = await fetch(`${APP}/api/state?address=${alice.address}`).then((r) => r.json());
  ok("profile comes back from the server", stateA.profile?.commitment === a.json.commitment);
  ok("age and range come back", stateA.profile?.age === 29 && stateA.profile?.ageMax === 38);
  ok("matches come back without re-scoring", stateA.matches?.length === 1, `${stateA.matches?.length} match(es)`);
  ok(
    "a reload still discloses nothing identifying",
    stateA.profile?.displayName === undefined &&
      stateA.matches?.every((m) => m.displayName === undefined && m.contact === undefined),
  );

  // ---- 3. agent opens the session on-chain -------------------------------
  console.log("\n3. agent opens session");
  const s = await post("/api/session/open", { matchId: match.id, address: alice.address });
  ok("session opened", s.status === 200, `#${s.json?.sessionId} tx=${s.json?.transaction?.slice(0, 12)}…`);
  const sessionId = BigInt(s.json.sessionId);
  const stakeAmount = BigInt(s.json.stakeAmount);

  // ---- 4. both stake ------------------------------------------------------
  console.log("\n4. staking");
  const beforeA = await pub.readContract({ address: USDC, abi: erc20, functionName: "balanceOf", args: [alice.address] });

  for (const [who, account] of [["alice", alice], ["bob", bob]]) {
    const w = wallet(account);
    await w.writeContract({ address: USDC, abi: erc20, functionName: "approve", args: [BLINDLUV, stakeAmount] });
    const hash = await w.writeContract({ address: BLINDLUV, abi: blind, functionName: "stake", args: [sessionId] });
    const rec = await pub.waitForTransactionReceipt({ hash });
    ok(`${who} staked`, rec.status === "success");
  }

  const unlocked = await pub.readContract({ address: BLINDLUV, abi: blind, functionName: "isUnlocked", args: [sessionId] });
  ok("session unlocked on-chain", unlocked === true);

  // ---- 5. x402: 402 challenge, then pay and reveal -------------------------
  console.log("\n5. x402 reveal");
  const challenge = await post("/api/reveal", { matchId: match.id, address: alice.address });
  ok("402 issued before payment", challenge.status === 402, challenge.json?.error);
  const req = challenge.json.accepts[0];

  const now = Math.floor(Date.now() / 1000);
  const nonce = toHex(crypto.getRandomValues(new Uint8Array(32)));
  const authorization = {
    from: alice.address,
    to: req.payTo,
    value: req.maxAmountRequired,
    validAfter: String(now - 60),
    validBefore: String(now + req.maxTimeoutSeconds),
    nonce,
  };
  const signature = await alice.signTypedData({
    domain: { name: req.extra.name, version: req.extra.version, chainId: req.extra.chainId, verifyingContract: req.asset },
    types: {
      TransferWithAuthorization: [
        { name: "from", type: "address" },
        { name: "to", type: "address" },
        { name: "value", type: "uint256" },
        { name: "validAfter", type: "uint256" },
        { name: "validBefore", type: "uint256" },
        { name: "nonce", type: "bytes32" },
      ],
    },
    primaryType: "TransferWithAuthorization",
    message: {
      from: authorization.from,
      to: authorization.to,
      value: BigInt(authorization.value),
      validAfter: BigInt(authorization.validAfter),
      validBefore: BigInt(authorization.validBefore),
      nonce,
    },
  });

  const header = Buffer.from(
    JSON.stringify({ x402Version: 1, scheme: "exact", network: "monad-testnet", payload: { signature, authorization } }),
  ).toString("base64");

  const paid = await post("/api/reveal", { matchId: match.id, address: alice.address }, { "X-PAYMENT": header });
  ok("reveal succeeded after payment", paid.status === 200, paid.json?.error);
  ok("identity disclosed", paid.json?.revealed?.displayName === "Bob", JSON.stringify(paid.json?.revealed?.contact));
  ok(
    "payment settled on-chain",
    paid.json?.payment?.success === true,
    paid.json?.payment?.success ? paid.json.payment.transaction?.slice(0, 14) : JSON.stringify(paid.json?.payment),
  );

  // ---- 5b. chat, which the reveal is the gate for -------------------------
  console.log("\n5b. chat");

  // Unauthenticated reads must not work: the address in a body is a claim, not
  // a proof, and a message is attributed to a person.
  const noAuth = await fetch(`${APP}/api/chat?sessionId=${sessionId}`).then((r) => r.status);
  ok("chat rejects an unsigned request", noAuth === 401, `status ${noAuth}`);

  const signIn = async (account) => {
    const c = await fetch(
      `${APP}/api/chat/auth?address=${account.address}&sessionId=${sessionId}`,
    ).then((r) => r.json());
    const signature = await account.signMessage({ message: c.message });
    const res = await post("/api/chat/auth", {
      address: account.address,
      sessionId: sessionId.toString(),
      issuedAt: c.issuedAt,
      signature,
    });
    return res.json?.token ?? null;
  };

  const aliceToken = await signIn(alice);
  const bobToken = await signIn(bob);
  ok("both sides can sign in", Boolean(aliceToken && bobToken));

  // A token names one session. Pointing it at another must fail, or one match
  // would be a key to every conversation the holder is not part of.
  const wrongSession = await fetch(`${APP}/api/chat?sessionId=${sessionId + 1n}`, {
    headers: { Authorization: `Bearer ${aliceToken}` },
  }).then((r) => r.status);
  ok("a token for one session does not open another", wrongSession === 401, `status ${wrongSession}`);

  const sent = await post(
    "/api/chat",
    { sessionId: sessionId.toString(), body: "Saturday, 4pm, the coffee place on the corner?" },
    { Authorization: `Bearer ${aliceToken}` },
  );
  ok("alice can send", sent.status === 200, sent.json?.error);

  const bobSees = await fetch(`${APP}/api/chat?sessionId=${sessionId}`, {
    headers: { Authorization: `Bearer ${bobToken}` },
  }).then((r) => r.json());
  ok("bob sees it", bobSees.messages?.length === 1, bobSees.messages?.[0]?.body);
  ok(
    "the sender is the signed wallet, not a body field",
    bobSees.messages?.[0]?.from?.toLowerCase() === alice.address.toLowerCase(),
  );

  // ---- 5c. the session survives a reload too, and so does the reveal ------
  console.log("\n5c. session + paid reveal survive a reload");
  const stateAfter = await fetch(`${APP}/api/state?address=${alice.address}`).then((r) => r.json());
  ok("the open session comes back", stateAfter.session?.sessionId === sessionId.toString(), `#${stateAfter.session?.sessionId}`);
  ok("the match is flagged as paid", stateAfter.matches?.[0]?.paid === true);

  // Having paid once, a proven wallet gets the identity back without paying
  // again — but only with proof. The same request without the token must 402.
  const freeAgain = await post(
    "/api/reveal",
    { matchId: match.id, address: alice.address },
    { Authorization: `Bearer ${aliceToken}` },
  );
  ok("a proven re-reveal is free", freeAgain.status === 200 && freeAgain.json?.alreadyPaid === true, freeAgain.json?.error);

  const unproven = await post("/api/reveal", { matchId: match.id, address: alice.address });
  ok("without proof it still charges", unproven.status === 402, `status ${unproven.status}`);

  // ---- 6. concierge -------------------------------------------------------
  console.log("\n6. concierge");
  const cc = await post("/api/concierge", { matchId: match.id, address: alice.address });
  ok("concierge also 402s", cc.status === 402);

  // ---- 7. attendance refunds both -----------------------------------------
  console.log("\n7. attendance");
  for (const [who, account] of [["alice", alice], ["bob", bob]]) {
    const hash = await wallet(account).writeContract({
      address: BLINDLUV,
      abi: blind,
      functionName: "confirmAttendance",
      args: [sessionId],
    });
    const rec = await pub.waitForTransactionReceipt({ hash });
    ok(`${who} confirmed`, rec.status === "success");
  }

  const afterA = await pub.readContract({ address: USDC, abi: erc20, functionName: "balanceOf", args: [alice.address] });
  const fee = BigInt(req.maxAmountRequired);
  ok(
    "alice got her stake back (minus only the x402 fee)",
    afterA === beforeA - fee,
    `before=${beforeA} after=${afterA} fee=${fee}`,
  );

  console.log(process.exitCode ? "\nFAILED" : "\nALL PASSED");
}

main().catch((e) => {
  console.error("\nERROR:", e.shortMessage ?? e.message);
  process.exit(1);
});
