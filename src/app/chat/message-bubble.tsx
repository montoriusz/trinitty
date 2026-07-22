import { useCallback } from 'react';
import { cva } from 'styled-system/css';
import { Box, Flex } from 'styled-system/jsx';
import type { ChatMessage } from '@/generated';
import {
  CommandlineSuggestion,
  type CommandlineSuggestionAction,
} from '@/ui/composites/commandline-suggestion';
import { Markdown } from '@/ui/composites/markdown';
import { Clipboard, IconButton, RelativeTime } from '@/ui/primitives';
import type { SuggestionExecutionStatus } from './use-suggestion-execution-status';

export interface MessageBubbleProps {
  msg: ChatMessage;
  variant: 'chat' | 'notebook';
  onSuggestionAction: (msgId: string, event: CommandlineSuggestionAction) => void;
  suggestionStatus: SuggestionExecutionStatus | undefined;
}

export function MessageBubble({
  msg,
  variant,
  onSuggestionAction,
  suggestionStatus,
}: MessageBubbleProps) {
  const isUser = msg.type === 'User';
  const actionHandler = useCallback(
    (event: CommandlineSuggestionAction) => onSuggestionAction(msg.id, event),
    [onSuggestionAction, msg.id],
  );

  // TerminalSection messages carry buffer content for re-render into a separate
  // xterm (Phase 3); they are not chat bubbles and render nothing here.
  if (msg.type === 'TerminalSection') return null;

  return (
    <Flex
      my="1"
      direction="column"
      minW="0"
      maxW="full"
      className={
        variant === 'notebook'
          ? baloonStyle({ side: msg.type === 'User' ? 'user' : 'assistant', variant })
          : undefined
      }
    >
      {msg.type === 'User' ? (
        <div className={variant === 'chat' ? baloonStyle({ side: 'user', variant }) : undefined}>
          <Markdown content={msg.msg} />
        </div>
      ) : (
        <div
          className={variant === 'chat' ? baloonStyle({ side: 'assistant', variant }) : undefined}
        >
          <Markdown content={msg.msg} />
          {!isUser &&
            msg.cmdline && ( // TODO: do not collapse the suggestion in the latest message
              <CommandlineSuggestion
                status={suggestionStatus?.status ?? 'pending'}
                termBlockId={suggestionStatus?.termBlockId}
                commandline={msg.cmdline}
                onAction={actionHandler}
              />
            )}
        </div>
      )}
      <Box color="fg.muted" fontSize="xs" mt="1">
        <RelativeTime value={msg.ts} />
        {msg.type === 'Assistant' ? (
          <>
            &ensp;&bull;&ensp;{msg.model}
            &ensp;&bull;&ensp;
            <ClipboardCopy value={msg.msg} />
          </>
        ) : null}
      </Box>
    </Flex>
  );
}

const baloonStyle = cva({
  base: {
    display: 'flex',
    maxW: '11/12',
  },
  variants: {
    side: {
      user: { alignSelf: 'end', colorPalette: 'gray' },
      assistant: { flexDirection: 'column' },
    },
    variant: {
      chat: {
        gap: '2',
      },
      notebook: {
        pb: '1.5',
      },
    },
  },
  compoundVariants: [
    {
      side: 'user',
      variant: 'chat',
      css: {
        alignSelf: 'end',
        bg: 'colorPalette.surface.bg',
        color: 'colorPalette.surface.fg',
        px: '3r',
        borderRadius: 'l3',
        borderWidth: '1',
      },
    },
    {
      side: 'user',
      variant: 'notebook',
      css: {
        px: '3r',
        borderRadius: 'l3',
        borderWidth: '1',
        bg: 'colorPalette.2',
        color: 'colorPalette.surface.fg',
      },
    },
    {
      side: 'assistant',
      variant: 'notebook',
      css: {
        px: '3r',
        borderRadius: 'l3',
        borderWidth: '1',
        bg: 'gray.subtle.bg',
        color: 'gray.subtle.fg',
        alignSelf: 'start',
      },
    },
  ],
});

function ClipboardCopy({ value }: { value: string }) {
  return (
    <Clipboard.Root value={value} display="inline-flex">
      <Clipboard.Control>
        <Clipboard.Trigger
          asChild
          title="Copy markdown rsponse"
          aria-label="Copy assistant response markdown to clipboard"
        >
          <IconButton variant="plain" size="2xs" color="fg.muted" my="-1">
            <Clipboard.Indicator />
          </IconButton>
        </Clipboard.Trigger>
      </Clipboard.Control>
    </Clipboard.Root>
  );
}
