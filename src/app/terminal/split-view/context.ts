import { createContext } from 'react';

export interface UpdateMatchingContextValue {
  emit: () => void;
  subscribe: (callback: () => void) => () => void;
}

export const UpdateMatchingContext = createContext<UpdateMatchingContextValue | null>(null);
