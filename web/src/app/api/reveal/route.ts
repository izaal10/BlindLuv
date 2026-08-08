import { NextResponse } from "next/server";
import { createPublicClient, http, isAddress, type Address } from "viem";

import { blindluvAbi } from "@/lib/abi";
import { BLINDLUV_ADDRESS, CHAIN, parseUsdc } from "@/lib/chain";
import { bearer, readToken } from "@/lib/chatAuth";
import { requireUnlockedSession } from "@/lib/sessionGuard";
import { getMatch, getProfile, markPaid } from "@/lib/store";
import { requirePayment, settleAndRespond } from "@/lib/x402/gate";

export const runtime = "nodejs";

/** The AI matchmaking service fee, charged over x402. */
const SERVICE_FEE = parseUsdc(process.env.NEXT_PUBLIC_REVEAL_FEE_USDC ?? "0.05");

const publicClient = createPublicClient({ chain: CHAIN, transport: http() });

/**
 * The paywall. Two independent gates have to open before an identity is
 * disclosed:
 *
 *   1. x402 — the caller paid the agent's fee (HTTP 402 → X-PAYMENT → settle).
 *   2. Monad — both participants staked, so the session is `Active` on-chain.
 *
 * Paying the fee alone reveals nothing. That is the point: one person cannot
 * buy their way to another person's contact details.
 */
export async function POST(request: Request) {
  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const matchId = String(body.matchId ?? "");
  const caller = String(body.address ?? "");
  if (!isAddress(caller)) {
    return NextResponse.json({ error: "A connected wallet address is required." }, { status: 400 });
  }

  const match = await getMatch(matchId);
  if (!match) return NextResponse.json({ error: "Unknown match." }, { status: 404 });

  const isParticipant = [match.a, match.b].some((p) => p.toLowerCase() === caller.toLowerCase());
  if (!isParticipant) {
    return NextResponse.json({ error: "You are not part of this match." }, { status: 403 });
  }

  /**
   * Already paid for this one? Then do not charge again.
   *
   * The disclosure lives in browser state, so closing the tab used to mean
   * paying a second time for something you had already bought. Charging twice
   * for the same thing is a bug, not a policy.
   *
   * The catch is that "already paid" cannot be granted on the strength of an
   * address in a request body — that would let anyone name a payer and collect
   * their reveal for free, which is precisely the disclosure this endpoint
   * exists to guard. So it needs the same proof chat does: a bearer token over
   * a signature. No token, no shortcut, and the x402 gate below runs as usual.
   */
  if (match.sessionId) {
    const proven = readToken(bearer(request), match.sessionId);
    const alreadyPaid =
      proven &&
      proven.toLowerCase() === caller.toLowerCase() &&
      match.paidBy.some((p) => p.toLowerCase() === proven.toLowerCase());

    if (alreadyPaid) {
      const check = await requireUnlockedSession(match.sessionId, proven);
      if (!check.ok) return NextResponse.json({ error: check.error }, { status: check.status });

      const counterparty = caller.toLowerCase() === match.a.toLowerCase() ? match.b : match.a;
      const theirs = await getProfile(counterparty);
      if (!theirs) {
        return NextResponse.json({ error: "Counterparty profile is no longer available." }, { status: 410 });
      }

      return NextResponse.json(
        {
          matchId,
          sessionId: match.sessionId,
          revealed: {
            address: theirs.address,
            displayName: theirs.reveal.displayName,
            contact: theirs.reveal.contact,
            city: theirs.city,
            interests: theirs.profile.interests,
          },
          score: match.compatibility.score,
          alreadyPaid: true,
        },
        { headers: { "Cache-Control": "no-store" } },
      );
    }
  }

  // Gate 1 — x402. Verification happens before any work is done; settlement
  // happens after, so a failed reveal never charges the user.
  const gate = await requirePayment(request, {
    resource: new URL(request.url).toString(),
    description: `BlindLuv AI matchmaking fee — unlock match ${matchId}`,
    amountAtomic: SERVICE_FEE,
  });
  if (!gate.ok) return gate.response;

  // Gate 2 — Monad escrow. `latest` is the speculative head, which is the
  // correct tag here: it reflects the stake the user just sent.
  if (!BLINDLUV_ADDRESS) {
    return NextResponse.json(
      { error: "BlindLuv contract address is not configured on this deployment." },
      { status: 503 },
    );
  }
  if (!match.sessionId) {
    return NextResponse.json({ error: "No date session has been opened for this match yet." }, { status: 409 });
  }

  let unlocked = false;
  try {
    unlocked = await publicClient.readContract({
      address: BLINDLUV_ADDRESS as Address,
      abi: blindluvAbi,
      functionName: "isUnlocked",
      args: [BigInt(match.sessionId)],
      blockTag: "latest",
    });
  } catch {
    return NextResponse.json({ error: "Could not read session state from Monad." }, { status: 502 });
  }

  if (!unlocked) {
    return NextResponse.json(
      { error: "Both participants must stake before identities are revealed.", sessionId: match.sessionId },
      { status: 409 },
    );
  }

  const other = caller.toLowerCase() === match.a.toLowerCase() ? match.b : match.a;
  const record = await getProfile(other);
  if (!record) return NextResponse.json({ error: "Counterparty profile is no longer available." }, { status: 410 });

  await markPaid(matchId, gate.payment.payload.authorization.from);

  // Only now does anything identifying cross the wire.
  return settleAndRespond(
    {
      matchId,
      sessionId: match.sessionId,
      revealed: {
        address: record.address,
        displayName: record.reveal.displayName,
        contact: record.reveal.contact,
        city: record.city,
        interests: record.profile.interests,
      },
      score: match.compatibility.score,
    },
    gate,
  );
}
