'use client';

import { PlayIcon, TerminalIcon, Undo2Icon } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { css, cx } from 'styled-system/css';
import {
  type CommandlineSuggestionVariantProps,
  commandlineSuggestion,
} from 'styled-system/recipes';
import type { SuggestionExecutionStatus } from '@/app/chat/use-suggestion-execution-status';
import {
  CLASS_CMD_SUGGESTION,
  DATA_ATTR_TERM_BLOCK,
} from '@/app/shared/section-matching-dom-attributes';
import { Collapsible, IconButton } from '../primitives';

export type CommandlineSuggestionAction = 'execute' | 'put' | 'reject';

export interface CommandlineSuggestionProps extends CommandlineSuggestionVariantProps {
  commandline: string;
  termBlockId?: string;
  status?: SuggestionExecutionStatus['status'];
  onAction?: (event: CommandlineSuggestionAction) => void;
}

const COLLAPSED_HEIGHT = '2.375rem'; // Buttons height + Buttons padding - Command padding

export function CommandlineSuggestion({
  status,
  commandline,
  termBlockId,
  onAction,
  ...props
}: CommandlineSuggestionProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [hasMore, setHasMore] = useState(false);

  useEffect(() => {
    const root = rootRef.current;
    const content = contentRef.current;
    if (!root || !content) return;
    const measure = () => {
      // The collapsible root clips to `collapsedHeight` when collapsed, so when
      // it is shorter than the full content there is hidden content below.
      setHasMore(content.scrollHeight > root.clientHeight + 1);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(content);
    observer.observe(root);
    return () => observer.disconnect();
  }, []);

  const styles = commandlineSuggestion({
    ...props,
    hasMore: hasMore && !open,
  });
  let statusStyle = css({ colorPalette: 'blue' });
  if (status === 'pending') statusStyle = css({ colorPalette: 'amber' });
  else if (status === 'accepted') statusStyle = css({ colorPalette: 'green' });
  // else if (status === 'failed') statusStyle = css({ colorPalette: 'red' });
  else if (status === 'rejected') statusStyle = css({ colorPalette: 'gray' });

  const handlers = useMemo(
    () => ({
      onApply: () => onAction?.('execute'),
      onPut: () => onAction?.('put'),
      onReject: () => onAction?.('reject'),
    }),
    [onAction],
  );

  return (
    <div
      className={cx(styles.root, statusStyle, CLASS_CMD_SUGGESTION)}
      {...{ [DATA_ATTR_TERM_BLOCK]: termBlockId }}
    >
      <Collapsible.Root
        ref={rootRef}
        variant="command"
        collapsedHeight={COLLAPSED_HEIGHT}
        className={styles.command}
        open={open}
        onOpenChange={(details) => setOpen(details.open)}
      >
        {/* TODO: highlight syntax */}
        <Collapsible.Content ref={contentRef}>{commandline}</Collapsible.Content>
        <Collapsible.Trigger
          disabled={!open && !hasMore}
          className={styles.expandTrigger}
          // aria-label={open ? 'Collapse' : 'Expand'}
        >
          <Collapsible.Indicator />
        </Collapsible.Trigger>
      </Collapsible.Root>
      <div className={styles.actions}>
        <IconButton
          title="Execute"
          colorPalette={status === 'pending' ? 'green' : undefined}
          variant="subtle"
          size="xs"
          onClick={handlers.onApply}
        >
          <PlayIcon />
        </IconButton>
        {status === 'pending' ? (
          <IconButton
            title="Reject"
            colorPalette={'red'}
            variant="subtle"
            size="xs"
            onClick={handlers.onReject}
          >
            <Undo2Icon />
          </IconButton>
        ) : (
          <IconButton title="Send to terminal" variant="subtle" size="xs" onClick={handlers.onPut}>
            <TerminalIcon />
          </IconButton>
        )}
      </div>
    </div>
  );
}
