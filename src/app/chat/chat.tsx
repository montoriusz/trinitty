import { Fragment, type ReactNode, type Ref, useCallback, useEffect, useRef } from 'react';
import { css } from 'styled-system/css';
import { Box, Flex, VStack } from 'styled-system/jsx';
import { useMergeRefs } from '@/app/shared/use-merge-refs';
import type { ChatMessage } from '@/generated';
import type { CommandlineSuggestionAction } from '@/ui/composites/commandline-suggestion';
import { ScrollArea, SkeletonText, Spinner } from '@/ui/primitives';
import { commandlineController } from '../terminal';
import { MessageBubble } from './message-bubble';
import { PromptInput } from './prompt-input';
import { useChat } from './use-chat';
import { useSuggestionExecutionStatus } from './use-suggestion-execution-status';

const RESIZE_DEBOUNCE_TIME = 300;

export interface ChatProps {
  scrollFooter?: ReactNode;
  onScroll?: () => void;
  messageDecoratorFactory?: () => (msg: ChatMessage) => ReactNode;
  viewportClassName?: string;
  viewportRef?: Ref<HTMLDivElement>;
  variant?: 'chat' | 'notebook';
}

// TODO: split further into ChatHistory, ChatError, remove PromptInput

export function Chat({
  onScroll,
  messageDecoratorFactory,
  viewportClassName,
  scrollFooter,
  viewportRef: externalViewportRef,
  variant = 'chat',
}: Readonly<ChatProps>) {
  const { messages, isGenerating, error } = useChat();

  const viewportRef = useRef<HTMLDivElement | null>(null);

  const mergedViewportRef = useMergeRefs(viewportRef, externalViewportRef);

  // Last measured distance from the bottom, used by the ResizeObserver to keep
  // the user's scroll position stable when content reflows.
  const distanceFromBottomRef = useRef(0);

  // Preserve the distance from the bottom across viewport/content size changes
  // (e.g. markdown/images reflowing, window resize). Pinned-to-bottom stays
  // stuck to the bottom; any other position keeps the same offset.
  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;

    let isResizing = false;
    let isResizingTimeout: ReturnType<typeof setTimeout> | null = null;

    const handleScroll = () => {
      if (isResizing) return;
      onScroll?.();
      distanceFromBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight;
    };

    let observer: ResizeObserver | undefined;
    if (typeof ResizeObserver !== 'undefined') {
      observer = new ResizeObserver(() => {
        if (isResizingTimeout) clearTimeout(isResizingTimeout);
        isResizing = true;
        isResizingTimeout = setTimeout(() => {
          isResizing = false;
          isResizingTimeout = null;
        }, RESIZE_DEBOUNCE_TIME);
        el.scrollTop = Math.max(
          0,
          el.scrollHeight - el.clientHeight - distanceFromBottomRef.current,
        );
      });
      observer.observe(el);
    }

    el.addEventListener('scroll', handleScroll);

    return () => {
      el.removeEventListener('scroll', handleScroll);
      observer?.disconnect();
    };
  }, [onScroll]);

  useEffect(() => {
    // Fake `isGenerating` usage
    isGenerating;
    if (messages.length === 0) return;

    onScroll?.();

    const el = viewportRef.current;
    if (!el || distanceFromBottomRef.current > 20) return;
    el.scrollTop = el.scrollHeight;
  }, [messages, isGenerating, onScroll]);

  const { getStatus: getSuggestionStatus, updateHotStatus: updateSuggestionStatus } =
    useSuggestionExecutionStatus(messages);

  const suggestionActionHandler = useCallback(
    (msgId: string, action: CommandlineSuggestionAction) => {
      const suggestion = getSuggestionStatus(msgId);
      if (!suggestion) return;

      const { cmdline, prevUserCmdline } = suggestion;

      if (action === 'reject') {
        commandlineController.put(prevUserCmdline);
        updateSuggestionStatus(msgId, 'rejected');
      } else if (!cmdline) {
        return;
      } else if (action === 'execute') {
        commandlineController.putAndExecute(cmdline);
        updateSuggestionStatus(msgId, 'accepted');
      } else if (action === 'put') {
        commandlineController.put(cmdline);
      }
    },
    [getSuggestionStatus, updateSuggestionStatus],
  );

  // Create one message decorator per render
  const renderMessageDecorator = messageDecoratorFactory?.();

  return (
    <Flex
      flexDirection="column"
      bg="gray.2"
      flex="1"
      borderRadius="l3"
      borderWidth="1px"
      overflow="hidden"
    >
      <ScrollArea.Root flex="1" size="lg" scrollbar="visible">
        <ScrollArea.Viewport ref={mergedViewportRef} className={viewportClassName}>
          {messages.map((msg) => {
            const suggestionStatus =
              msg.type === 'Assistant' ? getSuggestionStatus(msg.id) : undefined;

            return (
              <Fragment key={msg.id}>
                {renderMessageDecorator?.(msg)}
                {msg.type !== 'TerminalSection' && (
                  <MessageBubble
                    variant={variant}
                    msg={msg}
                    suggestionStatus={suggestionStatus}
                    onSuggestionAction={suggestionActionHandler}
                  />
                )}
              </Fragment>
            );
          })}
          {isGenerating && (
            <VStack gap="2" my="3" alignItems="start">
              <div className={css({ color: 'fg.muted' })}>
                <Spinner mr="2" size="xs" /> Thinking…
              </div>
              <SkeletonText />
            </VStack>
          )}
          {scrollFooter}
        </ScrollArea.Viewport>
      </ScrollArea.Root>

      {error && (
        <Box px="3" py="1" color="error">
          {error}
        </Box>
      )}

      <PromptInput />
    </Flex>
  );
}
