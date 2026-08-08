import { useSyncExternalStore } from "react";

const subscribe = () => () => {};
const getSnapshot = () => true;
const getServerSnapshot = () => false;

/**
 * `false` during SSR and the first client render, `true` afterwards.
 *
 * Wallet state only exists in the browser, so the server cannot render it
 * honestly. `useSyncExternalStore` is the right primitive for that: React
 * knows the server and client snapshots differ on purpose, so there is no
 * hydration mismatch — and unlike a `setState` inside `useEffect`, it does not
 * trigger a cascading render.
 */
export function useIsHydrated(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
