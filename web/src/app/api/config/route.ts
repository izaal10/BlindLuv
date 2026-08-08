import { NextResponse } from "next/server";
import { privateKeyToAccount } from "viem/accounts";
import type { Hex } from "viem";

import { agentStatus } from "@/lib/ai/agent";
import { BLINDLUV_ADDRESS, CHAIN_ID, USDC_ADDRESS } from "@/lib/chain";
import { stats } from "@/lib/store";
import { canSettle, facilitatorAddress } from "@/lib/x402/facilitator";
import { agentWallet } from "@/lib/x402/gate";

export const runtime = "nodejs";

/** Everything the UI needs to render an honest status panel. */
export async function GET() {
  let agentOnchain: string | null = null;
  if (process.env.AGENT_PRIVATE_KEY) {
    try {
      const key = process.env.AGENT_PRIVATE_KEY;
      agentOnchain = privateKeyToAccount((key.startsWith("0x") ? key : `0x${key}`) as Hex).address;
    } catch {
      agentOnchain = null;
    }
  }

  const ai = agentStatus();

  return NextResponse.json({
    chainId: CHAIN_ID,
    contract: BLINDLUV_ADDRESS || null,
    usdc: USDC_ADDRESS,
    payTo: agentWallet(),
    fees: {
      reveal: process.env.NEXT_PUBLIC_REVEAL_FEE_USDC ?? "0.05",
      concierge: process.env.NEXT_PUBLIC_CONCIERGE_FEE_USDC ?? "0.02",
      stake: process.env.NEXT_PUBLIC_STAKE_USDC ?? "0.10",
    },
    /** Host and model only — the API key is never echoed. */
    ai: {
      provider: "9Router",
      configured: ai.configured,
      host: ai.host,
      model: ai.model,
      /**
       * A loopback base URL works locally but can never work from a Vercel
       * function, so it is reported as its own state rather than as "live".
       */
      unreachableFromServerless: ai.loopback,
      missing: ai.missing,
    },
    capabilities: {
      aiAgent: ai.configured && !ai.loopback,
      x402Settlement: canSettle(),
      onchainAgent: Boolean(agentOnchain),
    },
    wallets: {
      facilitator: facilitatorAddress(),
      agent: agentOnchain,
    },
    stats: await stats(),
  });
}
