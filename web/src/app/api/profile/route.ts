import { NextResponse } from "next/server";
import { isAddress, type Address } from "viem";

import { agentIsLive, buildProfile } from "@/lib/ai/agent";
import { MAX_AGE, MIN_AGE, parseAge, parsePreference } from "@/lib/age";
import { isGender, parseSeeking } from "@/lib/gender";
import { computeCommitment, getProfile, putProfile, randomSalt } from "@/lib/store";

export const runtime = "nodejs";
// A Sonnet round-trip through 9Router runs ~3-5s (one agent call), which is
// comfortably over Vercel's short default budget.
export const maxDuration = 60;

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

  // Gender never reaches the model — it is a stated fact used as a hard
  // filter in /api/discover, not something to be inferred or scored on.
  const gender = String(body.gender ?? "");
  if (!isGender(gender)) {
    return NextResponse.json({ error: "Select your gender." }, { status: 400 });
  }
  const seeking = parseSeeking(body.seeking);

  // Age is the same kind of value as gender: stated, filtered in plain code,
  // never sent to the model. Under-18 is rejected rather than clamped — quietly
  // rewriting it to 18 would put a minor in the pool and record that they said
  // they were an adult.
  const age = parseAge(body.age);
  if (age === null) {
    return NextResponse.json({ error: `Enter your age (${MIN_AGE}–${MAX_AGE}).` }, { status: 400 });
  }
  const { ageMin, ageMax } = parsePreference(body);

  const profile = await buildProfile({ likes, dislikes, conversationStyle, city });
  const salt = randomSalt();
  const commitment = computeCommitment(profile, city, gender, seeking, { age, ageMin, ageMax }, salt);

  await putProfile({
    address: address as Address,
    profile,
    city,
    gender,
    seeking,
    age,
    ageMin,
    ageMax,
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
    gender: record.gender,
    seeking: record.seeking,
    age: record.age,
    ageMin: record.ageMin,
    ageMax: record.ageMax,
    commitment: record.commitment,
  });
}
