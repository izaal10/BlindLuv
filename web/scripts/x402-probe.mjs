import { privateKeyToAccount, generatePrivateKey } from "viem/accounts";
import { toHex } from "viem";

const USDC = "0x534b2f3A21130d7a60830c2Df862319e593943A3";
const account = privateKeyToAccount(generatePrivateKey());

const req = await (await fetch("http://localhost:3000/api/reveal", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ address: "0x1111111111111111111111111111111111111111", matchId: process.argv[2] }),
})).json();

// Not a participant in the demo match, so grab the requirements from a match
// we are part of instead — here we just reuse the emitted requirements shape.
const requirements = req.accepts?.[0];
if (!requirements) { console.log("no 402 challenge:", req); process.exit(1); }

const now = Math.floor(Date.now() / 1000);
const nonceBytes = new Uint8Array(32);
crypto.getRandomValues(nonceBytes);

const authorization = {
  from: account.address,
  to: requirements.payTo,
  value: requirements.maxAmountRequired,
  validAfter: String(now - 60),
  validBefore: String(now + requirements.maxTimeoutSeconds),
  nonce: toHex(nonceBytes),
};

const signature = await account.signTypedData({
  domain: {
    name: requirements.extra.name,
    version: requirements.extra.version,
    chainId: requirements.extra.chainId,
    verifyingContract: requirements.asset,
  },
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
    nonce: authorization.nonce,
  },
});

const paymentPayload = {
  x402Version: 1,
  scheme: "exact",
  network: "monad-testnet",
  payload: { signature, authorization },
};

console.log("payer:", account.address, "(zero USDC balance)");

const verified = await (await fetch("http://localhost:3000/api/x402/facilitator/verify", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ paymentPayload, paymentRequirements: requirements }),
})).json();
console.log("verify (valid signature, empty wallet):", verified);

// Now tamper with the signed value: verification must reject it.
const tampered = structuredClone(paymentPayload);
tampered.payload.authorization.value = "1";
const tamperedRes = await (await fetch("http://localhost:3000/api/x402/facilitator/verify", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ paymentPayload: tampered, paymentRequirements: requirements }),
})).json();
console.log("verify (tampered amount):        ", tamperedRes);

// Expired authorization must also be rejected.
const expired = structuredClone(paymentPayload);
expired.payload.authorization.validBefore = String(now - 10);
const expiredRes = await (await fetch("http://localhost:3000/api/x402/facilitator/verify", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ paymentPayload: expired, paymentRequirements: requirements }),
})).json();
console.log("verify (expired window):         ", expiredRes);
