import { collapsibleAnatomy } from '@ark-ui/react/anatomy';
import { defineSlotRecipe } from '@pandacss/dev';

export const collapsible = defineSlotRecipe({
  className: 'collapsible',
  slots: collapsibleAnatomy.keys(),
  base: {
    content: {
      overflow: 'hidden',
      _open: {
        animationName: 'expand-height, fade-in',
        animationDuration: 'slow',
      },
      _closed: {
        animationName: 'collapse-height, fade-out',
        animationDuration: 'normal',
      },
    },
    trigger: {
      cursor: 'pointer',
      _hover: {
        color: 'col',
      },
    },
    indicator: {
      _open: {
        rotate: '180deg',
      },
      _closed: {
        rotate: '0deg',
      },
    },
  },
  variants: {
    variant: {
      command: {
        root: {
          transitionProperty: 'padding, translate',
          transitionDuration: 'fast',
          minHeight: '0',
          pt: '0.5',
          pb: '0',
          position: 'relative',
          _open: {
            pb: '7',
          },
        },
        content: {
          _open: {
            animationName: 'expand-max-height',
            animationDuration: 'slow',
          },
          _closed: {
            animationName: 'collapse-max-height',
            animationDuration: 'normal',
          },
        },
      },
    },
  },
});
