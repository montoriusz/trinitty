import { SettingsIcon } from 'lucide-react';
import { IconButton } from '@/ui/primitives';
import { WINDOW_LABEL_SETTINGS, windowManager } from '../window-manager';

export function SettingsButton() {
  return (
    <IconButton size="xs" variant="plain" onClick={openSettings}>
      <SettingsIcon />
    </IconButton>
  );
}

const openSettings = () => {
  windowManager.open(WINDOW_LABEL_SETTINGS);
};
