import { MessageSquareIcon } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef } from 'react';
import { css } from 'styled-system/css';
import { Flex, HStack, styled } from 'styled-system/jsx';
import { Chat } from '@/app/chat';
import { useChat } from '@/app/chat/use-chat';
import { SettingsButton } from '@/app/shared/settings-button';
import type { ChatMessage } from '@/generated';
import { Button } from '@/ui/primitives';
import { useSelectedView } from '../selected-view-store';
import { terminal, terminalSections } from '../terminal';
import { ViewMenu } from '../view-menu';
import { AutoGrowTerminalPane } from './auto-grow-terminal-pane';
import { canonicalizeSections } from './section-raws';
import { TerminalSectionBlock } from './terminal-section-block';
import { useEnterNotebookView } from './use-enter-view';
import { ViewportDimensionsProvider } from './viewport-dimensions';

export function NotebookView() {
  const viewportRef = useRef<HTMLDivElement>(null);
  const { messages } = useChat();
  const viewValue = useSelectedView((s) => s.viewValue);

  // §3: rebuild the live xterm buffer from the current, uncommitted section
  // when entering notebook (split accumulates scrollback; notebook does not).
  useEnterNotebookView(viewValue);

  // §2: clear the live pane on each new prompt so it only ever shows the
  // current, uncommitted section. Guarded against the raw replay of §3.
  useEffect(() => {
    terminalSections.onNewPrompt = () => {
      terminal.clear();
    };
    return () => {
      terminalSections.onNewPrompt = undefined;
    };
  }, []);

  const { terminalBlockById } = useMemo(() => canonicalizeSections(messages), [messages]);

  const decoratorFactory = useCallback(() => {
    return (msg: ChatMessage) =>
      msg.type === 'TerminalSection' && terminalBlockById.has(msg.id) ? (
        <TerminalSectionBlock msg={terminalBlockById.get(msg.id)!} />
      ) : null;
  }, [terminalBlockById]);

  return (
    <Flex h="screen" w="screen" position="relative" p="2">
      <HStack
        h="[2.75rem]"
        bg="surface"
        position="absolute"
        top="2"
        right="2"
        px="2"
        borderLeftWidth="1px"
        borderBottomWidth="1px"
        borderBottomLeftRadius="l2"
        zIndex="docked"
      >
        <Button size="xs" variant="plain" title={`Prompt assistant (Ctrl + P)`}>
          <MessageSquareIcon />
          Prompt{' '}
          <styled.span textStyle="xs" fontWeight="normal">
            (Ctrl+P)
          </styled.span>
        </Button>
        <ViewMenu />
        <SettingsButton />
      </HStack>
      {/*
        TODO(pinned): allow the terminal to detach from the scroll viewport and
        dock as a flex sibling below it (never shrinking). That requires moving
        the AutoGrowTerminalPane out of `scrollFooter` into a sibling of the
        ScrollArea in Chat, and re-`terminal.open`-ing on the new container.
      */}
      <ViewportDimensionsProvider viewportRef={viewportRef}>
        <Chat
          variant="notebook"
          viewportClassName={css({
            pt: '10',
            pr: '5.5',
            pl: '2',
            backgroundColor: 'canvas',
          })}
          viewportRef={viewportRef}
          messageDecoratorFactory={decoratorFactory}
          // TODO: trigger pin-to-bootm new messages handler (potential scroll) when AutoGrowTerminalPane resizes
          // TODO: redirect clicks below the live terminal to the live terminal (focus)
          scrollFooter={<AutoGrowTerminalPane maxSizeRef={viewportRef} />}
        />
      </ViewportDimensionsProvider>
    </Flex>
  );
}
