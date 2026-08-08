import "server-only";

import {
  createPublicClient,
  createWalletClient,
  http,
  verifyTypedData,
  type Address,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";

import { CHAIN, CHAIN_ID, USDC_ADDRESS, USDC_EIP712_NAME, USDC_EIP712_VERSION } from "@/lib/chain";
import { usdcAbi } from "@/lib/abi";
import {
  NETWORK,
  TRANSFER_WITH_AUTHORIZATION_TYPES,
  type PaymentPayload,
  type PaymentRequirements,
  type SettleResponse,
  type VerifyResponse,
} from "./types";

/**
 * Self-hosted x402 facilitator for Monad testnet.
 *
 * The public Coinbase facilitator only settles on the networks its SDK knows
 * about, and Monad is not among them yet. Since Monad testnet USDC implements
 * EIP-3009, running the facilitator ourselves is a small amount of code and
 * keeps the payment fully on-chain and verifiable.
 *
 * `verify` is pure signature + state checking and needs no key.
 * `settle` broadcasts `transferWithAuthorization` and needs a funded relayer.
 */

const publicClient = createPublicClient({ chain: CHAIN, transport: http() });

function relayer() {
  const key = process.env.FACILITATOR_PRIVATE_KEY;
  if (!key) return null;
  const normalized = (key.startsWith("0x") ? key : `0x${key}`) as Hex;
  return privateKeyToAccount(normalized);
}

/** Whether this deployment can actually broadcast settlements. */
export function canSettle() {
  return relayer() !== null;
}

const usdcDomain = {
  name: USDC_EIP712_NAME,
  version: USDC_EIP712_VERSION,
  chainId: CHAIN_ID,
  verifyingContract: USDC_ADDRESS,
} as const;

/**
 * Full `exact`-scheme verification: the signature must be valid, the
 * authorization must match what the resource asked for, the time window must
 * be open, the nonce must be unused, and the payer must actually hold the
 * funds. Anything short of all five is a rejection — a facilitator that only
 * checks the signature is a facilitator that settles bounced payments.
 */
export async function verify(
  payment: PaymentPayload,
  requirements: PaymentRequirements,
): Promise<VerifyResponse> {
  const { authorization, signature } = payment.payload;

  if (payment.network !== requirements.network) {
    return { isValid: false, invalidReason: "network_mismatch" };
  }
  if (authorization.to.toLowerCase() !== requirements.payTo.toLowerCase()) {
    return { isValid: false, invalidReason: "recipient_mismatch" };
  }

  let value: bigint;
  let validAfter: bigint;
  let validBefore: bigint;
  try {
    value = BigInt(authorization.value);
    validAfter = BigInt(authorization.validAfter);
    validBefore = BigInt(authorization.validBefore);
  } catch {
    return { isValid: false, invalidReason: "malformed_authorization" };
  }

  if (value < BigInt(requirements.maxAmountRequired)) {
    return { isValid: false, invalidReason: "insufficient_amount" };
  }

  const now = BigInt(Math.floor(Date.now() / 1000));
  if (now < validAfter) return { isValid: false, invalidReason: "authorization_not_yet_valid" };
  // Leave headroom so the authorization is still valid when the settle
  // transaction lands. Monad finalises in ~800ms, so this is generous.
  if (now + 6n >= validBefore) return { isValid: false, invalidReason: "authorization_expired" };

  const signatureValid = await verifyTypedData({
    address: authorization.from,
    domain: usdcDomain,
    types: TRANSFER_WITH_AUTHORIZATION_TYPES,
    primaryType: "TransferWithAuthorization",
    message: {
      from: authorization.from,
      to: authorization.to,
      value,
      validAfter,
      validBefore,
      nonce: authorization.nonce,
    },
    signature,
  });
  if (!signatureValid) return { isValid: false, invalidReason: "invalid_signature" };

  // `latest` is the speculatively-executed head. eth_call simulates against it
  // and returns accurate results even though Monad's execution lags consensus,
  // so it is the right tag for a pre-flight check.
  const [used, balance] = await Promise.all([
    publicClient.readContract({
      address: requirements.asset,
      abi: usdcAbi,
      functionName: "authorizationState",
      args: [authorization.from, authorization.nonce],
      blockTag: "latest",
    }),
    publicClient.readContract({
      address: requirements.asset,
      abi: usdcAbi,
      functionName: "balanceOf",
      args: [authorization.from],
      blockTag: "latest",
    }),
  ]);

  if (used) return { isValid: false, invalidReason: "authorization_already_used" };
  if (balance < value) return { isValid: false, invalidReason: "insufficient_funds" };

  return { isValid: true, payer: authorization.from };
}

/**
 * Broadcast the authorization. The payer signed it; the relayer pays the gas —
 * which is the whole point of x402: the user needs USDC, not MON.
 */
export async function settle(
  payment: PaymentPayload,
  requirements: PaymentRequirements,
): Promise<SettleResponse> {
  const account = relayer();
  if (!account) {
    return { success: false, errorReason: "facilitator_not_configured", network: NETWORK };
  }

  const check = await verify(payment, requirements);
  if (!check.isValid) {
    return { success: false, errorReason: check.invalidReason, network: NETWORK };
  }

  const { authorization, signature } = payment.payload;
  const wallet = createWalletClient({ account, chain: CHAIN, transport: http() });

  const args = [
    authorization.from,
    authorization.to,
    BigInt(authorization.value),
    BigInt(authorization.validAfter),
    BigInt(authorization.validBefore),
    authorization.nonce,
    signature,
  ] as const;

  try {
    // Simulate first so a revert surfaces as a clean error instead of a
    // failed on-chain transaction the payer still pays gas-limit for.
    const { request } = await publicClient.simulateContract({
      account,
      address: requirements.asset,
      abi: usdcAbi,
      functionName: "transferWithAuthorization",
      args,
    });

    const gas = await publicClient.estimateContractGas({
      account,
      address: requirements.asset,
      abi: usdcAbi,
      functionName: "transferWithAuthorization",
      args,
    });

    // Monad charges on gas_limit, so keep the buffer small.
    const hash = await wallet.writeContract({ ...request, gas: gas + gas / 10n });
    const receipt = await publicClient.waitForTransactionReceipt({ hash });

    if (receipt.status !== "success") {
      return { success: false, errorReason: "settlement_reverted", transaction: hash, network: NETWORK };
    }
    return { success: true, transaction: hash, network: NETWORK, payer: authorization.from };
  } catch (error) {
    return {
      success: false,
      errorReason: error instanceof Error ? error.message.slice(0, 200) : "settlement_failed",
      network: NETWORK,
    };
  }
}

export function facilitatorAddress(): Address | null {
  return relayer()?.address ?? null;
}
