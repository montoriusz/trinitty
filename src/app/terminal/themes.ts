import type { ITheme } from '@xterm/xterm';

const TERMINAL_THEME_DARK: ITheme = {
  background: '#101211',
  green: '#33b074',
  brightGreen: '#3dd68c',
  blue: '#3b9eff',
  brightBlue: '#70b8ff',
  overviewRulerBorder: '#272a29',
};

const TERMINAL_THEME_LIGHT: ITheme = {
  // background: '#f7f8f6',
  background: '#f7f9f8',
  foreground: '#33374c',
  cursor: '#33374c',
  cursorAccent: '#e8e9ec',
  selectionBackground: '#cacdd7',
  selectionForeground: '#33374c',
  black: '#dcdfe7',
  red: '#cc517a',
  green: '#668e3d',
  yellow: '#c57339',
  blue: '#2d539e',
  magenta: '#7759b4',
  cyan: '#3f83a6',
  white: '#33374c',
  brightBlack: '#8389a3',
  brightRed: '#cc3768',
  brightGreen: '#598030',
  brightYellow: '#b6662d',
  brightBlue: '#22478e',
  brightMagenta: '#6845ad',
  brightCyan: '#327698',
  brightWhite: '#262a3f',
  overviewRulerBorder: '#e0e3df',
};

export function getTerminalTheme(isDark = true) {
  return isDark ? TERMINAL_THEME_DARK : TERMINAL_THEME_LIGHT;
}

/* xterm.js theme parsing:

```
const DEFAULT_FOREGROUND = css.toColor('#ffffff');
const DEFAULT_BACKGROUND = css.toColor('#000000');
const DEFAULT_CURSOR = css.toColor('#ffffff');
const DEFAULT_CURSOR_ACCENT = css.toColor('#000000');
const DEFAULT_SELECTION = {
  css: 'rgba(255, 255, 255, 0.3)',
  rgba: 0xFFFFFF4D
};

// An IIFE to generate DEFAULT_ANSI_COLORS.
export const DEFAULT_ANSI_COLORS = Object.freeze((() => {
  const colors = [
    // dark:
    css.toColor('#2e3436'),
    css.toColor('#cc0000'),
    css.toColor('#4e9a06'),
    css.toColor('#c4a000'),
    css.toColor('#3465a4'),
    css.toColor('#75507b'),
    css.toColor('#06989a'),
    css.toColor('#d3d7cf'),
    // bright:
    css.toColor('#555753'),
    css.toColor('#ef2929'),
    css.toColor('#8ae234'),
    css.toColor('#fce94f'),
    css.toColor('#729fcf'),
    css.toColor('#ad7fa8'),
    css.toColor('#34e2e2'),
    css.toColor('#eeeeec')
  ];

  // Fill in the remaining 240 ANSI colors.
  // Generate colors (16-231)
  const v = [0x00, 0x5f, 0x87, 0xaf, 0xd7, 0xff];
  for (let i = 0; i < 216; i++) {
    const r = v[(i / 36) % 6 | 0];
    const g = v[(i / 6) % 6 | 0];
    const b = v[i % 6];
    colors.push({
      css: channels.toCss(r, g, b),
      rgba: channels.toRgba(r, g, b)
    });
  }

  // Generate greys (232-255)
  for (let i = 0; i < 24; i++) {
    const c = 8 + i * 10;
    colors.push({
      css: channels.toCss(c, c, c),
      rgba: channels.toRgba(c, c, c)
    });
  }

  return colors;
})());

// Parse theme colors.

colors.foreground = parseColor(theme.foreground, DEFAULT_FOREGROUND);
colors.background = parseColor(theme.background, DEFAULT_BACKGROUND);
colors.cursor = parseColor(theme.cursor, DEFAULT_CURSOR);
colors.cursorAccent = parseColor(theme.cursorAccent, DEFAULT_CURSOR_ACCENT);
colors.selectionBackgroundTransparent = parseColor(theme.selectionBackground, DEFAULT_SELECTION);
colors.selectionBackgroundOpaque = color.blend(colors.background, colors.selectionBackgroundTransparent);
colors.selectionInactiveBackgroundTransparent = parseColor(theme.selectionInactiveBackground, colors.selectionBackgroundTransparent);
colors.selectionInactiveBackgroundOpaque = color.blend(colors.background, colors.selectionInactiveBackgroundTransparent);
colors.selectionForeground = theme.selectionForeground ? parseColor(theme.selectionForeground, NULL_COLOR) : undefined;
if (colors.selectionForeground === NULL_COLOR) {
  colors.selectionForeground = undefined;
}

if (color.isOpaque(colors.selectionBackgroundTransparent)) {
  const opacity = 0.3;
  colors.selectionBackgroundTransparent = color.opacity(colors.selectionBackgroundTransparent, opacity);
}
if (color.isOpaque(colors.selectionInactiveBackgroundTransparent)) {
  const opacity = 0.3;
  colors.selectionInactiveBackgroundTransparent = color.opacity(colors.selectionInactiveBackgroundTransparent, opacity);
}
colors.ansi = DEFAULT_ANSI_COLORS.slice();
colors.ansi[0] = parseColor(theme.black, DEFAULT_ANSI_COLORS[0]);
colors.ansi[1] = parseColor(theme.red, DEFAULT_ANSI_COLORS[1]);
colors.ansi[2] = parseColor(theme.green, DEFAULT_ANSI_COLORS[2]);
colors.ansi[3] = parseColor(theme.yellow, DEFAULT_ANSI_COLORS[3]);
colors.ansi[4] = parseColor(theme.blue, DEFAULT_ANSI_COLORS[4]);
colors.ansi[5] = parseColor(theme.magenta, DEFAULT_ANSI_COLORS[5]);
colors.ansi[6] = parseColor(theme.cyan, DEFAULT_ANSI_COLORS[6]);
colors.ansi[7] = parseColor(theme.white, DEFAULT_ANSI_COLORS[7]);
colors.ansi[8] = parseColor(theme.brightBlack, DEFAULT_ANSI_COLORS[8]);
colors.ansi[9] = parseColor(theme.brightRed, DEFAULT_ANSI_COLORS[9]);
colors.ansi[10] = parseColor(theme.brightGreen, DEFAULT_ANSI_COLORS[10]);
colors.ansi[11] = parseColor(theme.brightYellow, DEFAULT_ANSI_COLORS[11]);
colors.ansi[12] = parseColor(theme.brightBlue, DEFAULT_ANSI_COLORS[12]);
colors.ansi[13] = parseColor(theme.brightMagenta, DEFAULT_ANSI_COLORS[13]);
colors.ansi[14] = parseColor(theme.brightCyan, DEFAULT_ANSI_COLORS[14]);
colors.ansi[15] = parseColor(theme.brightWhite, DEFAULT_ANSI_COLORS[15]);
if (theme.extendedAnsi) {
  const colorCount = Math.min(colors.ansi.length - 16, theme.extendedAnsi.length);
  for (let i = 0; i < colorCount; i++) {
    colors.ansi[i + 16] = parseColor(theme.extendedAnsi[i], DEFAULT_ANSI_COLORS[i + 16]);
  }
}
```
*/
