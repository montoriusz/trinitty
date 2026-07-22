import type { IDecoration, IDisposable, ITerminalAddon, Terminal } from '@xterm/xterm';
import {
  CLASS_TERM_BLOCK,
  CLASS_TERM_CMD,
  DATASET_TERM_BLOCK,
} from '../shared/section-matching-dom-attributes';

interface BufferMarker {
  x: number;
  y: number;
}

type MarkingPoint = 'PromptStart' | 'PromptEnd' | 'CommandStarted' | 'CommandFinished';

interface Section {
  id: string;
  isDisposed: boolean;
  markers: Record<MarkingPoint, BufferMarker | undefined>;
  decoration: IDecoration | undefined;
  commmandDecorations: IDecoration[];
}

export interface SectionSnapshot {
  id: string;
  prompt: string;
  command?: string;
  output?: string;
  exitCode?: number;
}

export class TerminalSections implements ITerminalAddon {
  private terminal: Terminal | undefined;
  private oscHook: IDisposable | undefined;
  private sections: Section[] = [];
  private sectionsByAid: Map<string, Section> = new Map();
  private lastAid = '';
  private lastCommittedAid = '';

  onNewPrompt: ((aid: string) => void) | undefined;
  /** True while `rebuildTerminal` replays raw segments iwsnto the buffer. */
  isReplaying: () => boolean = () => false;

  activate(terminal: Terminal): void {
    this.terminal = terminal;

    const oscHandler = (data: string) => {
      const { marker, aid } = parseOsc133(data);

      if (marker === 'A') {
        console.log('PromptStart', aid);
        this.registerMarkingPoint('PromptStart', aid);
        this.maybeFireOnNewPrompt(aid);
      } else if (marker === 'B') {
        this.registerMarkingPoint('PromptEnd', aid);
      } else if (marker === 'C') {
        this.registerMarkingPoint('CommandStarted', aid);
      } else if (marker === 'D') {
        this.registerMarkingPoint('CommandFinished', aid);
        console.log('CommandFinished', aid);
      }
      return true;
    };

    this.oscHook = this.terminal.parser.registerOscHandler(133, oscHandler);
  }

  dispose() {
    this.oscHook?.dispose();
  }

  isSectionAvailable(sectionId: string): boolean {
    const section = this.sectionsByAid.get(sectionId);
    if (!section) return false;
    return !section.isDisposed;
  }

  getLastSectionId(): string | undefined {
    return this.lastAid;
  }

  getLastExecutedSectionId(): string | undefined {
    const sectionIdx = this.sections.findLastIndex(
      (section) => section.markers.CommandStarted != null,
    );
    return sectionIdx !== -1 ? this.sections[sectionIdx]?.id : undefined;
  }

  scrollToSection(sectionId: string) {
    const section = this.sectionsByAid.get(sectionId);
    if (!section || !this.terminal) return;
    this.terminal.scrollToLine(section.markers.PromptStart?.y ?? 0);
  }

  scrollToSectionEnd(sectionId: string) {
    const section = this.sectionsByAid.get(sectionId);
    if (!section || section.isDisposed || !this.terminal) return;
    const sectionIdx = this.sections.indexOf(section);
    const nextSection = this.sections[sectionIdx + 1];
    if (!nextSection?.markers.PromptStart) {
      this.terminal.scrollToBottom();
      return;
    }
    this.terminal.scrollToLine(
      Math.max(0, nextSection.markers.PromptStart.y - this.terminal.rows + 5),
    );
  }

  private orderSection(section: Section) {
    const sectionStartY = section.markers?.PromptStart?.y;
    if (sectionStartY === undefined) return;

    let currentIdx: number | undefined;
    let targetIdx: number | undefined;

    for (let i = 0; i < this.sections.length; i++) {
      if (this.sections[i].id === section.id) {
        currentIdx = i;
        continue;
      }

      const otherSectionStartY = this.sections[i].markers.PromptStart?.y;
      if (otherSectionStartY !== undefined && otherSectionStartY >= sectionStartY) {
        targetIdx = currentIdx === undefined ? i : i - 1;
        break;
      }
    }

    if (targetIdx === undefined) targetIdx = this.sections.length;

    if (currentIdx === targetIdx) return;

    if (currentIdx !== undefined) {
      this.sections.splice(currentIdx, 1);
    }
    this.sections.splice(targetIdx, 0, section);
  }

  private registerMarkingPoint(markingPoint: MarkingPoint, aid: string | undefined) {
    if (!this.terminal) return;

    const effectiveAid = aid || this.lastAid;
    if (!effectiveAid) return;
    this.lastAid = effectiveAid;

    let section = this.sectionsByAid.get(effectiveAid);
    if (!section) {
      section = createSection(effectiveAid);
      this.sectionsByAid.set(effectiveAid, section);
    }

    section.markers[markingPoint] = {
      x: this.terminal.buffer.active.cursorX,
      y: this.terminal.buffer.active.cursorY + this.terminal.buffer.active.baseY,
    };

    this.orderSection(section);
    updateSectionDecorations(this.terminal, section);
  }

  /**
   * §2: fire `onNewPrompt` on the first `A` of a genuinely new `aid`. A
   * same-`aid` readline redraw (resize, tab-completion) re-emits `A` without a
   * preceding `D` — clearing in that case would wipe a half-typed command, so
   * it is skipped via `aid !== this.lastCommittedAid`. Also skipped while
   * `isReplaying()` is true: §3's raw replay advances the buffer with the same
   * `A` markers, but those replays are not real prompt commits and clearing
   * them would defeat the replay.
   */
  private maybeFireOnNewPrompt(aid: string | undefined) {
    if (!aid) return;
    if (!this.onNewPrompt) return;
    if (this.isReplaying()) return;
    if (aid === this.lastCommittedAid) return;

    // TODO: only fire if previous block was executed

    this.lastCommittedAid = aid;
    this.onNewPrompt(aid);
  }
}

function createSection(id: string): Section {
  return {
    id,
    markers: {
      PromptStart: undefined,
      PromptEnd: undefined,
      CommandStarted: undefined,
      CommandFinished: undefined,
    },
    decoration: undefined,
    commmandDecorations: [],
    isDisposed: false,
  };
}

const AIP_PREFIX = 'aid=';
export function parseOsc133(data: string): {
  marker: string;
  exitCode: number | undefined;
  aid: string | undefined;
} {
  const parts = data.split(';');
  const marker = parts[0];
  let exitCode: number | undefined;
  let aid: string | undefined;

  for (const part of parts.slice(1)) {
    if (part.startsWith(AIP_PREFIX)) {
      aid = part.slice(AIP_PREFIX.length);
    } else if (marker === 'D' && exitCode === undefined) {
      exitCode = parseInt(part, 10);
    }
  }

  return { marker, exitCode, aid };
}

const markingRulerColor = '#20573e';

function updateSectionDecorations(term: Terminal, section: Section) {
  updateCommandDecorations(term, section);
  updatePromptDecoration(term, section);
}

function updatePromptDecoration(term: Terminal, section: Section) {
  // Clean up existing decorations
  if (section.decoration) {
    section.decoration.dispose();
    section.decoration = undefined;
  }

  // Check if markers are available
  if (!section.markers.CommandFinished) return;

  section.isDisposed = false;

  const activeBuffer = term.buffer.active;

  const y = section.markers.CommandFinished.y;

  const marker = term.registerMarker(y - activeBuffer.cursorY - activeBuffer.baseY);
  if (!marker) return;

  marker.onDispose(() => {
    section.isDisposed = true;
  });

  const decoration = term.registerDecoration({
    marker,
    layer: 'bottom',
    overviewRulerOptions: {
      color: markingRulerColor,
      position: 'full',
    },
  });
  if (decoration) {
    section.decoration = decoration;
    decoration.onRender((element: HTMLElement) => {
      // TODO: move to recipe
      element.style.width = 'calc(100% - 5rem)';

      element.classList.add(CLASS_TERM_BLOCK);
      element.dataset[DATASET_TERM_BLOCK] = section.id;
    });
    decoration.onDispose(() => {
      decoration.marker.dispose();
      const idx = section.commmandDecorations.indexOf(decoration);
      if (idx !== -1) section.commmandDecorations.splice(idx, 1);
    });
  } else {
    marker.dispose();
  }
}

function updateCommandDecorations(term: Terminal, section: Section) {
  // Clean up existing decorations
  for (const decoration of section.commmandDecorations) {
    decoration.dispose();
  }
  section.commmandDecorations = [];

  // Check if markers are available
  if (!section.markers.PromptEnd || !section.markers.CommandStarted) return;

  // Draw new decorations
  const startX = section.markers.PromptEnd.x;
  const startY = section.markers.PromptEnd.y;
  const endY = section.markers.CommandStarted.y - 1;

  // If CommandStarted is at column 0, the prompt content doesn't extend to that line
  if (startY > endY) return;

  const activeBuffer = term.buffer.active;
  let isFirstLine = true;
  for (let y = startY; y <= endY; y++) {
    const x = y === startY ? startX : 0;
    const width = term.cols - x;
    if (width <= 0) continue;

    const marker = term.registerMarker(y - activeBuffer.cursorY - activeBuffer.baseY);
    if (!marker) continue;

    const decoration = term.registerDecoration({
      marker,
      x,
      width,
      layer: 'bottom',
      // backgroundColor: markingBgColor,
      overviewRulerOptions: {
        color: markingRulerColor,
        position: 'full',
      },
    });

    if (decoration) {
      section.commmandDecorations.push(decoration);
      if (isFirstLine) {
        decoration.onRender((element) => {
          element.classList.add(CLASS_TERM_CMD);
          element.dataset[DATASET_TERM_BLOCK] = section.id;
        });
        isFirstLine = false;
      }
      decoration.onDispose(() => {
        decoration.marker.dispose();
        const idx = section.commmandDecorations.indexOf(decoration);
        if (idx !== -1) section.commmandDecorations.splice(idx, 1);
      });
    } else {
      marker.dispose();
    }
  }
}
