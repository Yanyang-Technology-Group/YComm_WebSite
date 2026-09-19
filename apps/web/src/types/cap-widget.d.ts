/**
 * CAP Worker 的自定义元素类型声明：`<cap-widget>` 是 cap.min.js 提供的
 * Web Component，React 19 原生支持自定义元素，这里补上 JSX 类型。
 */
import type { HTMLAttributes } from 'react';

declare module 'react' {
  namespace JSX {
    interface IntrinsicElements {
      'cap-widget': HTMLAttributes<HTMLElement> & {
        'data-cap-api-endpoint'?: string;
        /** 表单里自动注入的隐藏字段名（默认 cap-token，这里改成后端认的 captchaToken）。 */
        'data-cap-hidden-field-name'?: string;
        'data-cap-worker-count'?: string;
        'data-cap-i18n-initial-state'?: string;
        'data-cap-i18n-verifying-label'?: string;
        'data-cap-i18n-solved-label'?: string;
        'data-cap-i18n-error-label'?: string;
        'data-cap-i18n-troubleshooting-label'?: string;
        'data-cap-i18n-verify-aria-label'?: string;
        'data-cap-i18n-verifying-aria-label'?: string;
        'data-cap-i18n-verified-aria-label'?: string;
        'data-cap-i18n-error-aria-label'?: string;
        id?: string;
      };
    }
  }
}