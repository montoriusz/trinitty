/** biome-ignore-all lint/correctness/useExhaustiveDependencies: checking individual refs */

import { type Ref, type RefObject, useMemo } from 'react';

type ReactRef<T> = Ref<T> | RefObject<T>;

export function useMergeRefs<T>(...refs: (ReactRef<T> | undefined)[]) {
  return useMemo(() => {
    if (refs.every((ref) => ref == null)) {
      return null;
    }
    return (value: T) => {
      for (const ref of refs) {
        if (!ref) continue;
        try {
          if (typeof ref === 'function') {
            ref(value);
          } else {
            ref.current = value;
          }
        } catch (cause) {
          throw new Error(`useMergeRefs: Cannot assign value '${value}' to ref '${ref}'`, {
            cause,
          });
        }
      }
    };
  }, refs);
}
