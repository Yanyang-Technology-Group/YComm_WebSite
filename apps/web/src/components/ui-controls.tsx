'use client';

import { Button, Input, Textarea } from '@extrastu/nuphy-ui';
import type { ComponentProps } from 'react';
import { useUiStyle } from '../lib/use-ui-style';

export function UiButton(props: ComponentProps<'button'>) {
  return useUiStyle() === 'apple' ? <Button {...props} className={`nuphy-button ${props.className ?? ''}`} /> : <button {...props} />;
}
export function UiInput(props: ComponentProps<'input'>) {
  const apple = useUiStyle() === 'apple';
  return apple && !['checkbox', 'radio', 'file', 'range'].includes(props.type ?? '')
    ? <Input {...props} className={`nuphy-input ${props.className ?? ''}`} /> : <input {...props} />;
}
export function UiTextarea(props: ComponentProps<'textarea'>) {
  return useUiStyle() === 'apple' ? <Textarea {...props} className={`nuphy-input ${props.className ?? ''}`} /> : <textarea {...props} />;
}
