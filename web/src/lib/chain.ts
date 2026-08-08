import { defineChain } from "viem";
import { monadTestnet } from "viem/chains";
import type { Address } from "viem";

/**
 * Two targets, one codebase.
 *
 *   NEXT_PUBLIC_CHAIN_MODE=local    → Anvil forking Monad testnet (chain 31337)
 *   NEXT_PUBLIC_CHAIN_MODE=testnet  → Monad testnet (chain 10143, default)
 *
 * The local fork exists because deploying to the real testnet needs MON from a
 * captcha-gated faucet. Forking gives you the same USDC contract, the same
 * EIP-3009 behaviour and the same bytecode, with pre-funded accounts — so the
 * full stake + x402 settlement path is exercisable before you have a single
 * real token. Nothing but this file changes when you switch.
 */
export const CHAIN_MODE = (process.env.NEXT_PUBLIC_CHAIN_MODE ?? "testnet") as "local" | "testnet";
export const IS_LOCAL = CHAIN_MODE === "local";

const LOCAL_RPC = process.env.NEXT_PUBLIC_LOCAL_RPC_URL ?? "http://127.0.0.1:8545";

/**
 * Anvil keeps its own chain id (31337) rather than impersonating 10143 — a
 * wallet that has both configured would otherwise show two networks claiming
 * the same id and silently route transactions to the wrong one.
 */
export const monadLocal = defineChain({
  id: 31337,
  name: "BlindLuv Local (Monad fork)",
  nativeCurrency: { name: "Testnet MON", symbol: "MON", decimals: 18 },
  rpcUrls: { default: { http: [LOCAL_RPC] } },
  testnet: true,
});

export const CHAIN = IS_LOCAL ? monadLocal : monadTestnet;
export const CHAIN_ID = CHAIN.id;

/**
 * What to call the network in the UI.
 *
 * Hard-coding "Monad Testnet" in a message is wrong half the time: in local
 * mode the app wants chain 31337, so telling someone to switch to Monad
 * Testnet sends them to the one network that will *not* work. Every
 * user-facing mention of the network reads this.
 */
export const CHAIN_LABEL = IS_LOCAL ? "BlindLuv Local" : "Monad Testnet";

export const RPC_URL = IS_LOCAL
  ? LOCAL_RPC
  : (process.env.NEXT_PUBLIC_MONAD_RPC_URL ?? "https://testnet-rpc.monad.xyz");

/**
 * Circle USDC on Monad testnet.
 * Source: monad-crypto/protocols → testnet/circle_usdc.jsonc
 * Verified on-chain: name "USDC", version "2", decimals 6, and both
 * EIP-3009 `transferWithAuthorization` overloads are reachable — which is
 * what makes the real x402 `exact` scheme work on this chain.
 *
 * The same address is used on the fork, because a fork *is* that chain.
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

/** A local fork has no explorer, so links are suppressed rather than broken. */
export function txUrl(hash: string) {
  return IS_LOCAL ? "" : `${EXPLORERS.monadVision}/tx/${hash}`;
}

export function addressUrl(address: string) {
  return IS_LOCAL ? "" : `${EXPLORERS.monadVision}/address/${address}`;
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
