import "server-only";

import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { verifyMessage, type Address } from "viem";

/**
 * Proof that you control the wallet you are posting as.
 *
 * Everywhere else in this app an `address` in the request body is taken at face
 * value. That is tolerable for writing your own profile — the worst case is
 * junk under someone else's key — but not for chat, where a message is
 * *attributed* to a person and the whole point of the reveal step was to
 * establish who that person is. Unauthenticated chat would let anyone
 * impersonate a match immediately after the two of them paid to learn each
 * other's names.
 *
 * Signing every message would mean a wallet prompt per line, which nobody would
 * use. So: sign once, get a bearer token, send that. The token is an HMAC over
 * `address|sessionId|expiry`, so it is stateless — no session table, and it
 * cannot be extended or repointed at another session without the secret.
 */

const TOKEN_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * Falls back to a per-process random secret when `CHAT_TOKEN_SECRET` is unset.
 *
 * That is deliberately not a fixed default string: a hard-coded fallback is a
 * published signing key, and anyone could mint tokens for any address. The cost
 * of a random one is that tokens stop working when the process restarts or a
 * different serverless instance answers, and the user signs again — an
 * occasional extra click, not a hole. Set the env var in production and the
 * signature survives both.
 */
const secret = process.env.CHAT_TOKEN_SECRET
  ? Buffer.from(process.env.CHAT_TOKEN_SECRET)
  : randomBytes(32);

export const chatSecretConfigured = Boolean(process.env.CHAT_TOKEN_SECRET);

/** What the wallet is asked to sign. Names the session so a token for one conversation is not a token for another. */
export function challengeFor(address: string, sessionId: string, issuedAt: number): string {
  return [
    "BlindLuv chat access",
    "",
    `Wallet:  ${address.toLowerCase()}`,
    `Session: #${sessionId}`,
    `Issued:  ${new Date(issuedAt).toISOString()}`,
    "",
    "Signing this proves you control this wallet. It is not a transaction and costs nothing.",
  ].join("\n");
}

/** Reject a stale or future-dated challenge so an old signature cannot be replayed forever. */
const CHALLENGE_WINDOW_MS = 5 * 60 * 1000;

export async function issueToken(opts: {
  address: Address;
  sessionId: string;
  issuedAt: number;
  signature: `0x${string}`;
}): Promise<string | null> {
  const drift = Math.abs(Date.now() - opts.issuedAt);
  if (!Number.isFinite(opts.issuedAt) || drift > CHALLENGE_WINDOW_MS) return null;

  const valid = await verifyMessage({
    address: opts.address,
    message: challengeFor(opts.address, opts.sessionId, opts.issuedAt),
    signature: opts.signature,
  });
  if (!valid) return null;

  const expiry = Date.now() + TOKEN_TTL_MS;
  return `${opts.address.toLowerCase()}.${opts.sessionId}.${expiry}.${sign(opts.address, opts.sessionId, expiry)}`;
}

function sign(address: string, sessionId: string, expiry: number): string {
  return createHmac("sha256", secret).update(`${address.toLowerCase()}|${sessionId}|${expiry}`).digest("hex");
}

/** The address a token proves, or null. */
export function readToken(token: string | null, sessionId: string): Address | null {
  if (!token) return null;
  const parts = token.split(".");
  if (parts.length !== 4) return null;
  const [address, tokenSession, expiryRaw, mac] = parts;

  if (tokenSession !== sessionId) return null;

  const expiry = Number(expiryRaw);
  if (!Number.isFinite(expiry) || expiry < Date.now()) return null;

  const expected = sign(address, tokenSession, expiry);
  // Constant-time: a fast reject on the first wrong byte leaks the prefix, and
  // an attacker who can measure that can walk the digest out one byte at a time.
  const a = Buffer.from(mac, "hex");
  const b = Buffer.from(expected, "hex");
  if (a.length !== b.length || a.length === 0 || !timingSafeEqual(a, b)) return null;

  return address as Address;
}

export function bearer(request: Request): string | null {
  const header = request.headers.get("authorization");
  if (!header?.toLowerCase().startsWith("bearer ")) return null;
  return header.slice(7).trim() || null;
}
