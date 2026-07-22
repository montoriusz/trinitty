import { Terminal } from '@xterm/xterm';
import '@xterm/xterm/css/xterm.css';
import { ChevronsUpDownIcon, ScissorsLineDashedIcon } from 'lucide-react';
import { type CSSProperties, useEffect, useRef, useState } from 'react';
import { css, cx } from 'styled-system/css';
import { Box, HStack } from 'styled-system/jsx';
import { token } from 'styled-system/tokens';
import { CLASS_TERM_BLOCK } from '@/app/shared/section-matching-dom-attributes';
import { Icon } from '@/ui/primitives';
import { useIsDarkMode } from '../../shared/dark-mode-provider';
import { usedRows } from '../dimensions';
import { getTerminalTheme } from '../themes';
import type { TerminalSectionMessage } from './section-raws';
import { useViewportDimensions } from './viewport-dimensions';

export interface TerminalSectionBlockProps {
  msg: TerminalSectionMessage;
}

export function TerminalSectionBlock({ msg }: Readonly<TerminalSectionBlockProps>) {
  const containerRef = useRef<HTMLDivElement>(null);
  const dims = useViewportDimensions();
  // Latest shared dims, for the mount-once effect closures below.
  const dimsRef = useRef(dims);
  dimsRef.current = dims;
  // The live xterm view, owned by the mount-once effect; the `dims` effect
  // drives it when the shared geometry changes (without recreating it).
  const viewRef = useRef<Terminal | null>(null);
  const [heightPx, setHeightPx] = useState<number | undefined>(undefined);
  // True when the written content overflows the grid viewport (xterm has
  // scrollback above the viewport), i.e. the block is taller than `maxRows`.
  const [hasScrollback, setHasScrollback] = useState(false);

  const isDark = useIsDarkMode();

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const view = new Terminal({
      // Start at the recorded size so the initial `write` reproduces the
      // original line wrapping; `fit` (driven by `onRender` and reshared
      // dimensions) then reflows to the actual viewport width.
      cols: msg.cols,
      rows: msg.rows,
      disableStdin: true,
      fontFamily: token('fonts.code'),
      theme: getTerminalTheme(isDark),
      allowProposedApi: true,

      // This make the cursor hide behind bottom edge
      cursorStyle: 'underline',
      cursorInactiveStyle: 'underline',
    });
    view.open(el);
    view.write(msg.raw);
    viewRef.current = view;

    // Match the live pane: fix the xterm grid at the shared viewport
    // geometry (`maxRows × cols`) so the block can grow taller than its
    // originally recorded `msg.rows` when the viewport allows it. Height is
    // then clipped to `usedRows` via the container.
    const fit = () => {
      const d = dimsRef.current;
      if (!d) return;
      if (view.cols !== d.cols || view.rows !== d.maxRows) view.resize(d.cols, d.maxRows);
    };

    const recomputeHeight = () => {
      const d = dimsRef.current;
      if (!d) return;
      const rows = Math.min(d.maxRows, usedRows(view, d.maxRows));
      setHeightPx(Math.ceil(rows * d.cell.height));
      setHasScrollback(view.buffer.active.baseY > 0);
    };

    // First render produces the block's cell dimensions and the initial
    // reshared dims; subsequent renders follow a `resize`/reflow.
    const onRenderSub = view.onRender(() => {
      fit();
      recomputeHeight();
    });

    return () => {
      onRenderSub.dispose();
      view.dispose();
      viewRef.current = null;
    };
    // Mount-once: `msg` and `isDark` are stable for a given block, and shared
    // geometry changes flow through the separate `dims` effect below (the
    // `view` is kept alive and re-driven, not recreated).
  }, [msg.raw, msg.cols, msg.rows, isDark]);

  // Drive the live view when the shared viewport geometry changes (window
  // resize, sidebar toggle, font/theme change) — reflows to the new cols and
  // recomputes the visible height without recreating the terminal (which
  // would lose the written buffer and flash).
  useEffect(() => {
    const view = viewRef.current;
    if (!view || !dims) return;
    if (view.cols !== dims.cols || view.rows !== dims.maxRows) view.resize(dims.cols, dims.maxRows);
    const rows = Math.min(dims.maxRows, usedRows(view, dims.maxRows));
    setHeightPx(Math.ceil(rows * dims.cell.height));
    setHasScrollback(view.buffer.active.baseY > 0);
  }, [dims]);

  // TODO: Gate terminal scrolling with the wheel (e.g. require modifier key).
  // TODO: When the the terminal is seing scrolled snap outer scroll area to the section

  return (
    <Box>
      {/* The static xterm cell. Carries the matching dataset/className so the
          existing SectionMatching selectors keep finding this block. */}
      <Box
        className={CLASS_TERM_BLOCK}
        position="relative"
        overflow="hidden"

        bg="canvas"
        style={heightPx === undefined ? undefined : { height: `${heightPx}px` }}
        boxSizing="content-box"
      >
        <div ref={containerRef} className={cx(terminalSurfaceStyle, terminalViewportStyle)} />
      </Box>

      {msg.exit_code != null && (
        // TODO: add section actions: copy, view processed output, expand/collapse/hide from history
        <HStack gap="2.5" my="-1" position="relative" zIndex="l1">
          <Box borderBottomWidth="1px" borderStyle="dashed" flexGrow="1" flexShrink="1" />
          <Box flexShrink="0">
            {hasScrollback && <Icon color="border" as={ChevronsUpDownIcon} aria-label="Scroll" />}
            <Icon color="border" as={ScissorsLineDashedIcon} />
          </Box>
          <ExitCodeBadge code={msg.exit_code} />
        </HStack>
      )}
    </Box>
  );
}

interface ExitCodeBadgeProps {
  code: number;
}

function ExitCodeBadge({ code }: Readonly<ExitCodeBadgeProps>) {
  return (
    <div
      className={exitCodeBadgeStyle}
      style={
        {
          '--block-status': code === 0 ? token('colors.success') : token('colors.error'),
        } as CSSProperties
      }
    >
      <Box // Status Dot
        as="span"
        display="inline-block"
        w="[7px]"
        h="[7px]"
        borderRadius="full"
        bg="var(--block-status)"
        title={code === 0 ? `exit 0` : undefined}
      />
      {code !== 0 ? `exit ${code}` : ''}
    </div>
  );
}

const exitCodeBadgeStyle = css({
  display: 'inline-flex',
  alignItems: 'center',
  gap: '1',
  fontSize: 'xs',
  color: 'var(--block-status)',
});

const terminalSurfaceStyle = css({
  '& .sctm-term-cmd': {
    backgroundColor: 'termCmd',
  },
});

const terminalViewportStyle = css({
  // xterm's viewport must not show its own scrollbar inside a clipped block.
  '& .xterm-viewport': {
    overflowY: 'hidden',
  },
});
