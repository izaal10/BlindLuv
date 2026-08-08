import { monadTestnet } from "viem/chains";
import type { Address } from "viem";

export const CHAIN = monadTestnet;
export const CHAIN_ID = monadTestnet.id; // 10143

/**
 * Circle USDC on Monad testnet.
 * Source: monad-crypto/protocols → testnet/circle_usdc.jsonc
 * Verified on-chain: name "USDC", version "2", decimals 6, and both
 * EIP-3009 `transferWithAuthorization` overloads are reachable — which is
 * what makes the real x402 `exact` scheme work on this chain.
 */
export const USDC_ADDRESS: Address = "0x534b2f3A21130d7a60830c2Df862319e593943A3";
export const USDC_DECIMALS = 6;
export const USDC_EIP712_NAME = "USDC";
export const USDC_EIP712_VERSION = "2";

/** Deployed by `contracts/script/Deploy.s.sol`; injected at build time. */
export const BLINDLUV_ADDRESS = (process.env.NEXT_PUBLIC_BLINDLUV_ADDRESS ?? "") as Address | "";

export const EXPLORERS = {
  monadVision: "https://testnet.monadexplorer.com",
  monadscan: "https://testnet.monadscan.com",
} as const;

export function txUrl(hash: string) {
  return `${EXPLORERS.monadVision}/tx/${hash}`;
}

export function addressUrl(address: string) {
  return `${EXPLORERS.monadVision}/address/${address}`;
}

/**
 * Monad charges gas on the *limit*, not on usage, so an inflated estimate is
 * money out of the user's pocket. These are measured ceilings from
 * `forge test --gas-report`, uplifted for Monad's pricier cold state access
 * (cold SLOAD 8,100 vs 2,100; cold account access 10,100 vs 2,600).
 *
 * They are used as a sanity cap on `estimateGas`, never blindly.
 */
export const GAS_CEILING = {
  commitProfile: 110_000n,
  approve: 120_000n,
  stake: 230_000n,
  confirmAttendance: 200_000n,
  settle: 200_000n,
} as const;

/** The gas skill's guidance: estimate, then add at most a 10% buffer. */
export function withBuffer(estimate: bigint, ceiling: bigint) {
  const buffered = estimate + estimate / 10n;
  return buffered > ceiling ? ceiling : buffered;
}

export function formatUsdc(atomic: bigint | string): string {
  const v = typeof atomic === "string" ? BigInt(atomic) : atomic;
  const whole = v / 1_000_000n;
  const frac = (v % 1_000_000n).toString().padStart(6, "0").replace(/0+$/, "");
  return frac ? `${whole}.${frac}` : `${whole}`;
}

export function parseUsdc(human: string): bigint {
  const [whole, frac = ""] = human.trim().split(".");
  return BigInt(whole || "0") * 1_000_000n + BigInt((frac + "000000").slice(0, 6));
}

export function shortAddress(a: string) {
  return `${a.slice(0, 6)}…${a.slice(-4)}`;
}
