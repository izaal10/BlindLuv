import "server-only";

import { NextResponse } from "next/server";
import type { Address } from "viem";

import { CHAIN_ID, USDC_ADDRESS, USDC_DECIMALS, USDC_EIP712_NAME, USDC_EIP712_VERSION } from "@/lib/chain";
import { canSettle, settle, verify } from "./facilitator";
import {
  NETWORK,
  X402_VERSION,
  decodePaymentHeader,
  encodeSettleHeader,
  type PaymentPayload,
  type PaymentRequirements,
  type PaymentRequiredBody,
} from "./types";

/** Where the AI agent's service fees are paid. */
export function agentWallet(): Address {
  const configured = process.env.AGENT_WALLET_ADDRESS;
  if (configured && /^0x[0-9a-fA-F]{40}$/.test(configured)) return configured as Address;
  // Burn-address default keeps a mis-configured deployment from silently
  // routing real funds somewhere unintended.
  return "0x000000000000000000000000000000000000dEaD";
}

export function buildRequirements(opts: {
  resource: string;
  description: string;
  amountAtomic: bigint;
}): PaymentRequirements {
  return {
    scheme: "exact",
    network: NETWORK,
    maxAmountRequired: opts.amountAtomic.toString(),
    resource: opts.resource,
    description: opts.description,
    mimeType: "application/json",
    payTo: agentWallet(),
    maxTimeoutSeconds: 120,
    asset: USDC_ADDRESS,
    outputSchema: null,
    extra: {
      name: USDC_EIP712_NAME,
      version: USDC_EIP712_VERSION,
      chainId: CHAIN_ID,
      decimals: USDC_DECIMALS,
    },
  };
}

export function paymentRequired(requirements: PaymentRequirements, error: string) {
  const body: PaymentRequiredBody = {
    x402Version: X402_VERSION,
    error,
    accepts: [requirements],
  };
  return NextResponse.json(body, {
    status: 402,
    headers: { "Cache-Control": "no-store" },
  });
}

export type GateResult =
  | { ok: false; response: NextResponse }
  | { ok: true; payment: PaymentPayload; requirements: PaymentRequirements };

/**
 * Enforce payment before the handler does any work.
 *
 * Order matters: verify (cheap, no broadcast) → run the resource → settle.
 * Settling before producing the resource would charge users for work that
 * might then fail.
 */
export async function requirePayment(
  request: Request,
  opts: { resource: string; description: string; amountAtomic: bigint },
): Promise<GateResult> {
  const requirements = buildRequirements(opts);
  const header = request.headers.get("x-payment");

  if (!header) {
    return { ok: false, response: paymentRequired(requirements, "X-PAYMENT header is required") };
  }

  let payment: PaymentPayload;
  try {
    payment = decodePaymentHeader(header);
  } catch (error) {
    const reason = error instanceof Error ? error.message : "malformed X-PAYMENT header";
    return { ok: false, response: paymentRequired(requirements, reason) };
  }

  const result = await verify(payment, requirements);
  if (!result.isValid) {
    return {
      ok: false,
      response: paymentRequired(requirements, result.invalidReason ?? "payment verification failed"),
    };
  }

  return { ok: true, payment, requirements };
}

/**
 * Settle after the resource was produced, and attach the receipt so the client
 * can link the payment on the explorer.
 */
export async function settleAndRespond(
  payload: unknown,
  gate: Extract<GateResult, { ok: true }>,
): Promise<NextResponse> {
  const receipt = await settle(gate.payment, gate.requirements);

  /**
   * If settlement fails, the payload must not go out.
   *
   * Verification happens before the work and settlement after it, so a
   * signature that verified but could not be broadcast — an EIP-1271 wallet
   * whose delegate rejects it, a relayer out of gas, a nonce raced by another
   * request — would otherwise hand over the identity for free. That directly
   * violates the one rule this whole product rests on: no payment, no
   * disclosure. Losing the work we already did is the cheaper mistake.
   */
  if (!receipt.success) {
    const response = NextResponse.json(
      {
        x402Version: X402_VERSION,
        error: receipt.errorReason ?? "Payment could not be settled.",
        accepts: [gate.requirements],
      },
      { status: 402, headers: { "Cache-Control": "no-store" } },
    );
    response.headers.set("X-PAYMENT-RESPONSE", encodeSettleHeader(receipt));
    return response;
  }

  const response = NextResponse.json(
    { ...(payload as Record<string, unknown>), payment: receipt },
    { headers: { "Cache-Control": "no-store" } },
  );
  response.headers.set("X-PAYMENT-RESPONSE", encodeSettleHeader(receipt));
  return response;
}

export { canSettle };
