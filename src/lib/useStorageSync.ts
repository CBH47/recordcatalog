"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Drop-in replacement for useState that persists in localStorage AND
 * re-syncs whenever the page becomes visible (handles Next.js App Router
 * router-cache restoring stale in-memory state without remounting).
 */
export function useStorageSync<T>(
  key: string,
  fallback: T
): [T, (next: T) => void] {
  const [state, setState] = useState<T>(fallback);
  const fallbackRef = useRef(fallback);

  const read = useCallback((): T => {
    try {
      const raw = localStorage.getItem(key);
      if (raw === null) return fallbackRef.current;
      return JSON.parse(raw) as T;
    } catch {
      return fallbackRef.current;
    }
  }, [key]);

  useEffect(() => {
    // Initial population
    setState(read());

    // Re-sync whenever the page becomes active.
    // This covers:
    //   - Full browser reload (mount fires fresh)
    //   - Next.js router-cache restoring stale state (visibilitychange fires)
    //   - User alt-tabbing back (focus fires)
    //   - Another tab mutating localStorage (storage fires)
    const sync = () => setState(read());

    window.addEventListener("focus", sync);
    document.addEventListener("visibilitychange", sync);
    window.addEventListener("storage", sync);

    return () => {
      window.removeEventListener("focus", sync);
      document.removeEventListener("visibilitychange", sync);
      window.removeEventListener("storage", sync);
    };
  }, [read]);

  const set = useCallback(
    (next: T) => {
      try {
        localStorage.setItem(key, JSON.stringify(next));
      } catch {
        // quota or security error — update state anyway so UI stays consistent
      }
      setState(next);
    },
    [key]
  );

  return [state, set];
}
