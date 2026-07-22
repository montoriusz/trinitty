import { useCallback, useRef } from 'react';
import { css, cx } from 'styled-system/css';
import { Box, Flex, HStack, styled } from 'styled-system/jsx';
import { sectionConnector } from 'styled-system/recipes';
import { SettingsButton } from '@/app/shared/settings-button';
import type { ChatMessage } from '@/generated';
import { Chat } from '../../chat/chat';
import {
  CLASS_CHAT_MESSAGE,
  DATA_ATTR_TERM_BLOCK,
  DATASET_TERM_BLOCK,
} from '../../shared/section-matching-dom-attributes';
import { terminalSections } from '..';
import { ViewMenu } from '../view-menu';
import { useEmitUpdateMatching } from './use-emit-update-matching';

export function ChatPane() {
  const emitUpdateMatchingRef = useRef<() => void>(null);
  emitUpdateMatchingRef.current = useEmitUpdateMatching();

  const handleScroll = useCallback(() => {
    emitUpdateMatchingRef.current?.();
  }, []);

  return (
    <Flex flexDirection="column" h="full" pr="1" flexGrow="1" overflow="hidden">
      <HStack bg="surface">
        <Box p="3" fontWeight="semibold" textStyle="lg" flexGrow="1">
          Terminal Assistant
        </Box>
        <HStack pr="2">
          <ViewMenu />
          <SettingsButton />
        </HStack>
      </HStack>

      <Chat
        viewportClassName={css({ py: '1', pr: '3', pl: '4' })}
        onScroll={handleScroll}
        messageDecoratorFactory={messageDecoratorFactory}
      />
    </Flex>
  );
}

const messageDecoratorFactory = () => {
  let lastTerminalStartSectionId: string | null = null;
  let lastTerminalEndSectionId: string | null = null;
  const getTerminalSectionBounds = (message: ChatMessage) => {
    if (message.type === 'TerminalSection' && message.exit_code != null) {
      if (lastTerminalStartSectionId === null) {
        lastTerminalStartSectionId = message.aid;
      }
      lastTerminalEndSectionId = message.aid;
      return undefined;
    } else if (lastTerminalStartSectionId !== null) {
      const result = [lastTerminalStartSectionId, lastTerminalEndSectionId];
      [lastTerminalStartSectionId, lastTerminalEndSectionId] = [null, null];
      return result;
    }
  };

  return (msg: ChatMessage) => {
    const sectionBoundary = getTerminalSectionBounds(msg);
    if (sectionBoundary) return <SectionBoundary sectionId={sectionBoundary[1]} />;
  };
};

const SectionBoundary = ({ sectionId }: { sectionId: string | null }) => {
  return (
    <styled.button
      type="button"
      onClick={connectorClickHandler}
      className={cx(CLASS_CHAT_MESSAGE, sectionConnector({ separator: true }))}
      disabled={!isSectionConnectorActive(sectionId)}
      {...{ [DATA_ATTR_TERM_BLOCK]: sectionId }}
    />
  );
};

const connectorClickHandler = (e: React.MouseEvent) => {
  const target = e.target as HTMLElement;
  const sectionId = target.dataset[DATASET_TERM_BLOCK];
  if (sectionId) {
    terminalSections.scrollToSectionEnd(sectionId);
  }
};

const isSectionConnectorActive = (sectionId: string | null) => {
  if (sectionId == null) return false;
  return terminalSections.isSectionAvailable(sectionId);
};
