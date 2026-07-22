import { Channel } from '@tauri-apps/api/core';
import { WebviewWindow } from '@tauri-apps/api/webviewWindow';
import { FitAddon } from '@xterm/addon-fit';
import { Terminal } from '@xterm/xterm';
import { token } from 'styled-system/tokens';
import { createShell, resizePty, type TerminalEvent, writeToPty } from '@/generated';
import { WINDOW_LABEL_TERMINAL } from '../window-manager';
import { TerminalSections } from './terminal-sections';
import { getTerminalTheme } from './themes';

// ── HMR-safe singletons ────────────────────────────────────────────────

interface TerminalCache {
  terminal: Terminal;
  fitAddon: FitAddon;
  terminalSections: TerminalSections;
  initialized?: boolean;
}

// ── §3 raw-replay state (view transitions) ──────────────────────────────
//
// The single `terminal` instance has one buffer shared by both views
// (`NotebookView` and `SplitView` re-`terminal.open` the same instance). When
// entering a view, §3's `rebuildTerminal` resets that buffer and replays the
// relevant raw segments, rendering them with their own OSC-133 markers. The
// `replaying` flag is module-local; `terminalSections.isReplaying` reads it so
// the §2 clear-on-`A` handoff does not fire mid-replay.
let replaying = false;
export const isReplaying = () => replaying;

const { terminal, terminalSections, fitAddon } = getCache();

export function rebuildTerminal(rawSegments: readonly string[]) {
  replaying = true;
  try {
    // RIS: wipe the buffer + state (including the current line) without
    // tearing down the singleton's PTY binding, OSC-133 addon, or theme.
    terminal.reset();
    for (const raw of rawSegments) terminal.write(raw);
  } finally {
    // Clear the flag after xterm drains the writes — `write` is async-batched,
    // so the trailing empty write with a callback is the synchronisation point.
    terminal.write('', () => {
      replaying = false;
    });
  }
}

function handleEvent(event: TerminalEvent) {
  console.log('event', event);
  if (event.type === 'output') {
    terminal?.write(event.data);
    return;
  }
  // promptStarted / promptEnded / commandStarted / commandFinished:
  // available for non-positional context consumers (exit code, aid lifecycle,
  // "is a command running"). Positional decoration placement still relies on
  // TerminalSections' xterm OSC-133 parser hook, which sees the same bytes via
  // the `output` events.
}

function fitTerminal() {
  if (!terminal) return;

  fitAddon?.fit();
  void resizePty({ rows: terminal.rows, cols: terminal.cols });
}

const commandlineController = {
  put: (command: string) => {
    void writeToPty({ data: `\x05\x15${command}` });
  },
  putAndExecute: (command: string) => {
    void writeToPty({ data: `\x05\x15${command}\r` });
  },
};

function getCache(): TerminalCache {
  const cache: TerminalCache = import.meta.hot?.data ?? {};

  const isTerminalWindow = WebviewWindow.getCurrent().label === WINDOW_LABEL_TERMINAL;
  if (!isTerminalWindow) {
    // throw new Error('Terminal must be only loaded on the main window');
    console.error('Terminal must be only loaded on the terminal window');
    return cache;
  }

  if (!cache.initialized) {
    cache.initialized = true;
    const terminal = new Terminal({
      fontFamily: token('fonts.code'),
      theme: getTerminalTheme(),
      allowProposedApi: true,
      overviewRuler: {
        width: 12,
      },
      scrollback: 1000,
    });
    const fitAddon = new FitAddon();
    const terminalSections = new TerminalSections();
    terminal.loadAddon(fitAddon);
    terminal.loadAddon(terminalSections);
    // §3: skip the §2 clear-on-`A` handoff while raw segments are being
    // replayed for view transitions (the buffer is being rebuilt, not advanced
    // by a real shell prompt).
    // TODO: move to the constructor
    terminalSections.isReplaying = isReplaying;

    // Store the terminal and addons in the cache.
    cache.terminal = terminal;
    cache.fitAddon = fitAddon;
    cache.terminalSections = terminalSections;

    const channel = new Channel<TerminalEvent>();
    channel.onmessage = handleEvent;

    terminal.onData((data) => {
      void writeToPty({ data });
    });

    createShell({ onEvent: channel }).catch((error) => {
      console.error('Error creating shell:', error);
    });
  }

  return cache;
}

export { commandlineController, fitTerminal, terminal, terminalSections };
