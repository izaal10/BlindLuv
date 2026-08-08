import { NextResponse } from "next/server";
import { isAddress } from "viem";

import { planDate } from "@/lib/ai/agent";
import { parseUsdc } from "@/lib/chain";
import { getMatch, getProfile } from "@/lib/store";
import { requirePayment, settleAndRespond } from "@/lib/x402/gate";

export const runtime = "nodejs";
// A Sonnet round-trip through 9Router runs ~3-5s (one agent call), which is
// comfortably over Vercel's short default budget.
export const maxDuration = 60;

const CONCIERGE_FEE = parseUsdc(process.env.NEXT_PUBLIC_CONCIERGE_FEE_USDC ?? "0.02");

/**
 * The concierge: given a mutual match, the agent proposes three neutral public
 * venues and an opener. Also x402-gated, but at a lower price than the reveal —
 * it discloses nothing identifying, so it does not need the on-chain gate.
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
  if (![match.a, match.b].some((p) => p.toLowerCase() === caller.toLowerCase())) {
    return NextResponse.json({ error: "You are not part of this match." }, { status: 403 });
  }

  const [a, b] = await Promise.all([getProfile(match.a), getProfile(match.b)]);
  if (!a || !b) return NextResponse.json({ error: "Profile no longer available." }, { status: 410 });

  const gate = await requirePayment(request, {
    resource: new URL(request.url).toString(),
    description: `BlindLuv concierge — date plan for match ${matchId}`,
    amountAtomic: CONCIERGE_FEE,
  });
  if (!gate.ok) return gate.response;

  const plan = await planDate(a.profile, b.profile, a.city);
  return settleAndRespond({ matchId, plan }, gate);
}
