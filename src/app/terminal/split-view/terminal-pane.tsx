import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import { Box } from 'styled-system/jsx';

import '@xterm/xterm/css/xterm.css';
import { css } from 'styled-system/css';
import { useIsDarkMode } from '../../shared/dark-mode-provider';
import { useDebouncedCallback } from '../../shared/use-debounced-callback';
import { fitTerminal, terminal } from '../terminal';
import { getTerminalTheme } from '../themes';
import { useEmitUpdateMatching } from './use-emit-update-matching';

export interface TerminalHandle {
  fit: () => void;
}

export const TerminalPane = forwardRef<TerminalHandle>(function TerminalPane(_, handleRef) {
  const containerRef = useRef<HTMLDivElement>(null);
  const emitUpdateMatching = useEmitUpdateMatching();
  const scheduleFit = useDebouncedCallback(fitTerminal, 100);
  const isDark = useIsDarkMode();

  useImperativeHandle(handleRef, () => ({ fit: scheduleFit }), [scheduleFit]);

  // Sync the xterm theme with the effective UI dark/light mode. Matches the
  // previous behaviour in providers.tsx, where this only ran in the main
  // window (the settings window never mounts a TerminalPane).
  useEffect(() => {
    terminal.options.theme = getTerminalTheme(isDark);
  }, [isDark]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || terminal.element === container) return;

    terminal.open(container);

    const scrollHandler = terminal.onRender(() => {
      emitUpdateMatching();
    });

    fitTerminal();
    window.addEventListener('resize', scheduleFit);

    return () => {
      window.removeEventListener('resize', scheduleFit);
      scrollHandler.dispose();
    };
  }, [scheduleFit, emitUpdateMatching]);

  return (
    <Box
      ref={containerRef}
      className={terminalContainerStyle}
      h="full"
      w="full"
      py="0.5"
      pl="1.5"
      bg="canvas"
      borderRadius="l3"
      overflow="hidden"
    />
  );
});

const terminalContainerStyle = css({
  '& .sctm-term-cmd': {
    backgroundColor: 'termCmd',
  },
});
