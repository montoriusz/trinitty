import { defineTokens } from '@pandacss/dev';

export const zIndex = defineTokens.zIndex({
  hide: {
    value: -1,
  },
  l1: {
    value: 1,
  },
  l2: {
    value: 2,
  },
  base: {
    value: 0,
  },
  docked: {
    value: 10,
  },
  dropdown: {
    value: 1000,
  },
  sticky: {
    value: 1100,
  },
  banner: {
    value: 1200,
  },
  overlay: {
    value: 1300,
  },
  modal: {
    value: 1400,
  },
  popover: {
    value: 1500,
  },
  skipLink: {
    value: 1600,
  },
  toast: {
    value: 1700,
  },
  tooltip: {
    value: 1800,
  },
});
