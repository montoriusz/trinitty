import { type ReactNode, useCallback, useMemo, useRef } from 'react';
import { UpdateMatchingContext, type UpdateMatchingContextValue } from './context';

export function UpdateMatchingProvider({ children }: { children: ReactNode }) {
  const listenersRef = useRef(new Set<() => void>());

  const emit = useCallback(() => {
    for (const callback of listenersRef.current) {
      callback();
    }
  }, []);

  const subscribe = useCallback((callback: () => void) => {
    listenersRef.current.add(callback);
    return () => {
      listenersRef.current.delete(callback);
    };
  }, []);

  const value = useMemo<UpdateMatchingContextValue>(() => ({ emit, subscribe }), [emit, subscribe]);

  return <UpdateMatchingContext.Provider value={value}>{children}</UpdateMatchingContext.Provider>;
}
