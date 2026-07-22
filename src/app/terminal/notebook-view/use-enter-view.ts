import { useEffect, useRef } from 'react';
import { useChat } from '@/app/chat/use-chat';
import { getLiveSectionRaw } from '@/generated';
import { rebuildTerminal } from '../terminal';
import type { ViewType } from '../view-menu';
import { canonicalizeSections } from './section-raws';

/**
 * §3 + §4: rebuild the live xterm buffer when entering the notebook view.
 *
 * Notebook's live pane only ever shows the *current*, uncommitted section —
 * `terminal.clear()` on each new prompt (§2) wipes prior content. Switching
 * to split view (which keeps full scrollback) leaves the buffer wrong on
 * return, so we rebuild from the live section's `raw`.
 *
 * §4 merge rule: an *unexecuted* `TerminalSection` record
 * (`!executed && exit_code===null`) is folded into the next committed block
 * that follows it in the stream (see `canonicalizeSections`), NOT into a
 * standalone block. When the stream's very tail is an unexecuted record —
 * i.e. a prompt was persisted (the recorder yielded it because a new prompt
 * interrupted it without `D`) and nothing followed it in `messages` before
 * the live section — the merge target is the live section
 * (`getLiveSectionRaw()`). Such orphan raws are prepended to the live raw on
 * entry so the live pane preserves the chain of never-executed prompts
 * stacked above the current one (exactly what `terminal.clear()` would
 * otherwise have erased). The orphan whose `aid` matches the live section is
 * dropped — its `raw` is a strict subset of `getLiveSectionRaw()` (the
 * recorder keeps appending), so prepending it would replay the live prompt
 * twice. When an unexecuted record's right edge is bounded by a chat turn
 * (`User`/`Assistant` between it and the live tail), it was already rendered
 * as its own block in the chat flow, so nothing is prepended here.
 *
 * Runs on every `viewValue` transition back to `"notebook"`; on initial mount
 * it also runs once, which is harmless (replays the live section into a
 * freshly-opened buffer).
 */
// TODO: refactor — remove this hook and move the logic to an `useEffect` in
// `TerminalWindow` once `TerminalWindow` owns the per-view entry sequencing.
export function useEnterNotebookView(viewValue: ViewType) {
  const { messages } = useChat();
  // Capture the message snapshot at entry only — once the pane is mounted the
  // live shell keeps appending naturally and we must not re-replay mid-stream.
  // See `useEnterSplitView` for the same `useRef` pattern and rationale.
  const messagesRef = useRef(messages);
  messagesRef.current = messages;

  useEffect(() => {
    if (viewValue !== 'notebook') return;
    let cancelled = false;
    void getLiveSectionRaw().then((live) => {
      if (cancelled) return;
      const { unexecuted } = canonicalizeSections(messagesRef.current);
      const unexecutedRaws = unexecuted.map((o) => o.raw);
      rebuildTerminal(live ? [...unexecutedRaws, live] : unexecutedRaws);
    });
    return () => {
      cancelled = true;
    };
    // `messages` is intentionally not a dependency: we only rebuild on entry,
    // not on every subsequent message update.
  }, [viewValue]);
}
