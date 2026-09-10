"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Stretches a pending flag so the user can actually see it.
 *
 * THE PROBLEM. Most actions in this app finish in roughly 100ms — a scoped
 * `updateMany` and a revalidate. `useTransition` reports that faithfully, which
 * means a spinner bound directly to it renders for one or two frames. The
 * result reads as no feedback at all, or worse, as a flicker: the eye catches
 * that *something* changed without registering what, which is more unsettling
 * than a button that simply did its job quietly.
 *
 * THE FIX. `minimum` is the whole mechanism: once a spinner appears it stays
 * for long enough to read, however fast the work underneath finished.
 *
 * `delay` defaults to 0, and that is deliberate. The conventional pattern
 * withholds a spinner for the first ~150ms so quick actions never blink — but
 * that only makes sense WITHOUT a minimum duration, because the blink it
 * prevents is a spinner appearing and vanishing. `minimum` already rules that
 * out. Keeping both would mean a 90ms action shows nothing at all, which is
 * precisely the "I clicked and nothing happened" this hook exists to fix.
 *
 * So every action shows feedback, and every spinner is on screen long enough
 * to register. Raise `delay` only for something genuinely instant and
 * high-frequency, where confirmation is not worth the wait.
 *
 * This makes a 100ms action feel like a 400ms one, and that is a real cost. It
 * buys certainty that the click registered, which for a destructive or
 * irreversible action — rejecting a candidate, archiving a job post — is worth
 * more than the milliseconds.
 */
export function useVisiblePending(
  pending: boolean,
  { delay = 0, minimum = 400 }: { delay?: number; minimum?: number } = {},
): boolean {
  const [visible, setVisible] = useState(false);
  /** When the spinner actually appeared, for measuring `minimum` against. */
  const shownAt = useRef<number | null>(null);

  useEffect(() => {
    if (pending) {
      // Already showing from a previous run — nothing to schedule.
      if (visible) return;

      const timer = setTimeout(() => {
        shownAt.current = Date.now();
        setVisible(true);
      }, delay);

      return () => clearTimeout(timer);
    }

    // Only reachable with a non-zero `delay`: the work finished before the
    // spinner was ever scheduled in, so there is nothing to hold on screen.
    if (!visible) return;

    const elapsed = Date.now() - (shownAt.current ?? Date.now());
    const remaining = Math.max(0, minimum - elapsed);

    const timer = setTimeout(() => {
      shownAt.current = null;
      setVisible(false);
    }, remaining);

    return () => clearTimeout(timer);
  }, [pending, visible, delay, minimum]);

  return visible;
}
