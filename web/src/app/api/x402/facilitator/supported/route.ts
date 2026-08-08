import { NextResponse } from "next/server";

import { CHAIN_ID, USDC_ADDRESS, USDC_DECIMALS, USDC_EIP712_NAME, USDC_EIP712_VERSION } from "@/lib/chain";
import { canSettle, facilitatorAddress } from "@/lib/x402/facilitator";
import { NETWORK, X402_VERSION } from "@/lib/x402/types";

export const runtime = "nodejs";

export async function GET() {
  return NextResponse.json({
    x402Version: X402_VERSION,
    kinds: [{ scheme: "exact", network: NETWORK }],
    chainId: CHAIN_ID,
    asset: {
      address: USDC_ADDRESS,
      name: USDC_EIP712_NAME,
      eip712Version: USDC_EIP712_VERSION,
      decimals: USDC_DECIMALS,
      eip3009: true,
    },
    settlement: {
      available: canSettle(),
      relayer: facilitatorAddress(),
      note: canSettle()
        ? undefined
        : "FACILITATOR_PRIVATE_KEY is unset — this facilitator can verify payments but not broadcast them.",
    },
  });
}
