import { useCallback, useEffect, useRef } from 'react';

/** Cancels the previous read and guards commits even when a transport ignores abort. */
export function useLatestRequest() {
  const active = useRef<AbortController | null>(null);
  const cancel = useCallback(() => {
    active.current?.abort();
    active.current = null;
  }, []);
  const begin = useCallback(() => {
    active.current?.abort();
    const controller = new AbortController();
    active.current = controller;
    return { signal: controller.signal, current: () => active.current === controller && !controller.signal.aborted };
  }, []);
  useEffect(() => cancel, [cancel]);
  return { begin, cancel };
}
