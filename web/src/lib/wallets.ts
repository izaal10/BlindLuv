import type { Connector } from "wagmi";

/**
 * Turn wagmi's connector list into the buttons a person should actually see.
 *
 * Three sources overlap and each can be absent:
 *
 * 1. EIP-6963 discovery — one connector per wallet that announces itself.
 *    This is the good path and usually the only one that fires.
 * 2. `injected({ target: "metaMask" })` — reaches the MetaMask extension when
 *    it does not announce, which happens more often than it should when
 *    several wallets are installed and racing for `window.ethereum`.
 * 3. bare `injected()` — whatever `window.ethereum` happens to be.
 *
 * Two rules follow from that. Dedupe by name, so MetaMask does not appear
 * twice when both (1) and (2) find it. And keep (3) **only when nothing else
 * was found**: with Ronin and MathWallet installed, a button labelled
 * "Injected" is a coin flip over which wallet opens, and offering a coin flip
 * next to named wallets is worse than not offering it.
 */
export function pickWallets(connectors: readonly Connector[]): Connector[] {
  const isFallback = (c: Connector) => c.id === "injected";

  const named = connectors.filter((c) => !isFallback(c));
  const seen = new Set<string>();
  const wallets = named.filter((c) => {
    const key = c.name.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  if (wallets.length > 0) return wallets;
  return connectors.filter(isFallback);
}
