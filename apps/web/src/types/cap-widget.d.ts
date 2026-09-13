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
        id?: string;
      };
    }
  }
}