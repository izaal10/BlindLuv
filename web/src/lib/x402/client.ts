import { toHex, type Address, type Hex, type WalletClient } from "viem";

import {
  TRANSFER_WITH_AUTHORIZATION_TYPES,
  X402_VERSION,
  encodePaymentHeader,
  type PaymentPayload,
  type PaymentRequiredBody,
  type PaymentRequirements,
  type SettleResponse,
} from "./types";

/**
 * Client half of x402.
 *
 * The user signs an EIP-3009 `TransferWithAuthorization` — a signature, not a
 * transaction. They pay in USDC and never need MON for gas, because the
 * facilitator broadcasts it. That is the property that makes x402 worth using
 * over a plain on-chain transfer.
 */

function randomNonce(): Hex {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return toHex(bytes);
}

export async function signPayment(
  wallet: WalletClient,
  account: Address,
  requirements: PaymentRequirements,
): Promise<PaymentPayload> {
  const now = Math.floor(Date.now() / 1000);
  const authorization = {
    from: account,
    to: requirements.payTo,
    value: requirements.maxAmountRequired,
    // Backdate slightly so a clock skew between browser and node cannot make
    // a freshly signed authorization look like it is from the future.
    validAfter: String(now - 60),
    validBefore: String(now + requirements.maxTimeoutSeconds),
    nonce: randomNonce(),
  };

  const signature = await wallet.signTypedData({
    account,
    domain: {
      name: requirements.extra.name,
      version: requirements.extra.version,
      chainId: requirements.extra.chainId,
      verifyingContract: requirements.asset,
    },
    types: TRANSFER_WITH_AUTHORIZATION_TYPES,
    primaryType: "TransferWithAuthorization",
    message: {
      from: authorization.from,
      to: authorization.to,
      value: BigInt(authorization.value),
      validAfter: BigInt(authorization.validAfter),
      validBefore: BigInt(authorization.validBefore),
      nonce: authorization.nonce,
    },
  });

  return {
    x402Version: X402_VERSION,
    scheme: "exact",
    network: requirements.network,
    payload: { signature, authorization },
  };
}

export interface PaidFetchResult<T> {
  data: T;
  payment?: SettleResponse;
  /** The 402 challenge the server issued, for display. */
  requirements?: PaymentRequirements;
}

export class PaymentError extends Error {
  constructor(message: string, readonly status: number, readonly requirements?: PaymentRequirements) {
    super(message);
    this.name = "PaymentError";
  }
}

/**
 * POST a resource, handling the 402 challenge transparently:
 * request → 402 + PaymentRequirements → sign → retry with X-PAYMENT.
 *
 * `onChallenge` lets the UI show the price and wait for consent rather than
 * silently prompting a signature the user did not ask for.
 */
export async function fetchWithPayment<T>(
  url: string,
  body: unknown,
  opts: {
    wallet: WalletClient;
    account: Address;
    onChallenge?: (requirements: PaymentRequirements) => Promise<boolean> | boolean;
  },
): Promise<PaidFetchResult<T>> {
  const first = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (first.status !== 402) {
    const json = await first.json().catch(() => ({}));
    if (!first.ok) throw new PaymentError(json?.error ?? `Request failed (${first.status})`, first.status);
    return { data: json as T };
  }

  const challenge = (await first.json()) as PaymentRequiredBody;
  const requirements = challenge.accepts?.[0];
  if (!requirements) throw new PaymentError("Server returned 402 with no payment requirements.", 402);

  if (opts.onChallenge) {
    const proceed = await opts.onChallenge(requirements);
    if (!proceed) throw new PaymentError("Payment cancelled.", 402, requirements);
  }

  const payment = await signPayment(opts.wallet, opts.account, requirements);

  const second = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-PAYMENT": encodePaymentHeader(payment),
    },
    body: JSON.stringify(body),
  });

  const json = await second.json().catch(() => ({}));
  if (second.status === 402) {
    throw new PaymentError(json?.error ?? "Payment was rejected.", 402, requirements);
  }
  if (!second.ok) {
    throw new PaymentError(json?.error ?? `Request failed (${second.status})`, second.status, requirements);
  }

  return { data: json as T, payment: json?.payment as SettleResponse | undefined, requirements };
}
