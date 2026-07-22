import { useEffect, useRef } from 'react';
import { useChat } from '@/app/chat/use-chat';
import { getLiveSectionRaw } from '@/generated';
import type { TerminalSectionMessage } from '../notebook-view/section-raws';
import { rebuildTerminal } from '../terminal';
import type { ViewType } from '../view-menu';

/**
 * §3: rebuild the live xterm buffer when entering the split view. Notebook
 * view clears history on each new prompt so its buffer only holds the current,
 * uncommitted section; split view wants the full scrollback. Reset and replay
 * every committed `TerminalSection` (in order, taking the last `raw` per
 * `aid`) followed by the live section's `raw`, so the split pane shows the
 * same content the chat flow's blocks render — plus the live tail.
 *
 * The replay runs on entry only (every transition to `"split"`, plus the
 * initial mount). After the pane is mounted, the live shell keeps appending
 * new output naturally; we must *not* re-replay on each new `D`, since that
 * would reset the buffer mid-session and flicker. `messagesRef` is updated
 * every render but read only at entry, so the effect depends on `viewValue`
 * alone.
 */
//  TODO: untangle and refactor moving up to the terminal window
export function useEnterSplitView(viewValue: ViewType) {
  const { messages } = useChat();
  const messagesRef = useRef(messages);
  messagesRef.current = messages;

  useEffect(() => {
    if (viewValue !== 'split') return;
    let cancelled = false;
    void getLiveSectionRaw().then((live) => {
      if (cancelled) return;
      // Drop the canonical record whose `aid` matches the live section: its
      // `raw` is a strict subset of `live` (the recorder keeps appending), so
      // replaying it first would render the live prompt a second time above
      // the appended live raw. All other canonical records stay — split view
      // shows the full scrollback above the live tail.
      const raw = [
        ...messages
          .values()
          .filter(
            (m): m is TerminalSectionMessage =>
              m.type === 'TerminalSection' && (m.executed === false || m.exit_code != null),
          )
          .map((m) => m.raw),
      ];

      if (live) raw.push(live);

      rebuildTerminal(raw);
    });
    return () => {
      cancelled = true;
    };
  }, [viewValue, messages]);
}
