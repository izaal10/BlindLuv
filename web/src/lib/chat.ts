import "server-only";

import type { Address } from "viem";

import { kvGet, kvSet } from "./kv";

/**
 * Chat for a session whose identities are already unlocked.
 *
 * Deliberately the dullest possible design: an append-only array per session,
 * in the same KV the profiles live in, expiring on the same TTL. There is no
 * encryption here, so the operator can read these messages — which is exactly
 * why the app says "swap a real contact" rather than pretending this is a
 * private channel. It exists to get two people from "matched" to "meeting",
 * not to be a messenger.
 */

const CHAT_KEY = (sessionId: string) => `blindluv:chat:${sessionId}`;

/** Long enough for a plan, short enough that nobody mistakes this for storage. */
export const MAX_BODY = 600;

/** Bounded so one participant cannot grow a session's record without limit. */
const MAX_MESSAGES = 200;

export interface ChatMessage {
  id: string;
  from: Address;
  body: string;
  at: number;
}

export async function listMessages(sessionId: string): Promise<ChatMessage[]> {
  return (await kvGet<ChatMessage[]>(CHAT_KEY(sessionId))) ?? [];
}

export async function appendMessage(
  sessionId: string,
  from: Address,
  body: string,
): Promise<ChatMessage> {
  const message: ChatMessage = {
    // Time plus randomness: two messages in the same millisecond still differ,
    // and the client uses this to tell new from already-rendered.
    id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    from,
    body,
    at: Date.now(),
  };

  const existing = await listMessages(sessionId);
  const next = [...existing, message].slice(-MAX_MESSAGES);
  await kvSet(CHAT_KEY(sessionId), next);
  return message;
}

/**
 * Strip control characters and clamp length.
 *
 * Returns null for anything that is only whitespace, so an accidental Enter
 * does not post an empty bubble.
 */
export function sanitiseBody(input: unknown): string | null {
  if (typeof input !== "string") return null;
  // Strip control characters, but keep tab and newline so a short plan can
  // have line breaks in it.
  const cleaned = input.replace(/[\u0000-\u0008\u000B-\u001F\u007F]/g, "").trim();
  if (cleaned.length === 0) return null;
  return cleaned.slice(0, MAX_BODY);
}
