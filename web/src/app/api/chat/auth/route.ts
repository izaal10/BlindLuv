import { NextResponse } from "next/server";
import { isAddress, type Address, type Hex } from "viem";

import { challengeFor, issueToken } from "@/lib/chatAuth";
import { requireUnlockedSession } from "@/lib/sessionGuard";

export const runtime = "nodejs";

/**
 * `GET` hands out the text to sign; `POST` trades a signature for a token.
 *
 * Two round trips rather than one so the challenge the wallet displays is the
 * exact string the server will verify — deriving it on the client and hoping
 * the two agree is how signature checks quietly start failing.
 */
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const address = params.get("address") ?? "";
  const sessionId = params.get("sessionId") ?? "";

  if (!isAddress(address) || !sessionId) {
    return NextResponse.json({ error: "address and sessionId are required." }, { status: 400 });
  }

  const issuedAt = Date.now();
  return NextResponse.json(
    { message: challengeFor(address, sessionId, issuedAt), issuedAt },
    { headers: { "Cache-Control": "no-store" } },
  );
}

export async function POST(request: Request) {
  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const address = String(body.address ?? "");
  const sessionId = String(body.sessionId ?? "");
  const signature = String(body.signature ?? "");
  const issuedAt = Number(body.issuedAt);

  if (!isAddress(address) || !sessionId || !signature.startsWith("0x")) {
    return NextResponse.json({ error: "address, sessionId and signature are required." }, { status: 400 });
  }

  // Check membership before spending a signature verification on it, and so a
  // stranger cannot discover whether a session exists by probing signatures.
  const check = await requireUnlockedSession(sessionId, address as Address);
  if (!check.ok) return NextResponse.json({ error: check.error }, { status: check.status });

  const token = await issueToken({
    address: address as Address,
    sessionId,
    issuedAt,
    signature: signature as Hex,
  });
  if (!token) {
    return NextResponse.json({ error: "That signature did not check out. Try again." }, { status: 401 });
  }

  return NextResponse.json({ token }, { headers: { "Cache-Control": "no-store" } });
}
