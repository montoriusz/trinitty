import type { Terminal } from '@xterm/xterm';

/**
 * Count the last non-empty line within the fixed `maxRows` viewport region.
 *
 * The terminal grid is always fixed at `maxRows` tall, so this is O(maxRows) —
 * not scrollback. Only falls back to the cursor row when the entire viewport
 * is empty (a fresh prompt with no history); counting `cursorY + 1` otherwise
 * over-counts by one because the cursor usually advances to a row below the
 * last written line.
 */
export function usedRows(term: Terminal, maxRows: number): number {
  const buf = term.buffer.active;
  const base = buf.baseY;
  let last = 0;
  for (let i = 0; i < maxRows; i++) {
    const line = buf.getLine(base + i);
    if (line && line.translateToString(true).trim() !== '') last = i + 1;
  }
  return last > 0 ? last : Math.min(maxRows, buf.cursorY + 1);
}

interface RenderDimensionsCell {
  width: number;
  height: number;
}

interface RenderDimensions {
  css: { cell: RenderDimensionsCell };
}

interface TerminalRenderInternals {
  _core?: { _renderService?: { dimensions?: RenderDimensions } };
}

// Runtime scrollbar options not yet in the installed `@xterm/xterm@6.0.0`
// typings (only the slider color fields are public there).
interface TerminalScrollInternals {
  scrollbar?: { showScrollbar?: boolean; width?: number };
}

const MIN_COLS = 2;
const MIN_ROWS = 1;

/**
 * xterm.js render dimensions (`css.cell.{width,height}`) are the source of
 * truth for cell size, but are only reachable through the internal
 * `_renderService` on the installed `@xterm/xterm@6.0.0` +
 * `@xterm/addon-fit@0.11.0`.
 *
 * Newer xterm/addon-fit expose `terminal.dimensions` publicly; once a stable
 * release lands, switch `getCellSize` to read from it.
 *
 * @returns `undefined` until the renderer has produced dimensions (before the
 * first render, or if cell size is 0). Callers must recompute on `onRender`.
 */
export function getCellSize(term: Terminal): { width: number; height: number } | undefined {
  const dims = (term as unknown as TerminalRenderInternals)._core?._renderService?.dimensions?.css
    .cell;
  if (!dims || dims.width === 0 || dims.height === 0) return undefined;
  return { width: dims.width, height: dims.height };
}

/**
 * Computes the maximum rows/cols available in `ancestorEl` — the same way
 * `FitAddon.proposeDimensions` does, but measured against an arbitrary
 * full-height ancestor instead of the (short) terminal parent. Used by the
 * notebook auto-grow pane to fix the xterm grid and the PTY at `maxRows`
 * while only animating the visible container height.
 *
 * @returns the max rows/cols, or `undefined` before the renderer has run.
 */
export function proposeMaxDimensions(
  term: Terminal,
  ancestorEl: HTMLElement,
): { cols: number; rows: number } | undefined {
  if (!term.element) return undefined;

  const cell = getCellSize(term);
  if (!cell) return undefined;

  // Scrollbar only appears when scrollback > 0 and the user has enabled it.
  // Match FitAddon: subtract scrollbar width from available width. The
  // scrollbar options are read via a permissive cast (see TerminalScrollInternals).
  const options = term.options as TerminalScrollInternals;
  const showScrollbar = options.scrollbar?.showScrollbar ?? true;
  const scrollbarWidth =
    term.options.scrollback === 0 || !showScrollbar ? 0 : (options.scrollbar?.width ?? 15);

  // Get the ancestor's *content* box: its border box minus its own chrome.
  // Using the border box directly would overestimate by the padding+border
  // of the ancestor itself.
  const ancestorStyle = window.getComputedStyle(ancestorEl, null);
  const ancestorChrome = chromeOf(ancestorStyle);
  const ancestorHeight = Math.max(
    0,
    parseIntOrZero(ancestorStyle.getPropertyValue('height')) - ancestorChrome.ver,
  );
  const ancestorWidth = Math.max(
    0,
    parseIntOrZero(ancestorStyle.getPropertyValue('width')) - ancestorChrome.hor,
  );
  const intermediate = accumulateChrome(term.element, ancestorEl);
  const availHeight = ancestorHeight - intermediate.ver;
  const availWidth = ancestorWidth - intermediate.hor - scrollbarWidth;

  const cols = Math.max(MIN_COLS, Math.floor(availWidth / cell.width));
  const rows = Math.max(MIN_ROWS, Math.floor(availHeight / cell.height));
  return { cols, rows };
}

export interface ChromeSize {
  hor: number;
  ver: number;
}

/**
 * Horizontal+vertical padding+border of a single element. Returns 0/0 for a
 * detached element so callers can pass refs without a separate null guard.
 */
export function chromeOf(elOrComputedStyle: HTMLElement | CSSStyleDeclaration | null): ChromeSize {
  if (!elOrComputedStyle) return { hor: 0, ver: 0 };
  const style =
    elOrComputedStyle instanceof HTMLElement
      ? window.getComputedStyle(elOrComputedStyle, null)
      : elOrComputedStyle;
  return {
    hor:
      parseIntOrZero(style.getPropertyValue('padding-left')) +
      parseIntOrZero(style.getPropertyValue('padding-right')) +
      parseIntOrZero(style.getPropertyValue('border-left-width')) +
      parseIntOrZero(style.getPropertyValue('border-right-width')),
    ver:
      parseIntOrZero(style.getPropertyValue('padding-top')) +
      parseIntOrZero(style.getPropertyValue('padding-bottom')) +
      parseIntOrZero(style.getPropertyValue('border-top-width')) +
      parseIntOrZero(style.getPropertyValue('border-bottom-width')),
  };
}

/**
 * Sum horizontal/vertical padding+border of every element on the path from
 * `fromEl` (inclusive) up to but excluding `untilEl`. `untilEl` itself is not
 * included (`proposeMaxDimensions` already handles it via its content box).
 */
function accumulateChrome(fromEl: HTMLElement, untilEl: HTMLElement): ChromeSize {
  let hor = 0;
  let ver = 0;
  let node: HTMLElement | null = fromEl;
  while (node && node !== untilEl) {
    const c = chromeOf(node);
    hor += c.hor;
    ver += c.ver;
    node = node.parentElement;
  }
  return { hor, ver };
}

function parseIntOrZero(value: string): number {
  return Math.max(0, Number.parseInt(value, 10) || 0);
}
