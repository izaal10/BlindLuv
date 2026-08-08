import type { Address, Hex } from "viem";

/**
 * x402 wire types.
 *
 * The published `x402` npm package (v1.2.0) hard-codes a network enum that has
 * no Monad entry, so it cannot be used here. Monad testnet USDC *does*
 * implement EIP-3009, so the protocol itself works unchanged — these types
 * mirror the x402 v1 wire format exactly, and the facilitator in
 * `./facilitator.ts` implements `exact`-scheme verify/settle against Monad.
 * A future x402 release that adds `monad-testnet` should be drop-in
 * compatible with what this server emits.
 */
export const X402_VERSION = 1;

export const NETWORK = "monad-testnet";
export type Network = typeof NETWORK;

export interface PaymentRequirements {
  scheme: "exact";
  network: Network;
  /** Atomic units (USDC has 6 decimals), as a decimal string. */
  maxAmountRequired: string;
  resource: string;
  description: string;
  mimeType: string;
  payTo: Address;
  maxTimeoutSeconds: number;
  asset: Address;
  outputSchema: unknown | null;
  /** EIP-712 domain fields the client needs to build the signature. */
  extra: { name: string; version: string; chainId: number; decimals: number };
}

export interface PaymentRequiredBody {
  x402Version: typeof X402_VERSION;
  error: string;
  accepts: PaymentRequirements[];
}

/** EIP-3009 TransferWithAuthorization message. */
export interface ExactAuthorization {
  from: Address;
  to: Address;
  value: string;
  validAfter: string;
  validBefore: string;
  nonce: Hex;
}

export interface PaymentPayload {
  x402Version: typeof X402_VERSION;
  scheme: "exact";
  network: Network;
  payload: {
    signature: Hex;
    authorization: ExactAuthorization;
  };
}

export interface VerifyResponse {
  isValid: boolean;
  invalidReason?: string;
  payer?: Address;
}

export interface SettleResponse {
  success: boolean;
  errorReason?: string;
  transaction?: Hex;
  network: Network;
  payer?: Address;
}

export function encodePaymentHeader(payload: PaymentPayload): string {
  return Buffer.from(JSON.stringify(payload), "utf8").toString("base64");
}

export function decodePaymentHeader(header: string): PaymentPayload {
  const parsed = JSON.parse(Buffer.from(header, "base64").toString("utf8"));
  if (parsed?.x402Version !== X402_VERSION) throw new Error("unsupported x402Version");
  if (parsed?.scheme !== "exact") throw new Error(`unsupported scheme: ${parsed?.scheme}`);
  if (parsed?.network !== NETWORK) throw new Error(`unsupported network: ${parsed?.network}`);
  const a = parsed?.payload?.authorization;
  if (!a?.from || !a?.to || !a?.value || !a?.nonce) throw new Error("malformed authorization");
  return parsed as PaymentPayload;
}

export function encodeSettleHeader(res: SettleResponse): string {
  return Buffer.from(JSON.stringify(res), "utf8").toString("base64");
}

/** EIP-712 types for the signature the payer produces. */
export const TRANSFER_WITH_AUTHORIZATION_TYPES = {
  TransferWithAuthorization: [
    { name: "from", type: "address" },
    { name: "to", type: "address" },
    { name: "value", type: "uint256" },
    { name: "validAfter", type: "uint256" },
    { name: "validBefore", type: "uint256" },
    { name: "nonce", type: "bytes32" },
  ],
} as const;
