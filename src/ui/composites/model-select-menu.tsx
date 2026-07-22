'use client';

import { ChevronsUpDownIcon } from 'lucide-react';
import { Fragment, type ReactNode, useCallback } from 'react';
import { Box, Flex } from 'styled-system/jsx';
import { Button } from '../primitives';
import * as Menu from '../primitives/menu';

/** One selectable option, plus the group label it belongs to. */
export interface ModelSelectOption {
  /** Stable value passed to `onSelect`; one option per group shares this value. */
  value: string;
  /** Human-readable label shown in the menu row. */
  label: string;
}

/** A labelled group of options. Consecutive non-empty groups are separated
 * by a `Menu.Separator` during render. */
export interface ModelSelectGroup {
  /** Group heading. */
  label: string;
  options: ModelSelectOption[];
}

export interface ModelSelectMenuProps {
  /** Grouped options. Empty groups are skipped during render. */
  groups: ModelSelectGroup[];
  /** Currently selected value, or `undefined` while loading/uninitialised. */
  value: string | undefined;
  /** Fired when the user picks an option. Receives the option's `value`. */
  onSelect: (value: string) => void;
  /** Disables the trigger while data is still loading. */
  isLoading?: boolean;
  /** Disables the trigger when no options are addressable. */
  disabled?: boolean;
  /** Trigger aria label. */
  ariaLabel?: string;
  /** Optional element rendered to the trailing side of the trigger label. */
  triggerIcon?: ReactNode;
}

/**
 * A grouped radio-item dropdown for selecting one option out of providers'
 * models (or any grouped option list). Presentational-only: the parent owns
 * the current `value` and supplies the `groups` + `onSelect` callback.
 *
 * The trigger shows the selected option's label (ellipsised when too long) and
 * a chevron. There is no synthetic "auto"/"default" item — the parent is
 * expected to always have a concrete selection once `groups` is loaded.
 */
export function ModelSelectMenu({
  groups,
  value,
  onSelect,
  isLoading = false,
  disabled = false,
  ariaLabel = 'Select model',
}: ModelSelectMenuProps) {
  const triggerLabel = labelForValue(groups, value);

  const handleSelect = useCallback(
    (details: Menu.SelectionDetails) => {
      if (typeof details.value === 'string') onSelect(details.value);
    },
    [onSelect],
  );

  const flatCount = groups.reduce((n, g) => n + g.options.length, 0);
  const triggerDisabled = disabled || isLoading || flatCount === 0;

  return (
    <Menu.Root onSelect={handleSelect}>
      <Menu.Trigger asChild>
        <Button size="xs" variant="plain" disabled={triggerDisabled} aria-label={ariaLabel}>
          <Flex gap="1" alignItems="center">
            <Box overflow="hidden" textOverflow="ellipsis" whiteSpace="nowrap">
              {isLoading ? '…' : triggerLabel}
            </Box>
            <ChevronsUpDownIcon size="14" aria-hidden="true" />
          </Flex>
        </Button>
      </Menu.Trigger>
      <Menu.Positioner>
        <Menu.Content minWidth="40">
          <Menu.RadioItemGroup value={value ?? ''} key={value ?? '__unset__'}>
            {renderGroups(groups)}
          </Menu.RadioItemGroup>
        </Menu.Content>
      </Menu.Positioner>
    </Menu.Root>
  );
}

/** Render the groups, separating non-empty ones with a `Menu.Separator`. */
function renderGroups(groups: ModelSelectGroup[]): ReactNode[] {
  const out: ReactNode[] = [];
  for (const group of groups) {
    if (group.options.length === 0) continue;
    out.push(
      <Fragment key={group.label}>
        <Menu.ItemGroupLabel fontWeight="semibold">{group.label}</Menu.ItemGroupLabel>
        {group.options.map((option) => (
          <Menu.RadioItem key={option.value} value={option.value} valueText={option.value}>
            <Menu.ItemText>{option.label}</Menu.ItemText>
            <Menu.ItemIndicator />
          </Menu.RadioItem>
        ))}
      </Fragment>,
    );
  }
  return out;
}

/** Find the user-facing label for a value across all groups. */
function labelForValue(groups: ModelSelectGroup[], value: string | undefined): string {
  if (value === undefined) return '…';
  for (const group of groups) {
    for (const option of group.options) {
      if (option.value === value) return option.label;
    }
  }
  return value;
}
