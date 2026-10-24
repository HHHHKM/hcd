import type { ReactNode } from 'react';
import type { BlockEditorProps } from './features/editor/types';
import { translate } from './shared/i18n';
import { InlineField, SelectField, TextField } from './EditorFields';
import { limits } from '../../core/src/model';
import { ImageUpload } from './DocumentAssets';
import ListEditor from './features/editor/ListEditor';
import './block-editor.css';
export { default as BlockPicker } from './features/editor/BlockPicker';
import TableEditor from './features/editor/TableEditor';
import ChartEditor from './features/editor/ChartEditor';
import KpiEditor from './features/editor/KpiEditor';
import TimelineEditor from './features/editor/TimelineEditor';
import ColumnsEditor from './features/editor/ColumnsEditor';
import CardsEditor from './features/editor/CardsEditor';
export default function BlockEditor({ block, locale, onChange, ids }: BlockEditorProps) {
  const inline = (
    title: string,
    value: import('../../core/src/model').Inline,
    change: (value: import('../../core/src/model').Inline) => void,
  ) => <InlineField label={title} value={value} onChange={change} locale={locale} />;
  let content: ReactNode;
  switch (block.type) {
    case 'paragraph':
    case 'quote':
      content = inline(translate(locale, 'editor.text'), block.text, (text) => onChange({ ...block, text }));
      break;
    case 'heading':
      content = (
        <>
          <SelectField
            label={translate(locale, 'editor.headingLevel')}
            value={String(block.level)}
            choices={[
              ['3', translate(locale, 'editor.heading3')],
              ['4', translate(locale, 'editor.heading4')],
            ]}
            onChange={(value) => onChange({ ...block, level: Number(value) as 3 | 4 })}
          />
          {inline(translate(locale, 'editor.headingText'), block.text, (text) => onChange({ ...block, text }))}
        </>
      );
      break;
    case 'divider':
      content = <hr className="doc-divider" />;
      break;
    case 'raw':
      content = (
        <p className="be-note">{block.note || translate(locale, 'editor.readOnlyContentYouCanMoveOrDeleteThis')}</p>
      );
      break;
    case 'image':
      content = (
        <>
          <ImageUpload
            locale={locale}
            asset={block.asset}
            alt={block.alt}
            onChange={(asset, alt) => onChange({ ...block, asset, alt })}
          />
          <TextField
            label={translate(locale, 'editor.alternativeText')}
            value={block.alt}
            onChange={(alt) => onChange({ ...block, alt })}
            maxLength={limits.inline}
          />
          <TextField
            label={translate(locale, 'editor.caption')}
            value={block.caption}
            onChange={(caption) => onChange({ ...block, caption })}
            maxLength={limits.inline}
          />
          <SelectField
            label={translate(locale, 'editor.width')}
            value={block.width}
            choices={[
              ['small', translate(locale, 'editor.small')],
              ['normal', translate(locale, 'editor.normal')],
              ['wide', translate(locale, 'editor.wide')],
              ['full', translate(locale, 'editor.full')],
            ]}
            onChange={(width) => onChange({ ...block, width })}
          />
        </>
      );
      break;
    case 'callout':
      content = (
        <>
          <SelectField
            label={translate(locale, 'editor.tone')}
            value={block.tone}
            choices={[
              ['info', translate(locale, 'editor.information')],
              ['success', translate(locale, 'editor.success')],
              ['warn', translate(locale, 'editor.warning')],
              ['danger', translate(locale, 'editor.danger')],
            ]}
            onChange={(tone) => onChange({ ...block, tone })}
          />
          <TextField
            label={translate(locale, 'editor.title')}
            value={block.title}
            onChange={(title) => onChange({ ...block, title })}
          />
          {inline(translate(locale, 'editor.text'), block.text, (text) => onChange({ ...block, text }))}
        </>
      );
      break;
    case 'list':
      content = (
        <>
          <label className="be-checkbox">
            <input
              type="checkbox"
              checked={block.ordered}
              onChange={(event) => onChange({ ...block, ordered: event.currentTarget.checked })}
            />
            {translate(locale, 'editor.numberedList')}
          </label>
          <ListEditor
            items={block.items}
            ids={ids}
            locale={locale}
            onChange={(items) => onChange({ ...block, items })}
          />
        </>
      );
      break;
    case 'table':
      content = <TableEditor block={block} locale={locale} onChange={onChange} ids={ids} />;
      break;
    case 'chart':
      content = <ChartEditor block={block} locale={locale} onChange={onChange} ids={ids} />;
      break;
    case 'kpis':
      content = <KpiEditor block={block} locale={locale} onChange={onChange} ids={ids} />;
      break;
    case 'timeline':
      content = <TimelineEditor block={block} locale={locale} onChange={onChange} ids={ids} />;
      break;
    case 'columns':
      content = <ColumnsEditor block={block} locale={locale} onChange={onChange} ids={ids} />;
      break;
    case 'cards':
      content = <CardsEditor block={block} locale={locale} onChange={onChange} ids={ids} />;
      break;
  }
  return (
    <section
      className="block-editor"
      aria-label={
        block.type === 'raw'
          ? translate(locale, 'editor.readOnlyContent')
          : translate(locale, `editor.blockNames.${block.type}`)
      }
    >
      <div className="be-type">
        {block.type === 'raw'
          ? translate(locale, 'editor.readOnlyContent')
          : translate(locale, `editor.blockNames.${block.type}`)}
      </div>
      {content}
    </section>
  );
}
