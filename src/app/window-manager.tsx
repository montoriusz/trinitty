import { ALL_SETTINGS_CATEGORIES } from '@/app/shared/settings-store';
import { CommonProviders } from './providers';
import { getWindowUiOptions } from './shared/get-window-ui-options';
import { WindowManagerBuilder } from './window-manager-builder';

export const WINDOW_LABEL_TERMINAL = 'terminal';
export const WINDOW_LABEL_SETTINGS = 'settings';

export const windowManager = new WindowManagerBuilder()
  .commonProviders(CommonProviders)
  .defaultWindowOptions(getWindowUiOptions)
  .defaultSettingsCategories(['Ui'])
  .register(
    {
      label: WINDOW_LABEL_TERMINAL,
      rootElement: async () => {
        const { TerminalWindow } = await import('@/app/terminal');
        return <TerminalWindow />;
      },
    },
    {
      label: WINDOW_LABEL_SETTINGS,
      rootElement: async () => {
        const { SettingsWindow } = await import('@/app/settings');
        return <SettingsWindow />;
      },
      observedSettings: ALL_SETTINGS_CATEGORIES,
      windowOptions: {
        title: 'TriniTTY — Settings',
        height: 500,
        resizable: true,
        width: 800,
      },
    },
  );
