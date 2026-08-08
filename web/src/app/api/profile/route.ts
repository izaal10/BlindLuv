import { NextResponse } from "next/server";
import { isAddress, type Address } from "viem";

import { agentIsLive, buildProfile } from "@/lib/ai/agent";
import { computeCommitment, getProfile, putProfile, randomSalt } from "@/lib/store";

export const runtime = "nodejs";

/**
 * Turn free text into a matching profile and return the commitment the user
 * will publish on Monad. The raw answers never leave this server.
 */
export async function POST(request: Request) {
  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const address = String(body.address ?? "");
  if (!isAddress(address)) {
    return NextResponse.json({ error: "A connected wallet address is required." }, { status: 400 });
  }

  const likes = String(body.likes ?? "").trim();
  const dislikes = String(body.dislikes ?? "").trim();
  const conversationStyle = String(body.conversationStyle ?? "").trim();
  const city = String(body.city ?? "").trim();

  if (likes.length < 8) {
    return NextResponse.json({ error: "Tell us a little more about what you enjoy." }, { status: 400 });
  }
  if (!city) {
    return NextResponse.json({ error: "A city is required so matches stay local." }, { status: 400 });
  }

  const profile = await buildProfile({ likes, dislikes, conversationStyle, city });
  const salt = randomSalt();
  const commitment = computeCommitment(profile, city, salt);

  await putProfile({
    address: address as Address,
    profile,
    city,
    salt,
    commitment,
    reveal: {
      displayName: String(body.displayName ?? "").trim() || "Anonymous",
      contact: String(body.contact ?? "").trim(),
    },
  });

  return NextResponse.json({
    commitment,
    profile,
    agentLive: agentIsLive(),
  });
}

export async function GET(request: Request) {
  const address = new URL(request.url).searchParams.get("address");
  if (!address || !isAddress(address)) {
    return NextResponse.json({ error: "address query parameter is required." }, { status: 400 });
  }
  const record = await getProfile(address);
  if (!record) return NextResponse.json({ profile: null });

  // Salt and reveal fields are intentionally omitted.
  return NextResponse.json({
    profile: record.profile,
    city: record.city,
    commitment: record.commitment,
  });
}
