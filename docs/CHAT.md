# Chat, and why it needs a signature

Once both people have staked and paid to see each other, they need to actually
arrange the meeting. That is all this is for — a channel from "matched" to
"met", not a messenger.

---

## Who is allowed to talk

Two independent checks, on every request, in this order:

1. **A bearer token** proves which wallet you are.
2. **The contract** says whether that wallet is in this session, and whether
   both sides staked.

Neither is sufficient alone. The token proves identity, not membership. The
contract read proves membership, but only of whatever address you typed — and
anyone can type someone else's.

```ts
const caller = readToken(bearer(request), sessionId);   // who you are
if (!caller) return 401;
const check = await requireUnlockedSession(sessionId, caller);   // whether you belong
```

The participant list comes from `getSession` on Monad rather than the off-chain
match record, because that is the copy neither side can edit and the same copy
the escrow will pay out against.

---

## Why a token instead of just an address

Everywhere else in this app, an `address` in a request body is taken at face
value. That is tolerable for writing your own profile — the worst case is junk
stored under someone else's key. It is **not** tolerable for chat, where a
message is *attributed* to a person, and where the two of them just paid to
learn who each other are. Unauthenticated chat would let a stranger impersonate
a match the moment the reveal completed.

The obvious fix — sign every message — means a wallet prompt per line, which
nobody would use. So: **sign once, get a token, send that.**

```
GET  /api/chat/auth?address=…&sessionId=…   → the exact text to sign
POST /api/chat/auth  { signature, issuedAt } → a bearer token
```

The challenge is issued by the server rather than built on the client, so the
string the wallet displays is byte-for-byte the string the server will verify.
Deriving it in two places is how signature checks quietly start failing.

The token is `address.sessionId.expiry.HMAC(secret, address|sessionId|expiry)`
— stateless, so there is no session table, and it cannot be extended or
repointed at another conversation without the secret. Comparison is
constant-time: a fast reject on the first wrong byte leaks the prefix, and that
is enough to walk a digest out one byte at a time.

Tokens live in `sessionStorage`, so closing the tab ends the grant.

### The secret, and what happens without one

`CHAT_TOKEN_SECRET` should be set in production. When it is missing the process
generates a **random** secret at boot rather than falling back to a fixed
string — a hard-coded default in a public repo is a published signing key, and
anyone holding it could mint a token for any address.

The cost of randomness is that tokens stop working when the process restarts or
a different serverless instance answers, and the user signs again. The client
treats a `401` as "ask for a new signature" rather than looping against a token
that cannot work. An occasional extra click; not a hole.

---

## What this is not

Messages are stored in the same KV as profiles, **unencrypted**, expiring on the
same TTL. The operator can read them. The UI says so, in the panel, rather than
implying a privacy property that is not there:

> Messages are stored on the server unencrypted and expire with the session.
> Swap a real contact here — this is for arranging the meeting, not for keeping.

End-to-end encryption is possible — both parties have wallet keys, so ECDH over
secp256k1 would work — and is the obvious next step if this were ever more than
a testnet demo. Claiming it before building it would be worse than not having
it.

---

## Notifications

Two moments in this flow are open-ended: waiting for the other side to stake,
and waiting for a reply. Everything else is a button you press and a result you
see. So those two, and nothing else, raise a notification.

Three rules, all about not being irritating:

- **Permission is asked when you stake**, never on page load. A prompt that
  appears before you have done anything gets denied, and a denial is permanent
  until the user goes digging through browser settings.
- **Nothing fires while the tab is visible.** You do not need telling about
  something you are looking at.
- Notifications are silent and share a tag per kind, so a burst of replies
  collapses into one entry instead of a stack.

There is also an unread count in the tab title, which is how anyone actually
waits for a reply — tab open, in the background.
