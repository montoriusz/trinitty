import { useEffect, useMemo, useState } from 'react';
import type { ChatMessage } from '@/generated';

type SuggestionExecutionMatch = 'accepted' | 'rejected' | 'edited';

interface HotStatusUpdate {
  msgId: string;
  status: SuggestionExecutionMatch;
}

export interface SuggestionExecutionStatus {
  status: 'pending' | SuggestionExecutionMatch;
  cmdline: string;
  prevUserCmdline: string;
  termBlockId: string | undefined;
}

interface Suggestion extends SuggestionExecutionStatus {
  id: string;
}

export function useSuggestionExecutionStatus(messages: readonly ChatMessage[]) {
  const [hotStatusUpdate, setHotStatusUpdate] = useState<HotStatusUpdate | undefined>(undefined);

  useEffect(() => {
    if (!hotStatusUpdate) return;

    let scan = false;
    for (const m of messages) {
      if (!scan) {
        if (m.id === hotStatusUpdate.msgId) {
          scan = true;
        }
        continue;
      }

      if (m.type === 'TerminalSection' && m.executed) {
        setHotStatusUpdate(undefined);
        break;
      }
    }
  }, [messages, hotStatusUpdate]);

  const commandsMap = useMemo(() => {
    const map = new Map<string, Suggestion>();
    let pendingId: string | undefined;
    let queue: Suggestion[] = [];
    let prevUserCmdline = '';
    for (const m of messages) {
      if (m.type === 'Assistant') {
        if (!m.cmdline) continue;
        const sugg: Suggestion = {
          id: m.id,
          cmdline: m.cmdline,
          prevUserCmdline,
          status: 'rejected',
          termBlockId: undefined,
        };
        queue.unshift(sugg);
        map.set(m.id, sugg);
        pendingId = m.id;
      } else if (m.type === 'TerminalSection') {
        if (!m.executed) {
          prevUserCmdline = m.cmdline ?? '';
          continue;
        }

        pendingId = undefined;

        const matchingIdx = queue.findIndex(
          (s) => matchCommands(s.cmdline, m.cmdline) === 'accepted',
        );
        if (matchingIdx !== -1) {
          queue[matchingIdx].status = 'accepted';
          queue[matchingIdx].termBlockId = m.aid;
          queue = queue.slice(0, matchingIdx);
          continue;
        }

        const editedIdx = queue.findIndex((s) => matchCommands(s.cmdline, m.cmdline) === 'edited');
        if (editedIdx !== -1) {
          const edited = queue[editedIdx];
          edited.status = 'edited';
          edited.termBlockId = m.aid;
        }
      }
    }

    if (pendingId !== undefined) {
      const pending = map.get(pendingId);
      if (pending) pending.status = 'pending';
    }

    return map;
  }, [messages]);

  return useMemo(() => {
    let hotStatus: SuggestionExecutionStatus | undefined;
    if (hotStatusUpdate) {
      const originalStatus = commandsMap.get(hotStatusUpdate.msgId);
      if (originalStatus) {
        hotStatus = {
          ...originalStatus,
          status: hotStatusUpdate.status,
        };
      }
    }

    const getStatus = (msgId: string): SuggestionExecutionStatus | undefined => {
      return hotStatusUpdate?.msgId === msgId ? hotStatus : commandsMap.get(msgId);
    };

    return {
      getStatus,
      updateHotStatus: (msgId: string, status: SuggestionExecutionMatch) => {
        setHotStatusUpdate({ msgId, status });
      },
    };
  }, [commandsMap, hotStatusUpdate]);
}

function matchCommands(suggestion: string, executed: string): SuggestionExecutionMatch {
  const trimmedSuggestion = suggestion.trim();
  const trimmedExecuted = executed.trim();

  if (trimmedExecuted === trimmedSuggestion) return 'accepted';

  const baseCommand = trimmedExecuted.split(' ')[0];
  if (
    trimmedSuggestion.startsWith(baseCommand) &&
    (trimmedSuggestion.length === baseCommand.length ||
      trimmedSuggestion[baseCommand.length] === ' ')
  ) {
    return 'edited';
  }

  return 'rejected';
}
