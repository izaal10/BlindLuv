"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Address } from "viem";
import { useSignMessage } from "wagmi";

import { notify, setUnreadBadge } from "@/lib/notify";
import { usePersisted } from "@/lib/persist";

interface ChatMessage {
  id: string;
  from: Address;
  body: string;
  at: number;
}

const MAX_BODY = 600;
const POLL_MS = 4_000;

/**
 * The conversation, available once both people have staked and the identities
 * are open.
 *
 * Access needs a signature, but only one: signing every message would mean a
 * wallet prompt per line. `/api/chat/auth` trades one signature for a bearer
 * token, which is what makes the sender of a message something the server knows
 * rather than something the client asserts.
 *
 * The token is kept in `sessionStorage` rather than `localStorage`, so closing
 * the tab ends the grant.
 */
export function Chat({
  sessionId,
  me,
  themName,
}: {
  sessionId: string;
  me: Address;
  themName: string;
}) {
  const { signMessageAsync } = useSignMessage();

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // sessionStorage, not localStorage: closing the tab ends the grant.
  const storageKey = `blindluv:chat-token:${sessionId}:${me.toLowerCase()}`;
  const [token, setToken] = usePersisted<string | null>("session", storageKey, null);
  const scroller = useRef<HTMLDivElement>(null);

  /** Everything the user has already been shown, so we only alert on the new. */
  const seen = useRef<Set<string> | null>(null);
  const unread = useRef(0);

  const signIn = useCallback(async () => {
    setError(null);
    setBusy(true);
    try {
      const challenge = await fetch(
        `/api/chat/auth?address=${me}&sessionId=${encodeURIComponent(sessionId)}`,
      ).then((r) => r.json());
      if (challenge.error) throw new Error(challenge.error);

      const signature = await signMessageAsync({ message: challenge.message });

      const res = await fetch("/api/chat/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ address: me, sessionId, issuedAt: challenge.issuedAt, signature }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Could not open the conversation.");

      setToken(json.token);
    } catch (e) {
      setError(e instanceof Error ? e.message.split("\n")[0].slice(0, 200) : "Could not sign in.");
    } finally {
      setBusy(false);
    }
  }, [me, sessionId, signMessageAsync, setToken]);

  /** Fold a fetched list into state, alerting only on messages from the other side. */
  const absorb = useCallback(
    (list: ChatMessage[]) => {
      setMessages(list);

      // First load establishes the baseline instead of announcing history.
      if (seen.current === null) {
        seen.current = new Set(list.map((m) => m.id));
        return;
      }

      const fresh = list.filter((m) => !seen.current!.has(m.id) && m.from.toLowerCase() !== me.toLowerCase());
      for (const m of list) seen.current.add(m.id);
      if (fresh.length === 0) return;

      const last = fresh[fresh.length - 1];
      notify(`${themName} replied`, last.body.slice(0, 120), `blindluv-chat-${sessionId}`);
      if (document.visibilityState !== "visible") {
        unread.current += fresh.length;
        setUnreadBadge(unread.current);
      }
    },
    [me, sessionId, themName],
  );

  useEffect(() => {
    if (!token) return;
    let live = true;

    const pull = async () => {
      try {
        const res = await fetch(`/api/chat?sessionId=${encodeURIComponent(sessionId)}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (res.status === 401) {
          // The signing secret rotates when the server restarts; ask again
          // rather than polling forever against a token that cannot work.
          if (live) setToken(null);
          return;
        }
        const json = await res.json();
        if (live && Array.isArray(json.messages)) absorb(json.messages);
      } catch {
        // A dropped poll is not worth showing; the next one is 4 seconds away.
      }
    };

    void pull();
    const timer = setInterval(pull, POLL_MS);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [token, sessionId, setToken, absorb]);

  /** Clear the badge when the tab comes back into view. */
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === "visible") {
        unread.current = 0;
        setUnreadBadge(0);
      }
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      setUnreadBadge(0);
    };
  }, []);

  useEffect(() => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: "smooth" });
  }, [messages.length]);

  const send = async () => {
    const body = draft.trim();
    if (!body || !token) return;
    setError(null);
    setBusy(true);
    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ sessionId, body }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Could not send.");
      setDraft("");
      if (Array.isArray(json.messages)) absorb(json.messages);
    } catch (e) {
      setError(e instanceof Error ? e.message.slice(0, 200) : "Could not send.");
    } finally {
      setBusy(false);
    }
  };

  if (!token) {
    return (
      <div className="card mt-5 p-6">
        <div className="eyebrow mb-3">Talk to {themName}</div>
        <p className="mb-4 text-[13.5px] leading-[1.6] text-[var(--text-secondary)]">
          Sign once to open the conversation. It proves you own this wallet — it is not a transaction and costs
          nothing.
        </p>
        <button className="btn btn-primary w-full" disabled={busy} onClick={signIn}>
          {busy ? "Waiting for your wallet…" : "Sign to open the chat"}
        </button>
        {error ? (
          <p
            className="mt-3 rounded-[10px] px-3 py-2 text-[12px]"
            style={{ background: "rgba(232,35,47,0.09)", color: "var(--rose-deep)" }}
          >
            {error}
          </p>
        ) : null}
      </div>
    );
  }

  return (
    <div className="card mt-5 p-6">
      <div className="eyebrow mb-4">Talk to {themName}</div>

      <div
        ref={scroller}
        className="mb-3 max-h-[340px] min-h-[120px] overflow-y-auto rounded-[10px] border border-[var(--border)] p-3"
      >
        {messages.length === 0 ? (
          <p className="py-6 text-center text-[12.5px] text-[var(--text-muted)]">
            Nothing yet. Suggest a place and a time — that is what the stake is for.
          </p>
        ) : (
          messages.map((m) => {
            const mine = m.from.toLowerCase() === me.toLowerCase();
            return (
              <div key={m.id} className={`mb-2.5 flex ${mine ? "justify-end" : "justify-start"}`}>
                <div
                  className="max-w-[78%] rounded-[12px] px-3 py-2 text-[13px] leading-[1.5]"
                  style={{
                    background: mine ? "var(--rose-pale)" : "var(--surface-2, rgba(0,0,0,0.04))",
                    color: "var(--text-primary)",
                    whiteSpace: "pre-wrap",
                    wordBreak: "break-word",
                  }}
                >
                  {m.body}
                  <div className="mono mt-1 text-[9.5px] text-[var(--text-muted)]">
                    {new Date(m.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>

      <div className="flex gap-2">
        <input
          className="min-w-0 flex-1 rounded-[10px] border border-[var(--border)] bg-transparent px-3 py-2.5 text-[13px] outline-none focus:border-[var(--rose)]"
          placeholder={`Message ${themName}…`}
          value={draft}
          maxLength={MAX_BODY}
          disabled={busy}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void send();
            }
          }}
        />
        <button className="btn btn-primary flex-none" disabled={busy || draft.trim().length === 0} onClick={send}>
          Send
        </button>
      </div>

      {error ? (
        <p
          className="mt-3 rounded-[10px] px-3 py-2 text-[12px]"
          style={{ background: "rgba(232,35,47,0.09)", color: "var(--rose-deep)" }}
        >
          {error}
        </p>
      ) : null}

      <p className="mt-3 text-[11px] leading-[1.55] text-[var(--text-muted)]">
        Messages are stored on the server unencrypted and expire with the session. Swap a real contact here — this is
        for arranging the meeting, not for keeping.
      </p>
    </div>
  );
}
