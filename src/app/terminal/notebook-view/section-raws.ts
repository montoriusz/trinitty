import type { ChatMessage } from '@/generated';

export type TerminalSectionMessage = Extract<ChatMessage, { type: 'TerminalSection' }>;

function isTerminalSection(m: ChatMessage): m is TerminalSectionMessage {
  return m.type === 'TerminalSection';
}

// TODO: map to: Array<Exclude<ChatMessage, { type: 'TerminalSection' }> | TerminalBlock>
// Group visually alternating between terminal sections (bg=canvas) and other messages (bg=surface), separate with scissor dashes
// drop 'notebook' MessageBubble variant.
// Further split terminal sections into two blocks command (full, no scroll) and output raws (long output scroll independently),
//  (TerminalBlock)
//  calculate max rows for output by subtracting command height capped at e.g. 5 rows
// Scroll snap to section boundaries

export interface Canonicalization {
  blocks: ChatMessage[];
  terminalBlockById: Map<string, TerminalSectionMessage>;
  unexecuted: TerminalSectionMessage[];
}

export function canonicalizeSections(inputMessages: readonly ChatMessage[]): Canonicalization {
  const blocks: ChatMessage[] = [];
  const terminalBlockById = new Map<string, TerminalSectionMessage>();
  let unexecuted: TerminalSectionMessage[] = [];

  const flushUnexecuted = (executed?: TerminalSectionMessage) => {
    if (unexecuted.length > 0) {
      if (!unexecuted.at(-1)?.cmdline?.trim()) {
        unexecuted.splice(-1, 1);
      }

      const raw = unexecuted.reduce((acc, curr) => acc + curr.raw, '') + (executed?.raw ?? '');

      if (raw) {
        const last = unexecuted.at(-1)!;
        const block: TerminalSectionMessage = {
          type: 'TerminalSection',
          exit_code: executed?.exit_code ?? null,
          executed: executed?.executed ?? false,
          raw,

          // The following should not matter for Notebook rendering
          id: executed?.id ?? last.id,
          ts: executed?.ts ?? last.ts,
          aid: executed?.aid ?? last.aid,
          cols: executed?.cols ?? last.cols,
          rows: executed?.rows ?? last.rows,
          prompt: '',
          cmdline: '',
          output: '',
        };
        terminalBlockById.set(block.id, block);
        blocks.push(block);
      }
    } else if (executed) {
      terminalBlockById.set(executed.id, executed);
      blocks.push(executed);
    }
    unexecuted = [];
  };

  for (const msg of inputMessages) {
    if (isTerminalSection(msg)) {
      if (!msg.executed) {
        unexecuted.push(msg);
      } else if (msg.exit_code !== null) {
        flushUnexecuted(msg);
      }
      // Skipping mid-execution snapshots
    } else {
      flushUnexecuted();
      blocks.push(msg);
    }
  }
  return { blocks, terminalBlockById, unexecuted };
}
