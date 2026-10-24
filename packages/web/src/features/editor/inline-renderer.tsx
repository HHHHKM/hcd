import { InlineField } from '../../EditorFields';
import type { Inline } from '../../../../core/src/model';
import type { Locale } from './types';
export const inlineRenderer = (locale: Locale) => (title: string, value: Inline, change: (value: Inline) => void) => (
  <InlineField label={title} value={value} onChange={change} locale={locale} />
);
