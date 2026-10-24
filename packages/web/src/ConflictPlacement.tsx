import { translate } from './shared/i18n';
import { useState } from 'react';
import type { Document } from '../../core/src/model';
import type { ParentRef } from '../../core/src/ops';
type Option = { parent: ParentRef; label: string; children: Array<{ id: string; label: string }> };
function destinations(document: Document, locale: 'zh-CN' | 'en'): Option[] {
  const options: Option[] = [];
  const labels: Record<string, string> = {
    modules: translate(locale, 'review.sections'),
    blocks: translate(locale, 'review.blocks'),
    items: translate(locale, 'review.items'),
    columns: translate(locale, 'review.tableColumns'),
    rows: translate(locale, 'review.tableRows'),
    categories: translate(locale, 'review.chartCategories'),
    series: translate(locale, 'review.chartSeries'),
    cols: translate(locale, 'review.columns'),
  };
  const text = (node: Record<string, unknown>, index: number): string =>
    (typeof node.title === 'string' && node.title) ||
    (typeof node.label === 'string' && node.label) ||
    (Array.isArray(node.text)
      ? node.text
          .map((run) => run.t ?? '')
          .join('')
          .slice(0, 35)
      : '') ||
    `${String(node.type ?? translate(locale, 'review.item'))} ${index + 1}`;
  const walk = (node: Record<string, unknown>, path: string) => {
    for (const [key, label] of Object.entries(labels)) {
      const children = node[key];
      if (!Array.isArray(children)) continue;
      options.push({
        parent: { id: String(node.id), list: key as ParentRef['list'] },
        label: `${path} / ${label}`,
        children: children.map((child, index) => ({ id: child.id, label: text(child, index) })),
      });
      children.forEach((child, index) => walk(child, `${path} / ${text(child, index)}`));
    }
  };
  walk(document as unknown as Record<string, unknown>, document.title);
  return options;
}
export default function ConflictPlacement({
  document,
  locale,
  busy,
  onPlace,
}: {
  document: Document;
  locale: 'zh-CN' | 'en';
  busy: boolean;
  onPlace: (parent: ParentRef, after: string | null) => void;
}) {
  const options = destinations(document, locale);
  const [selected, setSelected] = useState('');
  const [after, setAfter] = useState('');
  const option = options.find((item) => `${item.parent.id}:${item.parent.list}` === selected);
  return (
    <div className="conflict-placement">
      <label>
        {translate(locale, 'review.destination')}
        <select
          value={selected}
          disabled={busy}
          onChange={(event) => {
            setSelected(event.target.value);
            setAfter('');
          }}
        >
          <option value="">{translate(locale, 'review.chooseADestination')}</option>
          {options.map((item) => (
            <option key={`${item.parent.id}:${item.parent.list}`} value={`${item.parent.id}:${item.parent.list}`}>
              {item.label}
            </option>
          ))}
        </select>
      </label>
      {option && (
        <label>
          {translate(locale, 'review.insertAfter')}
          <select value={after} disabled={busy} onChange={(event) => setAfter(event.target.value)}>
            <option value="">{translate(locale, 'review.beginningOfList')}</option>
            {option.children.map((child) => (
              <option key={child.id} value={child.id}>
                {child.label}
              </option>
            ))}
          </select>
        </label>
      )}
      <button
        disabled={busy || !option || Boolean(after && !option.children.some((child) => child.id === after))}
        onClick={() => {
          if (option) onPlace(option.parent, after || null);
        }}
      >
        {translate(locale, 'review.placeHere')}
      </button>
    </div>
  );
}
