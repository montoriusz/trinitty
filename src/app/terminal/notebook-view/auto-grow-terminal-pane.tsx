import {
  forwardRef,
  type RefObject,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from 'react';
import '@xterm/xterm/css/xterm.css';
import { css } from 'styled-system/css';
import { Box } from 'styled-system/jsx';
import { resizePty } from '@/generated';
import { useIsDarkMode } from '../../shared/dark-mode-provider';
import { useDebouncedCallback } from '../../shared/use-debounced-callback';
import { usedRows } from '../dimensions';
import type { TerminalHandle } from '../split-view/terminal-pane';
import { useEmitUpdateMatching } from '../split-view/use-emit-update-matching';
import { terminal } from '../terminal';
import { getTerminalTheme } from '../themes';
import { useViewportDimensions } from './viewport-dimensions';

export type { TerminalHandle };

export interface AutoGrowTerminalPaneProps {
  /**
   * Element whose box bounds the terminal's maximum size. Retained for layout
   * (`h={maxSizeRef ? undefined : 'full'}`); the geometry itself is now
   * measured once by `ViewportDimensionsProvider` and shared.
   */
  maxSizeRef?: RefObject<HTMLElement | null>;
}

const MIN_ROWS = 3;

export const AutoGrowTerminalPane = forwardRef<TerminalHandle, AutoGrowTerminalPaneProps>(
  function AutoGrowTerminalPane({ maxSizeRef }, handleRef) {
    const containerRef = useRef<HTMLDivElement>(null);
    const rafRef = useRef<number | undefined>(undefined);
    // Shared notebook geometry (cell size, cols, maxRows) — measured once for
    // the whole viewport by `ViewportDimensionsProvider`.
    const dims = useViewportDimensions();
    // Inline cache of the shared dims — read by the mount-once `recomputeHeight`
    // closure without re-subscribing on every `dims` change.
    const dimsRef = useRef(dims);
    dimsRef.current = dims;
    const [heightPx, setHeightPx] = useState<number | undefined>(undefined);
    // Tracks the latest height so the mount-once onRender closure can decide
    // whether the initial fit has succeeded without listing heightPx as a dep.
    const heightPxRef = useRef<number | undefined>(undefined);

    const emitUpdateMatching = useEmitUpdateMatching();
    const isDark = useIsDarkMode();

    // Recompute the visible (CSS) height only — never the xterm grid or PTY.
    // The shell keeps seeing a stable `maxRows × cols` terminal; we just clip
    // the bottom of the fixed grid via the container's height.
    const recomputeHeight = useCallback(() => {
      if (rafRef.current !== undefined) cancelAnimationFrame(rafRef.current);
      rafRef.current = requestAnimationFrame(() => {
        rafRef.current = undefined;
        const d = dimsRef.current;
        if (!d) return;
        const rows = Math.min(d.maxRows, Math.max(MIN_ROWS, usedRows(terminal, d.maxRows)));
        const next = Math.ceil(rows * d.cell.height);
        heightPxRef.current = next;
        setHeightPx(next);
      });
    }, []);

    // `fit` mirrors the split-view contract: fix the xterm grid + PTY at the
    // shared viewport geometry (computed once by `ViewportDimensionsProvider`),
    // then recompute the visible (CSS) height. No-ops until the shared dims
    // are available.
    const fit = useCallback(() => {
      const d = dimsRef.current;
      if (!d) return;

      if (terminal.rows !== d.maxRows || terminal.cols !== d.cols) {
        terminal.resize(d.cols, d.maxRows);
        void resizePty({ rows: d.maxRows, cols: d.cols });
      }

      recomputeHeight();
    }, [recomputeHeight]);

    const scheduleFit = useDebouncedCallback(fit, 100);

    useImperativeHandle(handleRef, () => ({ fit: scheduleFit }), [scheduleFit]);

    // Re-fit the singleton grid + PTY when the shared viewport geometry changes
    // (window resize, sidebar toggle, font/theme change). Covers non-window
    // resizes the `window resize` listener below would miss.
    useEffect(() => {
      if (dims) scheduleFit();
    }, [dims, scheduleFit]);

    // Sync xterm theme with effective dark/light mode (same as split-view pane).
    useEffect(() => {
      terminal.options.theme = getTerminalTheme(isDark);
    }, [isDark]);

    useEffect(() => {
      const container = containerRef.current;
      if (!container) return;
      // The singleton terminal may already be parented here (HMR), or to the
      // split-view pane (view switch). Re-open onto this container.
      if (terminal.element !== container) {
        terminal.open(container);
      }

      // Fix the grid + PTY at the shared viewport geometry. `fit` no-ops until
      // the singleton renderer has produced cell dimensions (so
      // `ViewportDimensionsProvider` has published `dims`); the onRender
      // subscription below drives a follow-up fit on the first paint.
      fit();

      const subs = [
        // Content changes → recompute visible (CSS) height only. No PTY/grid
        // change: the shell keeps seeing a stable `maxRows × cols` terminal.
        terminal.onWriteParsed(recomputeHeight),
        // Interactive shells move the cursor without a fresh write.
        terminal.onCursorMove(recomputeHeight),
        terminal.onResize(recomputeHeight),
        terminal.onRender(() => {
          emitUpdateMatching();
          // First render produces cell dimensions; complete the initial fit.
          if (heightPxRef.current === undefined) fit();
        }),
      ];

      window.addEventListener('resize', scheduleFit);

      return () => {
        window.removeEventListener('resize', scheduleFit);
        for (const sub of subs) sub.dispose();
        if (rafRef.current !== undefined) cancelAnimationFrame(rafRef.current);
      };
      // Re-run only when the stable callbacks change (they don't, since all
      // mutable state lives in refs). In effect, this is mount-once.
    }, [fit, recomputeHeight, scheduleFit, emitUpdateMatching]);

    return (
      // TODO: unify styles for all terminals
      // `flexShrink=0` keeps the pane from being squeezed when it becomes a
      // flex sibling below the scroll area (see the pinned-mode TODO in
      // NotebookView).
      <Box w="full" h={maxSizeRef ? undefined : 'full'} flexShrink="0" position="relative">
        <Box
          ref={containerRef}
          className={terminalContainerStyle}
          width="full"
          py="0.5"
          pl="0.5"
          bg="canvas"
          boxSizing="content-box"
          overflow="hidden"
          style={heightPx === undefined ? undefined : { height: `${heightPx}px` }}
        />
      </Box>
    );
  },
);

const terminalContainerStyle = css({
  '& .sctm-term-cmd': {
    backgroundColor: 'termCmd',
  },
});
