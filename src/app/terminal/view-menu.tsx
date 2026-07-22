import { GalleryVerticalIcon, PanelRightIcon } from 'lucide-react';
import { useCallback } from 'react';
import { Flex } from 'styled-system/jsx';
import { Button, Menu } from '@/ui/primitives';
import { useSelectedView } from './selected-view-store';

export const VIEW_TYPES = {
  split: { label: 'Side by side', icon: <PanelRightIcon /> },
  notebook: { label: 'Unified', icon: <GalleryVerticalIcon /> },
} as const;

export type ViewType = keyof typeof VIEW_TYPES;

export function ViewMenu() {
  const { viewValue, setSelectedView } = useSelectedView();

  const { label, icon } = VIEW_TYPES[viewValue] ?? { label: 'Unknown', icon: <></> };

  const handleSelect = useCallback(
    (details: Menu.SelectionDetails) => {
      setSelectedView(details.value as ViewType);
    },
    [setSelectedView],
  );

  return (
    <Menu.Root onSelect={handleSelect}>
      <Menu.Trigger asChild>
        <Button size="xs" variant="plain" title={`View: ${label}`}>
          <Flex gap="1" alignItems="center">
            {icon}
            <Menu.Indicator />
          </Flex>
        </Button>
      </Menu.Trigger>
      <Menu.Positioner>
        <Menu.Content minWidth="40">
          <Menu.RadioItemGroup value={viewValue ?? ''} key={viewValue ?? '__unset__'}>
            {Object.entries(VIEW_TYPES).map(([key, { label, icon }]) => (
              <Menu.RadioItem key={key} value={key} valueText={label}>
                {icon}
                <Menu.ItemText>{label}</Menu.ItemText>
                <Menu.ItemIndicator />
              </Menu.RadioItem>
            ))}
          </Menu.RadioItemGroup>
        </Menu.Content>
      </Menu.Positioner>
    </Menu.Root>
  );
}
