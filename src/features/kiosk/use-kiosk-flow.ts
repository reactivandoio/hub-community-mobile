import { useCallback, useEffect, useRef, useState } from 'react';
import { parseTicket } from '@/features/checkin/ticket';
import type { LocalSignup } from '@/features/checkin/types';
import type { BadgeData } from '@/features/printer/use-print-badge';

export type KioskState =
  | { kind: 'idle' }
  /** A scanned ticket is being resolved (may wait for a sync). */
  | { kind: 'looking_up' }
  /** Picked from the name search: the person must confirm it is them. */
  | { kind: 'confirm'; signup: LocalSignup }
  | { kind: 'printing'; signup: LocalSignup }
  | {
      kind: 'done';
      signup: LocalSignup;
      /** A badge came out of the printer in this interaction. */
      printed: boolean;
      /** They had already been credentialed before this interaction. */
      alreadyCheckedIn: boolean;
      error?: string;
    }
  | { kind: 'not_found' };

export interface KioskDeps {
  /** Reads the live cache, so a lookup after `syncNow` sees the new signups. */
  findSignup(id: string): LocalSignup | undefined;
  badge(signup: LocalSignup): BadgeData;
  printerReady: boolean;
  print(data: BadgeData): Promise<void>;
  checkIn(signupId: string): void;
  markPrinted(signupId: string): void;
  syncNow(): Promise<void>;
  /** How long `done` / `not_found` stay on screen before the kiosk resets. */
  resetAfterMs?: number;
  /** Repeated scans of the same payload inside this window are ignored. */
  rescanAfterMs?: number;
  now?: () => number;
}

export interface KioskFlow {
  state: KioskState;
  /** Raw QR payload from the camera. */
  scan(payload: string): void;
  /** A row tapped in the name search. */
  select(signup: LocalSignup): void;
  confirm(): void;
  cancel(): void;
  /** From `done`: print the badge again without touching the check-in. */
  reprint(): void;
  /** Back to `idle` right away. */
  next(): void;
}

const IDLE: KioskState = { kind: 'idle' };

/**
 * Self-service credentialing: scan or pick → (confirm) → print → check-in →
 * welcome screen → reset. A scanned ticket is unambiguous and skips the
 * confirmation; a name picked from the search does not. Printing failures
 * never block the check-in — the welcome screen sends people to the desk.
 */
export function useKioskFlow(deps: KioskDeps): KioskFlow {
  const [state, setStateRaw] = useState<KioskState>(IDLE);
  // Latest deps for the async steps (synced in an effect: refs are not
  // written during render). Every read happens in an event handler or after
  // an await, i.e. after the effect has run.
  const depsRef = useRef(deps);
  useEffect(() => {
    depsRef.current = deps;
  });
  const stateRef = useRef<KioskState>(IDLE);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastScan = useRef<{ payload: string; at: number } | null>(null);
  // Bumped on every transition; an async step that finished after a later
  // transition (e.g. `next()` during a slow sync) must not overwrite it.
  const epoch = useRef(0);

  const clearTimer = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  };

  const goIdle = useCallback(() => {
    clearTimer();
    epoch.current += 1;
    stateRef.current = IDLE;
    setStateRaw(IDLE);
  }, []);

  const setState = useCallback(
    (next: KioskState) => {
      clearTimer();
      epoch.current += 1;
      stateRef.current = next;
      setStateRaw(next);
      if (next.kind === 'done' || next.kind === 'not_found') {
        timer.current = setTimeout(goIdle, depsRef.current.resetAfterMs ?? 5000);
      }
    },
    [goIdle],
  );

  useEffect(() => clearTimer, []);

  const credential = useCallback(
    async (signup: LocalSignup) => {
      const d = depsRef.current;
      if (signup.checked_in) {
        setState({ kind: 'done', signup, printed: false, alreadyCheckedIn: true });
        return;
      }
      setState({ kind: 'printing', signup });
      const started = epoch.current;
      let printed = false;
      let error: string | undefined;
      if (d.printerReady) {
        try {
          await d.print(d.badge(signup));
          printed = true;
        } catch (e) {
          error = (e as Error).message;
        }
      }
      if (epoch.current !== started) return;
      d.checkIn(signup.id);
      if (printed) d.markPrinted(signup.id);
      const fresh = d.findSignup(signup.id) ?? { ...signup, checked_in: true };
      setState({ kind: 'done', signup: fresh, printed, alreadyCheckedIn: false, error });
    },
    [setState],
  );

  const scan = useCallback(
    (payload: string) => {
      if (stateRef.current.kind !== 'idle') return;
      const d = depsRef.current;
      const id = parseTicket(payload);
      if (!id) return;
      const now = (d.now ?? Date.now)();
      const last = lastScan.current;
      if (last && last.payload === payload && now - last.at < (d.rescanAfterMs ?? 4000)) return;
      lastScan.current = { payload, at: now };

      const hit = d.findSignup(id);
      if (hit) {
        void credential(hit);
        return;
      }
      // Just signed up on their phone? The cache may not have pulled yet.
      setState({ kind: 'looking_up' });
      const started = epoch.current;
      void d
        .syncNow()
        .catch(() => undefined)
        .then(() => {
          if (epoch.current !== started) return;
          const found = depsRef.current.findSignup(id);
          if (found) void credential(found);
          else setState({ kind: 'not_found' });
        });
    },
    [credential, setState],
  );

  const select = useCallback(
    (signup: LocalSignup) => {
      if (stateRef.current.kind !== 'idle') return;
      setState({ kind: 'confirm', signup });
    },
    [setState],
  );

  const confirm = useCallback(() => {
    const s = stateRef.current;
    if (s.kind !== 'confirm') return;
    void credential(s.signup);
  }, [credential]);

  const reprint = useCallback(() => {
    const s = stateRef.current;
    if (s.kind !== 'done') return;
    const d = depsRef.current;
    const { signup } = s;
    setState({ kind: 'printing', signup });
    const started = epoch.current;
    void d
      .print(d.badge(signup))
      .then(() => {
        if (epoch.current !== started) return;
        d.markPrinted(signup.id);
        setState({ kind: 'done', signup, printed: true, alreadyCheckedIn: s.alreadyCheckedIn });
      })
      .catch((e: Error) => {
        if (epoch.current !== started) return;
        setState({ kind: 'done', signup, printed: false, alreadyCheckedIn: s.alreadyCheckedIn, error: e.message });
      });
  }, [setState]);

  return { state, scan, select, confirm, cancel: goIdle, reprint, next: goIdle };
}
