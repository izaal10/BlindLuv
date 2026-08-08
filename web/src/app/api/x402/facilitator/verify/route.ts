import { NextResponse } from "next/server";

import { verify } from "@/lib/x402/facilitator";
import type { PaymentPayload, PaymentRequirements } from "@/lib/x402/types";

export const runtime = "nodejs";

/**
 * Standard x402 facilitator endpoint. Exposed publicly so any x402 client can
 * verify a Monad-testnet payment against this server, not just our own UI.
 */
export async function POST(request: Request) {
  let body: { paymentPayload?: PaymentPayload; paymentRequirements?: PaymentRequirements };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ isValid: false, invalidReason: "invalid_json" }, { status: 400 });
  }

  if (!body.paymentPayload || !body.paymentRequirements) {
    return NextResponse.json(
      { isValid: false, invalidReason: "paymentPayload and paymentRequirements are required" },
      { status: 400 },
    );
  }

  const result = await verify(body.paymentPayload, body.paymentRequirements);
  return NextResponse.json(result);
}
