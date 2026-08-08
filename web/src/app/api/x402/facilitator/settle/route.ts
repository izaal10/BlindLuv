import { NextResponse } from "next/server";

import { settle } from "@/lib/x402/facilitator";
import { NETWORK, type PaymentPayload, type PaymentRequirements } from "@/lib/x402/types";

export const runtime = "nodejs";

/** Standard x402 facilitator settlement endpoint for Monad testnet. */
export async function POST(request: Request) {
  let body: { paymentPayload?: PaymentPayload; paymentRequirements?: PaymentRequirements };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ success: false, errorReason: "invalid_json", network: NETWORK }, { status: 400 });
  }

  if (!body.paymentPayload || !body.paymentRequirements) {
    return NextResponse.json(
      { success: false, errorReason: "paymentPayload and paymentRequirements are required", network: NETWORK },
      { status: 400 },
    );
  }

  const result = await settle(body.paymentPayload, body.paymentRequirements);
  return NextResponse.json(result, { status: result.success ? 200 : 402 });
}
