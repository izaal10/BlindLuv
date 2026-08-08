import { NextResponse } from "next/server";
import { isAddress } from "viem";

import { getProfile, listMatchesFor } from "@/lib/store";

export const runtime = "nodejs";

/**
 * Everything the UI needs to pick up where a wallet left off.
 *
 * The flow used to live entirely in React state, so a refresh dropped the
 * profile, the matches and the open session, and the only way forward was to
 * fill the form in again — and re-running discovery costs a model call per
 * candidate, so "just try again" was not free either.
 *
 * None of that state was ever really the client's. The profile, the scored
 * matches and the session id are all already on the server; the browser was
 * just the only place holding a pointer to them. This hands the pointer back.
 *
 * Nothing identifying is returned. The cards here are the same blind cards
 * `/api/discover` produces — score, reasoning, interests — and the counterparty
 * stays a bare address until the x402 reveal. A refresh must not become a way
 * around the paywall.
 */
export async function GET(request: Request) {
  const address = new URL(request.url).searchParams.get("address");
  if (!address || !isAddress(address)) {
    return NextResponse.json({ error: "address query parameter is required." }, { status: 400 });
  }

  const me = await getProfile(address);
  if (!me) {
    return NextResponse.json({ profile: null, matches: [], session: null }, { headers: { "Cache-Control": "no-store" } });
  }

  const stored = await listMatchesFor(address);

  const cards = await Promise.all(
    stored.map(async (m) => {
      const otherAddress = m.a.toLowerCase() === address.toLowerCase() ? m.b : m.a;
      const other = await getProfile(otherAddress);
      if (!other) return null;

      return {
        id: m.id,
        counterparty: otherAddress,
        score: m.compatibility.score,
        reasons: m.compatibility.reasons,
        sharedInterests: m.compatibility.sharedInterests,
        interests: other.profile.interests,
        blurb: other.profile.blurb,
        city: other.city,
        vetoed: m.compatibility.vetoed,
        vetoReason: m.compatibility.vetoReason,
        matchProof: m.matchProof,
        source: m.compatibility.source,
        sessionId: m.sessionId ?? null,
        /** Whether *this* caller already paid to unlock it. */
        paid: m.paidBy.some((p) => p.toLowerCase() === address.toLowerCase()),
      };
    }),
  );

  const matches = cards.filter((c): c is NonNullable<typeof c> => c !== null && !c.vetoed);

  // The session to resume is the newest one an agent actually opened.
  const active = matches.find((m) => m.sessionId);

  return NextResponse.json(
    {
      profile: {
        // Raw answers are never stored, only what the agent derived from them,
        // so the form cannot be repopulated verbatim — but it does not need to
        // be. What matters is that a profile exists and the flow moves on.
        interests: me.profile.interests,
        blurb: me.profile.blurb,
        dealBreakers: me.profile.dealBreakers,
        source: me.profile.source,
        city: me.city,
        gender: me.gender,
        seeking: me.seeking,
        age: me.age,
        ageMin: me.ageMin,
        ageMax: me.ageMax,
        commitment: me.commitment,
        createdAt: me.createdAt,
        // Deliberately no displayName or contact. This endpoint takes an
        // address and no proof of owning it, so anything it returns is public
        // — and a display name is one of the things the x402 reveal is for.
      },
      matches,
      session: active ? { sessionId: active.sessionId, matchId: active.id } : null,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
