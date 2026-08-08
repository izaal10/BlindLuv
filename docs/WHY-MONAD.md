# What Monad is actually doing here

A fair question to ask of any app with a chain in it: *what breaks if you take
the chain out?* Here the honest answer is **the product**, not a feature of it.

---

## The problem the chain solves

Blind dating has one failure mode, and it is not bad matching. It is that
nobody shows up. A match costs nothing to accept, so accepting is free, so
people accept everything and attend nothing.

Making it cost something fixes that — but then you need somewhere to *hold* the
money that neither person controls, that pays out on a rule both agreed to in
advance, and that neither the other person nor the operator can quietly change.

That is an escrow, and an escrow you have to trust is not an escrow. This is the
entire case for a chain: **the stake is held by rules, not by us.**

```solidity
// contracts/src/BlindLuv.sol
confirmAttendance()  // both confirmed → both stakes returned immediately
settle()             // after the deadline:
                     //   one confirmed → the no-show's stake goes to the one who came
                     //   neither       → both returned
```

We cannot take the money. There is no admin function that moves a stake — the
owner can set the agent and the minimum, and that is all. You can read the
[verified source](https://testnet.monadscan.com/address/0xbD32698e3A4E68856d6545CC02823F837AF24c64)
and check.

## The second job: proving a profile existed without storing it

Your answers never go on-chain. What goes on-chain is one hash:

```solidity
function commitProfile(bytes32 commitment) external
```

`commitment = keccak256(profile ‖ city ‖ gender ‖ seeking ‖ salt)`

That single value does real work. It binds the match to the profile it was
computed over, so the agent cannot later claim it scored something it did not,
and you cannot rewrite who you were after seeing who you got. And because it is
a hash with a salt, it reveals nothing — not your city, not your gender, not a
word you wrote.

Privacy and provability usually pull against each other. A commitment is how you
get both, and it needs a public ledger to be worth anything.

## The third job: identity disclosure has two locks, and one is on-chain

```
reveal identity  ⟸  x402 payment settled  ∧  isUnlocked(sessionId) == true
```

The second condition is a contract call, and it is only true once **both** sides
have staked. So paying more, or paying twice, or being the operator, gets you
nothing. Nobody can buy their way to another person's contact details, and that
guarantee lives in a contract rather than in our good intentions.

---

## Why Monad specifically, and not any EVM chain

The contract would compile anywhere. Four things made this app pleasant on Monad
and unpleasant elsewhere — the first two are the real reasons.

### 400ms blocks are a UX feature, not a benchmark

The flow has **six** transactions in it: two commitments, one session open, two
stakes, two attendance confirmations. On a 12-second chain that is well over a
minute of spinners spread across a first date's worth of steps. At ~400ms with
~800ms finality, each step feels like pressing a button rather than submitting a
form. A dating app that makes you wait is a dating app you close.

### Fees small enough that a 0.05 USDC fee makes sense

The agent charges five cents. If gas were dollars, the fee would be a rounding
error on the fee, and the whole x402 idea — many small payments for small pieces
of work — collapses. Real numbers from this deployment:

| Action | Cost |
| --- | --- |
| Deploy the contract | 0.30 MON |
| `commitProfile` | ~0.008 MON |

### Real Circle USDC, so x402 is real

Monad testnet has actual `FiatTokenV2_2` at
`0x534b2f3A21130d7a60830c2Df862319e593943A3`, with **EIP-3009**
`transferWithAuthorization` live. That is what makes the x402 `exact` scheme
work: the payer *signs a message*, the facilitator broadcasts and pays the gas,
so **paying needs no MON at all**. On a chain with a hand-rolled mock token,
none of that is testing anything.

### Parallel execution matches the shape of the work

Sessions touch disjoint storage — different users, different session ids — so
they are exactly the case Monad's optimistic parallel execution handles well.
Nothing in this app serialises against anything else in it.

---

## Three Monad behaviours that changed the code

These are not trivia. Each one produced a bug first.

### Gas is charged on `gas_limit`, not gas used

Set a generous limit "to be safe" on Ethereum and you pay for what you use. Here
you pay for what you asked for. So every write passes an explicit limit and
`withBuffer()` caps it:

```ts
// web/src/lib/chain.ts
export const GAS_CEILING = { commitProfile: 110_000n, stake: 230_000n, … };
export function withBuffer(estimate: bigint, ceiling: bigint) {
  const b = estimate + estimate / 10n;
  return b > ceiling ? ceiling : b;
}
```

A 10% buffer, hard-capped. The usual 2× habit would silently double every fee.

### A freshly funded wallet cannot spend yet

Consensus budgets a sender's gas against `min(10 MON, lagged_state_balance)`,
and that state trails three blocks behind. Fund a new wallet and send
immediately and you get `Signer had insufficient balance` — while the balance is
plainly there:

```
$ cast balance 0x2785… --block finalized
500000000000000000
```

Waiting for the receipt does not help. Waiting for *blocks* does. See
[LOCAL.md](LOCAL.md#freshly-funded-wallets-cannot-spend-immediately).

### EIP-7702 delegated EOAs cannot pay via x402 `exact`

USDC validates authorizations through Circle's `SignatureChecker`, which sends
any address **with code** down the EIP-1271 path instead of plain ECDSA. A
7702-delegated EOA has code. If its delegate does not implement
`isValidSignature`, the transfer reverts with `FiatTokenV2: invalid signature` —
a maximally confusing error for a signature that is perfectly valid.

This is not hypothetical. Anvil's default accounts already carry delegations on
real Monad testnet, because their keys are public:

```
$ cast code 0x70997970C51812dc3A010C7d01b50e0d17dc79C8 --rpc-url https://testnet-rpc.monad.xyz
0xef01006bd9b71559e3b2013596726a4e2ca1ee97189606
```

The facilitator now detects this up front and says so. See [X402.md](X402.md).

---

## What Monad is *not* doing

Worth being precise, because "on-chain" is often claimed for more than it earns:

- **The matching is not on-chain.** A language model scores compatibility on a
  server. Only the score and a proof hash are recorded.
- **Your profile is not on-chain.** Only a salted hash.
- **Identity is not on-chain.** It is in Redis, released by the API when both
  gates open.
- **The payment is not a Monad-native mechanism.** x402 is plain HTTP over
  EIP-3009; Monad is where the transfer settles.

The chain holds the three things that must be neither trusted nor forgeable:
**the stake, the commitment, and the unlock condition.** Everything else is a
normal web app, deliberately.
