import type { Connector } from "wagmi";

/** The connectors we configure ourselves; everything else came from EIP-6963. */
const CONFIGURED_IDS = new Set(["metaMask", "injected"]);

/**
 * Turn wagmi's connector list into the buttons a person should actually see.
 *
 * Connectors arrive from two places and neither is reliable alone:
 *
 * - **EIP-6963 discovery** — one connector per wallet that announces itself.
 *   These always work, because the connector holds the provider the wallet
 *   handed over directly. They carry an icon, which is how you can tell them
 *   apart on screen.
 * - **Our configured fallbacks** — `injected({ target: "metaMask" })` and bare
 *   `injected()`. Both have to *find* a provider on `window.ethereum`, and with
 *   several extensions installed the winner of that fight is not predictable.
 *
 * So discovered wallets come first and win any name collision. A configured
 * fallback only appears when discovery did not already produce that wallet —
 * otherwise clicking "MetaMask" could pick the flaky path over the reliable one
 * sitting right next to it.
 *
 * The bare `injected()` entry is kept even when named wallets exist. It is a
 * coin flip over whichever extension owns `window.ethereum`, which is a poor
 * option — but when a wallet is installed and simply refuses to announce, it is
 * the only remaining way in, and a poor option beats a dead end.
 */
export function pickWallets(connectors: readonly Connector[]): Connector[] {
  const discovered = connectors.filter((c) => !CONFIGURED_IDS.has(c.id));
  const configured = connectors.filter((c) => CONFIGURED_IDS.has(c.id));

  const seen = new Set(discovered.map((c) => c.name.toLowerCase()));
  const wallets = [...discovered];

  for (const c of configured) {
    if (c.id === "injected") continue; // handled last, below
    if (seen.has(c.name.toLowerCase())) continue;
    seen.add(c.name.toLowerCase());
    wallets.push(c);
  }

  const generic = configured.find((c) => c.id === "injected");
  if (generic) wallets.push(generic);

  return wallets;
}

/**
 * "Injected" is what wagmi calls the generic connector, and it means nothing to
 * anyone who has not read the EIP. Say what the button will actually do.
 */
export function walletLabel(connector: Connector): string {
  return connector.id === "injected" ? "whichever wallet owns this page" : connector.name;
}

/**
 * Ask every EIP-6963 wallet to announce itself again.
 *
 * Discovery is a handshake: the page dispatches `eip6963:requestProvider` and
 * wallets reply with `eip6963:announceProvider`. A wallet that injects late —
 * or that lost a start-up race with another extension over `window.ethereum` —
 * can miss the original request and then never appear, which looks exactly like
 * not being installed. Re-dispatching costs nothing and wagmi's listener is
 * still subscribed, so any straggler shows up within a tick.
 */
export function rescanWallets(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event("eip6963:requestProvider"));
}

interface MaybeFlagged {
  isMetaMask?: boolean;
  isRonin?: boolean;
  isMathWallet?: boolean;
  isRabby?: boolean;
  isPhantom?: boolean;
  isCoinbaseWallet?: boolean;
  providers?: MaybeFlagged[];
}

/**
 * What `window.ethereum` actually is, in plain words.
 *
 * "Provider not found" tells a user nothing they can act on. Naming the
 * extension that won the `window.ethereum` slot turns it into a decision:
 * disable that one, or use its own button.
 */
export function describeInjected(): string | null {
  if (typeof window === "undefined") return null;
  const eth = (window as { ethereum?: MaybeFlagged }).ethereum;
  if (!eth) return "No extension has claimed window.ethereum on this page.";

  const nameOf = (p: MaybeFlagged) => {
    if (p.isMetaMask && !p.isMathWallet && !p.isRabby && !p.isPhantom) return "MetaMask";
    if (p.isRonin) return "Ronin";
    if (p.isMathWallet) return "MathWallet";
    if (p.isRabby) return "Rabby";
    if (p.isPhantom) return "Phantom";
    if (p.isCoinbaseWallet) return "Coinbase Wallet";
    return "an unidentified wallet";
  };

  const list = Array.isArray(eth.providers) && eth.providers.length > 0 ? eth.providers : [eth];
  const names = [...new Set(list.map(nameOf))];
  return `window.ethereum is currently ${names.join(", ")}.`;
}
