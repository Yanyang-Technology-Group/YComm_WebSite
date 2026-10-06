'use client';

import { useId } from 'react';
import {
  applyUiStyle, type UiStyle,
} from '../lib/appearance';
import { useUiStyle } from '../lib/use-ui-style';

const STYLES = [
  { id: 'flat', label: 'Flat Design', note: '默认' },
  { id: 'apple', label: 'Apple UI', note: '' },
  { id: 'legacy', label: '经典', note: '' },
] as const;

export function AppearancePicker() {
  const headingId = useId();
  const style = useUiStyle();

  function choose(next: UiStyle) {
    applyUiStyle(next, { animate: true });
  }

  return (
    <section className="appearance-picker" aria-labelledby={headingId}>
      <p id={headingId} className="appearance-heading"><strong>界面风格</strong></p>
      <div className="ui-style-picker" role="group" aria-labelledby={headingId}>
        {STYLES.map((entry) => (
          <button
            key={entry.id}
            type="button"
            className={`ui-style-option${style === entry.id ? ' active' : ''}`}
            aria-pressed={style === entry.id}
            onClick={() => choose(entry.id)}
          >
            <span className={`ui-style-preview ui-style-preview-${entry.id}`} aria-hidden="true">
              <span className="ui-style-preview-nav" />
              <span className="ui-style-preview-body">
                <span className="ui-style-preview-line" />
                <span className="ui-style-preview-card" />
                <span className="ui-style-preview-action" />
              </span>
            </span>
            <span className="ui-style-option-title">
              {entry.label}
              {entry.note && <span className="ui-style-default">{entry.note}</span>}
              <span className="ui-style-check" aria-hidden="true">{style === entry.id ? '✓' : ''}</span>
            </span>
          </button>
        ))}
      </div>
    </section>
  );
}
