import { defineSlotRecipe } from '@pandacss/dev';

export const commandlineSuggestion = defineSlotRecipe({
  className: 'commandline-suggestion',
  slots: ['root', 'command', 'actions', 'expandTrigger'],
  base: {
    root: {
      alignItems: 'start',
      borderRadius: 'l2',
      display: 'flex',
      gap: '2',
      overflow: 'hidden',
      height: 'auto',
      minWidth: 'max(10rem, 30%)',
      width: 'max-content',
      maxWidth: 'full',
      position: 'relative',
    },
    command: {
      position: 'relative',
      fontVariantNumeric: 'tabular-nums',
      fontWeight: 'medium',
      fontFamily: 'code',
      flexGrow: 1,
      minWidth: 0,
      whiteSpace: 'pre-wrap',
      wordBreak: 'break-all',
      lineHeight: '1.2',
    },
    actions: {
      zIndex: '100',
      p: '1',
      display: 'flex',
      alignItems: 'center',
      gap: '1',
      flexShrink: 0,
    },
    expandTrigger: {
      position: 'absolute',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      bottom: '-1',
      height: '6',
      width: '100%',
      left: '0',
      right: '0',
      zIndex: '1',
      transitionProperty: 'bottom',
      transitionDuration: 'fast',

      '& > div': {
        backgroundColor: 'transparent',
        transitionProperty: 'background-color',
        transitionDuration: 'fast',
        borderRadius: 'l3',
        _hover: {
          backgroundColor: 'colorPalette.subtle.bg',
        },
      },
    },
  },
  variants: {
    variant: {
      solid: {
        root: {
          bg: 'colorPalette.solid.bg',
          color: 'colorPalette.solid.fg',
        },
      },
      surface: {
        root: {
          // bg: 'colorPalette.surface.bg',
          bg: 'colorPalette.3',
          borderWidth: '1px',
          borderColor: 'colorPalette.surface.border',
          color: 'colorPalette.surface.fg',
        },
      },
      subtle: {
        root: {
          bg: 'colorPalette.subtle.bg',
          color: 'colorPalette.subtle.fg',
        },
      },
      outline: {
        root: {
          borderWidth: '1px',
          borderColor: 'colorPalette.outline.border',
          color: 'colorPalette.outline.fg',
        },
      },
      plain: {
        root: {
          color: 'colorPalette.plain.fg',
        },
      },
    },
    size: {
      xs: { command: { textStyle: 'xs', px: '1.5', pt: '1.5' } },
      sm: { command: { textStyle: 'sm', px: '1.5', pt: '1.5' } },
      md: { command: { textStyle: 'md', px: '2', pt: '2' } },
      lg: { command: { textStyle: 'lg', px: '2.5', pt: '2.5' } },
      xl: { command: { textStyle: 'xl', px: '3', pt: '3' } },
    },
    hasMore: {
      true: {
        expandTrigger: {
          // Radial gradient fading outward from the middle of the
          // pseudo-element, using --gradient-base as the base color.
          '--gradient-base': 'colors.colorPalette.3',
          backgroundImage:
            'radial-gradient(ellipse 100% 80% at 50% 110%, var(--gradient-base), var(--gradient-base) 30%, transparent)',
          '& > div': {},
        },
      },
      false: {
        expandTrigger: {
          bottom: '1',
          _closed: {
            display: 'none',
          },
        },
        command: {
          translate: '0 5px',
        },
      },
    },
  },
  staticCss: ['*'],
  defaultVariants: {
    variant: 'surface',
    size: 'md',
  },
});
