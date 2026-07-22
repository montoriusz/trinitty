import { useContext } from 'react';
import { UpdateMatchingContext } from './context';

export function useEmitUpdateMatching(): () => void {
  const ctx = useContext(UpdateMatchingContext);
  return ctx?.emit ?? noop;
}

function noop() {}
