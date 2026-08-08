"use client";

/**
 * Desktop notifications for the two moments this app makes you wait.
 *
 * Everything else here is a button you press and a result you see. But
 * "waiting for the other side to stake" and "waiting for them to reply" are
 * genuinely open-ended — you would otherwise leave the tab open and keep
 * checking it, which is exactly the job a notification exists for.
 *
 * Three rules, all of them about not being annoying:
 *
 * - Permission is requested on a real action, never on page load. A prompt
 *   that appears before you have done anything gets denied, and a denial is
 *   permanent until the user digs through browser settings.
 * - Nothing fires while the tab is visible. You do not need telling about
 *   something you are looking at.
 * - Every notification is silent and re-uses a tag per kind, so a burst of
 *   replies collapses into one entry instead of a stack.
 */

const supported = () => typeof window !== "undefined" && "Notification" in window;

export function notifyPermission(): NotificationPermission | "unsupported" {
  return supported() ? Notification.permission : "unsupported";
}

/** Ask once, on purpose. Returns whether we may notify from here on. */
export async function askToNotify(): Promise<boolean> {
  if (!supported()) return false;
  if (Notification.permission === "granted") return true;
  if (Notification.permission === "denied") return false;
  try {
    return (await Notification.requestPermission()) === "granted";
  } catch {
    return false;
  }
}

export function notify(title: string, body: string, tag: string): void {
  if (!supported() || Notification.permission !== "granted") return;
  // Looking at the tab already counts as being told.
  if (typeof document !== "undefined" && document.visibilityState === "visible") return;
  try {
    new Notification(title, { body, tag, icon: "/logo.png", silent: true });
  } catch {
    // Some browsers reject construction outside a service worker. A missing
    // notification is not worth breaking the page over.
  }
}

/**
 * Unread count in the tab title, for people who keep the tab open in the
 * background — which, in practice, is how anyone waits for a reply.
 */
const BASE_TITLE = "BlindLuv";

export function setUnreadBadge(count: number): void {
  if (typeof document === "undefined") return;
  document.title = count > 0 ? `(${count}) ${BASE_TITLE}` : BASE_TITLE;
}
