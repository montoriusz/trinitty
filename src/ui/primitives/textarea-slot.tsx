'use client';
import { ark } from '@ark-ui/react/factory';
import { Field } from '@ark-ui/react/field';
import type { ComponentProps } from 'react';
import { createStyleContext } from 'styled-system/jsx';
import { textareaSlot } from 'styled-system/recipes';

const { withProvider, withContext } = createStyleContext(textareaSlot);

export type RootProps = ComponentProps<typeof Root>;
/** Wrapper that carries the border, background and focus ring. */
export const Root = withProvider(ark.div, 'root');

export type InputProps = ComponentProps<typeof Input>;
/** The actual textarea. Supports Ark `Field` props such as `autoresize`. */
export const Input = withContext(Field.Textarea, 'input');

// TODO: focus input on unhandled footer clicks

export type FooterProps = ComponentProps<typeof Footer>;
/** Slot for extra controls, rendered below the textarea and inside the border. */
export const Footer = withContext(ark.div, 'footer');
