import {
  createContext,
  type ReactNode,
  type RefObject,
  useContext,
  useEffect,
  useState,
} from 'react';
import { getCellSize, proposeMaxDimensions } from '../dimensions';
import { terminal } from '../terminal';

export interface ViewportDimensions {
  /** Render cell size in CSS pixels (shared font/theme ⇒ same for every terminal). */
  cell: { width: number; height: number };
  /** Column count that fits the viewport's content width. */
  cols: number;
  /** Upper row limit: the most rows any terminal in this viewport should occupy. */
  maxRows: number;
}

const ViewportDimensionsContext = createContext<ViewportDimensions | undefined>(undefined);

export interface ViewportDimensionsProviderProps {
  /**
   * The chat scroll viewport element. Every notebook terminal (the live
   * `AutoGrowTerminalPane` and each committed `TerminalSectionBlock`) is a
   * descendant, so its content box bounds both the column count and the
   * upper row limit — computed once here and shared instead of re-measured
   * per terminal.
   */
  viewportRef: RefObject<HTMLDivElement | null>;
  children: ReactNode;
}

/**
 * Computes the notebook terminal geometry — `{ cell, cols, maxRows }` — once
 * against the shared scroll viewport and shares it with every terminal in the
 * notebook view (the live `AutoGrowTerminalPane` and the committed
 * `TerminalSectionBlock`s). All notebook terminals share the same font/theme,
 * so a single `proposeMaxDimensions` call against the singleton `terminal`
 * (which xterm has rendered with that font) is authoritative for every block.
 *
 * The chrome walked between the terminal element and the viewport is assumed
 * equal for the pane and the blocks, so the one measurement applies to both.
 *
 * Recomputes on viewport resize and on the singleton's `onRender` (the cell
 * size only exists after the first render, and can change on font/theme
 * switches).
 */
export function ViewportDimensionsProvider({
  viewportRef,
  children,
}: Readonly<ViewportDimensionsProviderProps>) {
  const [dims, setDims] = useState<ViewportDimensions | undefined>(undefined);

  useEffect(() => {
    const viewportEl = viewportRef.current;
    if (!viewportEl) return;

    const compute = () => {
      // `proposeMaxDimensions` and `getCellSize` both return `undefined` until
      // the singleton's renderer has produced cell dimensions (i.e. after the
      // `AutoGrowTerminalPane` has opened + first-painted it). The
      // `onRender` subscription below then re-runs `compute`.
      const maxDims = proposeMaxDimensions(terminal, viewportEl);
      const cell = getCellSize(terminal);
      if (!maxDims || !cell) return;
      setDims({ cell, cols: maxDims.cols, maxRows: maxDims.rows });
    };

    compute();

    // Viewport-driven changes (window resize, sidebar toggles, chat layout
    // reflows) — emits for any size change of the viewport box.
    const resizeObserver = new ResizeObserver(compute);
    resizeObserver.observe(viewportEl);

    // Cell-size-driven changes: the first render produces dimensions (the
    // initial `compute` above no-ops until then), and a font/theme change
    // produces new ones.
    const onRenderSub = terminal.onRender(compute);

    return () => {
      resizeObserver.disconnect();
      onRenderSub.dispose();
    };
    // `viewportRef` is a stable ref object; the effect is effectively
    // mount-once and re-reads `viewportRef.current` on every `compute`.
  }, [viewportRef]);

  return (
    <ViewportDimensionsContext.Provider value={dims}>{children}</ViewportDimensionsContext.Provider>
  );
}

/**
 * Shared notebook terminal geometry. `undefined` until the singleton terminal
 * has rendered (so cell dimensions exist) and the viewport has been measured.
 */
export function useViewportDimensions(): ViewportDimensions | undefined {
  return useContext(ViewportDimensionsContext);
}
