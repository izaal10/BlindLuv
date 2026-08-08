import "server-only";

import { keccak256, toHex, type Address, type Hex } from "viem";

import type { AgentProfile, Compatibility } from "./ai/types";
import { kvEnabled, kvGet, kvMultiGet, kvSet, kvSetAdd, kvSetMembers } from "./kv";

/**
 * Off-chain profile store.
 *
 * This is the half of BlindLuv that must NOT be on-chain: raw answers, the AI
 * interest vector, the city, contact details. The chain only ever sees
 * `commitment` — a hash over this record plus a per-user salt — which is
 * enough to prove later that a match was computed over the profile it claims,
 * and nothing more.
 *
 * Backed by Upstash/Vercel KV when configured, otherwise an in-process Map.
 * Before this touches a real person's data, add per-user encryption at rest.
 */

export interface StoredProfile {
  address: Address;
  profile: AgentProfile;
  city: string;
  /** Stated fact, never shown to the model — used as a hard filter. */
  gender: string;
  /** Genders this person wants to meet. Empty means open to anyone. */
  seeking: string[];
  /** Kept server-side; the chain sees only keccak256(profile‖salt). */
  salt: Hex;
  commitment: Hex;
  /** Identity fields disclosed only after both stakes land. */
  reveal: { displayName: string; contact: string };
  createdAt: number;
}

export interface StoredMatch {
  id: string;
  a: Address;
  b: Address;
  compatibility: Compatibility;
  matchProof: Hex;
  /** Set once the AI service fee has been paid over x402. */
  paidBy: Address[];
  /** Set once an agent has opened the on-chain session. */
  sessionId?: string;
  createdAt: number;
}

const PROFILE_KEY = (a: string) => `blindluv:profile:${a.toLowerCase()}`;
const PROFILE_INDEX = "blindluv:profiles";
const MATCH_KEY = (id: string) => `blindluv:match:${id}`;
const MATCH_INDEX = "blindluv:matches";

export function storeBackend() {
  return kvEnabled ? "kv" : "memory";
}

export function randomSalt(): Hex {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return toHex(bytes);
}

/** keccak256 over the canonical profile encoding plus the private salt. */
export function computeCommitment(
  profile: AgentProfile,
  city: string,
  gender: string,
  seeking: string[],
  salt: Hex,
): Hex {
  const canonical = JSON.stringify({
    traits: profile.traits,
    interests: [...profile.interests].sort(),
    dealBreakers: [...profile.dealBreakers].sort(),
    city,
    gender,
    seeking: [...seeking].sort(),
    salt,
  });
  return keccak256(toHex(canonical));
}

// --------------------------------------------------------------------- profiles

export async function putProfile(record: Omit<StoredProfile, "createdAt">): Promise<StoredProfile> {
  const stored: StoredProfile = { ...record, createdAt: Date.now() };
  await kvSet(PROFILE_KEY(record.address), stored);
  await kvSetAdd(PROFILE_INDEX, record.address.toLowerCase());
  return stored;
}

export async function getProfile(address: string): Promise<StoredProfile | null> {
  return kvGet<StoredProfile>(PROFILE_KEY(address));
}

export async function listProfiles(exclude?: string): Promise<StoredProfile[]> {
  const addresses = await kvSetMembers(PROFILE_INDEX);
  const skip = exclude?.toLowerCase();
  const wanted = addresses.filter((a) => a !== skip);
  const records = await kvMultiGet<StoredProfile>(wanted.map(PROFILE_KEY));
  return records.filter((r): r is StoredProfile => r !== null);
}

// ---------------------------------------------------------------------- matches

export async function putMatch(match: Omit<StoredMatch, "createdAt"> & { createdAt?: number }): Promise<StoredMatch> {
  const stored: StoredMatch = { ...match, createdAt: match.createdAt ?? Date.now() };
  await kvSet(MATCH_KEY(match.id), stored);
  await kvSetAdd(MATCH_INDEX, match.id);
  return stored;
}

export async function getMatch(id: string): Promise<StoredMatch | null> {
  return kvGet<StoredMatch>(MATCH_KEY(id));
}

export async function markPaid(id: string, payer: Address): Promise<void> {
  const match = await getMatch(id);
  if (!match) return;
  if (match.paidBy.some((p) => p.toLowerCase() === payer.toLowerCase())) return;
  match.paidBy.push(payer);
  await kvSet(MATCH_KEY(id), match);
}

/** Match proof: binds the score to both profile commitments. */
export function computeMatchProof(aCommitment: Hex, bCommitment: Hex, score: number): Hex {
  const [first, second] = [aCommitment, bCommitment].sort();
  return keccak256(toHex(JSON.stringify({ first, second, score })));
}

export async function stats() {
  const [profiles, matches] = await Promise.all([kvSetMembers(PROFILE_INDEX), kvSetMembers(MATCH_INDEX)]);
  return { profiles: profiles.length, matches: matches.length, backend: storeBackend() };
}
