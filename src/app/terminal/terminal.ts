import { Channel } from '@tauri-apps/api/core';
import { WebviewWindow } from '@tauri-apps/api/webviewWindow';
import { FitAddon } from '@xterm/addon-fit';
import { Terminal } from '@xterm/xterm';
import { token } from 'styled-system/tokens';
import { createShell, resizePty, type TerminalEvent, writeToPty } from '@/generated';
import { TerminalSections } from './terminal-sections';
import { getTerminalTheme } from './themes';

// ── HMR-safe singletons ────────────────────────────────────────────────

interface TerminalCache {
  terminal: Terminal;
  fitAddon: FitAddon;
  terminalSections: TerminalSections;
  initialized?: boolean;
}

const { terminal, terminalSections, fitAddon } = getCache();

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

    // Store the terminal and addons in the cache.
    cache.terminal = terminal;
    cache.fitAddon = fitAddon;
    cache.terminalSections = terminalSections;

    const isMainWindow = WebviewWindow.getCurrent().label === 'main';
    if (isMainWindow) {
      const channel = new Channel<TerminalEvent>();
      channel.onmessage = handleEvent;

      terminal.onData((data) => {
        void writeToPty({ data });
      });

      createShell({ onEvent: channel }).catch((error) => {
        console.error('Error creating shell:', error);
      });
    } else {
      console.warn('Terminal should not be loaded in non-main windows!');
    }
  }

  return cache;
}

export { commandlineController, fitTerminal, terminal, terminalSections };
