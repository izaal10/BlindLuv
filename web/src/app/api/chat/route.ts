import { NextResponse } from "next/server";

import { MAX_BODY, appendMessage, listMessages, sanitiseBody } from "@/lib/chat";
import { bearer, readToken } from "@/lib/chatAuth";
import { requireUnlockedSession } from "@/lib/sessionGuard";

export const runtime = "nodejs";

const noStore = { "Cache-Control": "no-store" };

/**
 * Read and write a session's messages.
 *
 * Both verbs go through the same two checks, in the same order: the bearer
 * token proves which wallet you are, and the contract says whether that wallet
 * is in this session and whether both sides staked. The token alone is not
 * enough — it proves identity, not membership — and the contract alone is not
 * enough, because anyone can type someone else's address.
 */
async function authorise(request: Request, sessionId: string) {
  const caller = readToken(bearer(request), sessionId);
  if (!caller) {
    return {
      ok: false as const,
      response: NextResponse.json(
        { error: "Sign in to this conversation first.", needsAuth: true },
        { status: 401, headers: noStore },
      ),
    };
  }

  const check = await requireUnlockedSession(sessionId, caller);
  if (!check.ok) {
    return {
      ok: false as const,
      response: NextResponse.json({ error: check.error }, { status: check.status, headers: noStore }),
    };
  }

  return { ok: true as const, caller };
}

export async function GET(request: Request) {
  const sessionId = new URL(request.url).searchParams.get("sessionId") ?? "";
  if (!sessionId) return NextResponse.json({ error: "sessionId is required." }, { status: 400 });

  const auth = await authorise(request, sessionId);
  if (!auth.ok) return auth.response;

  return NextResponse.json({ messages: await listMessages(sessionId), you: auth.caller }, { headers: noStore });
}

export async function POST(request: Request) {
  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const sessionId = String(body.sessionId ?? "");
  if (!sessionId) return NextResponse.json({ error: "sessionId is required." }, { status: 400 });

  const auth = await authorise(request, sessionId);
  if (!auth.ok) return auth.response;

  const message = sanitiseBody(body.body);
  if (!message) {
    return NextResponse.json({ error: `Write something (up to ${MAX_BODY} characters).` }, { status: 400 });
  }

  // The sender is whoever the token proves, never whoever the body claims.
  await appendMessage(sessionId, auth.caller, message);
  return NextResponse.json({ messages: await listMessages(sessionId), you: auth.caller }, { headers: noStore });
}
