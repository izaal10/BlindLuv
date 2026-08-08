#!/usr/bin/env node
/**
 * Stand up a complete local BlindLuv chain.
 *
 *   node scripts/local-setup.mjs 0xYourMetaMaskAddress
 *
 * Anvil forks Monad testnet, so the USDC at
 * 0x534b2f3A21130d7a60830c2Df862319e593943A3 is the *real* Circle contract
 * with real EIP-3009 behaviour — the x402 path is exercised for real, not
 * mocked. What the fork adds is money: it can mint MON and USDC out of thin
 * air, which is the whole reason this exists. The public faucet is
 * captcha-gated (correctly — it stops bots), and a fork sidesteps the need
 * for it entirely rather than trying to work around it.
 *
 * Assumes `anvil --fork-url https://testnet-rpc.monad.xyz` is already running.
 */
import { execFileSync } from "node:child_process";
import { writeFileSync, readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const RPC = process.env.LOCAL_RPC ?? "http://127.0.0.1:8545";
const USDC = "0x534b2f3A21130d7a60830c2Df862319e593943A3";

// Anvil's first default account — deterministic, publicly known, testnet only.
const DEPLOYER = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
const DEPLOYER_ADDR = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266";

/**
 * Every address given is funded. Pass a second one to play both sides of a
 * match yourself — matching needs two profiles, so testing alone otherwise
 * means a wallet with no USDC failing at the stake step.
 */
const users = process.argv.slice(2).filter((a) => /^0x[0-9a-fA-F]{40}$/.test(a));
if (users.length === 0) {
  console.error("Usage: node scripts/local-setup.mjs 0xYourAddress [0xSecondAddress ...]");
  process.exit(1);
}

const sh = (cmd, args, opts = {}) =>
  execFileSync(cmd, args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], ...opts }).trim();

const rpc = (method, params) =>
  sh("cast", ["rpc", "--rpc-url", RPC, method, ...params.map((p) => (typeof p === "string" ? p : JSON.stringify(p)))]);

function requireAnvil() {
  try {
    const id = sh("cast", ["chain-id", "--rpc-url", RPC]);
    console.log(`✓ local chain reachable (chain id ${id})`);
    return id;
  } catch {
    console.error(
      `✗ No chain at ${RPC}.\n\n  Start one first, in another terminal:\n\n` +
        `    anvil --fork-url https://testnet-rpc.monad.xyz --chain-id 31337\n`,
    );
    process.exit(1);
  }
}

/** 1 million MON. Well over the 10 MON reserve-balance floor. */
const ONE_MILLION_ETH = "0xD3C21BCECCEDA1000000";

function fundNative(address, label) {
  rpc("anvil_setBalance", [address, ONE_MILLION_ETH]);
  console.log(`✓ funded ${label} with MON`);
}

/**
 * Give an address USDC by writing the balances mapping directly.
 *
 * FiatTokenV2 keeps `balances` at storage slot 9 — confirmed empirically
 * against this fork, not assumed from the source layout, since the proxy could
 * have been upgraded. Writing storage is far more robust than impersonating
 * whichever whale happens to hold USDC at that particular fork block.
 * balanceOf is read back before this reports success.
 */
function fundUsdc(address, label, human = "1000") {
  const slot = sh("cast", ["index", "address", address, "9"]);
  const amount = BigInt(human) * 1_000_000n;
  rpc("anvil_setStorageAt", [USDC, slot, `0x${amount.toString(16).padStart(64, "0")}`]);

  const onchain = sh("cast", ["call", USDC, "balanceOf(address)(uint256)", address, "--rpc-url", RPC]).split(/\s+/)[0];
  if (BigInt(onchain) !== amount) {
    throw new Error(`USDC funding failed for ${label}: balanceOf returned ${onchain}, expected ${amount}`);
  }
  console.log(`✓ funded ${label} with ${human} USDC`);
}

function main() {
  requireAnvil();

  const keysPath = join(ROOT, "web", ".env.local");
  let operator = process.env.OPERATOR_ADDRESS;
  if (!operator && existsSync(keysPath)) {
    const m = readFileSync(keysPath, "utf8").match(/# address:\s*(0x[0-9a-fA-F]{40})/);
    if (m) operator = m[1];
  }
  if (!operator) {
    console.error("Could not determine the operator address. Set OPERATOR_ADDRESS.");
    process.exit(1);
  }

  console.log("\n— funding —");
  fundNative(DEPLOYER_ADDR, "deployer");
  fundNative(operator, `operator ${operator}`);
  for (const [i, u] of users.entries()) {
    fundNative(u, `wallet ${i + 1} ${u}`);
    fundUsdc(u, `wallet ${i + 1}`);
  }
  fundUsdc(operator, "operator", "100");

  console.log("\n— deploying BlindLuv —");
  const out = sh(
    "forge",
    [
      "script",
      "script/Deploy.s.sol:Deploy",
      "--rpc-url",
      RPC,
      "--broadcast",
      "--private-key",
      DEPLOYER,
      "--skip-simulation",
    ],
    {
      cwd: join(ROOT, "contracts"),
      env: { ...process.env, AGENT_ADDRESS: operator, OWNER_ADDRESS: DEPLOYER_ADDR, PATH: process.env.PATH },
    },
  );

  const deployed = out.match(/BlindLuv deployed:\s*(0x[0-9a-fA-F]{40})/);
  if (!deployed) {
    console.error(out);
    throw new Error("Could not find the deployed address in forge output.");
  }
  const contract = deployed[1];
  console.log(`✓ BlindLuv at ${contract}`);

  // The agent must be authorised before it can open sessions.
  sh("cast", [
    "send",
    contract,
    "setAgent(address,bool)",
    operator,
    "true",
    "--rpc-url",
    RPC,
    "--private-key",
    DEPLOYER,
  ]);
  console.log(`✓ authorised agent ${operator}`);

  const envPath = join(ROOT, "web", ".env.local");
  let env = existsSync(envPath) ? readFileSync(envPath, "utf8") : "";
  const upsert = (key, value) => {
    const line = `${key}=${value}`;
    env = new RegExp(`^${key}=.*$`, "m").test(env) ? env.replace(new RegExp(`^${key}=.*$`, "m"), line) : `${env}\n${line}`;
  };
  upsert("NEXT_PUBLIC_CHAIN_MODE", "local");
  upsert("NEXT_PUBLIC_LOCAL_RPC_URL", RPC);
  upsert("NEXT_PUBLIC_BLINDLUV_ADDRESS", contract);
  writeFileSync(envPath, env.trimStart() + "\n");
  console.log("✓ wrote web/.env.local");

  console.log(`
— done —

  Contract   ${contract}
  Funded     ${users.join('\n             ')}\n             each with 1,000,000 MON and 1000 USDC
  Agent      ${operator}

  Add this network to MetaMask:
    Name      BlindLuv Local
    RPC       ${RPC}
    Chain ID  31337
    Currency  MON

  Then:  cd web && npm run dev
`);
}

main();
