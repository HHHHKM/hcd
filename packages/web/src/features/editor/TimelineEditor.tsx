import { translate } from '../../shared/i18n';
import type { BlockEditorProps } from './types';
import { limits } from '../../../../core/src/model';
import { moveItem } from '../../editor-model';
import { TextField } from '../../EditorFields';
import Actions from './EditorActions';
import { inlineRenderer } from './inline-renderer';
export default function TimelineEditor({ block, locale, onChange, ids }: BlockEditorProps<'timeline'>) {
  const inline = inlineRenderer(locale);
  return (
    <>
      {block.items.map((item, index) => (
        <section className="be-item" key={item.id}>
          <Actions
            locale={locale}
            index={index}
            count={block.items.length}
            min={2}
            onMove={(direction) => onChange({ ...block, items: moveItem(block.items, item.id, direction) })}
            onDelete={() => onChange({ ...block, items: block.items.filter((value) => value.id !== item.id) })}
          />
          <div className="be-grid">
            <TextField
              label={translate(locale, 'editor.dateStage')}
              value={item.label}
              maxLength={40}
              onChange={(value) =>
                onChange({
                  ...block,
                  items: block.items.map((row) => (row.id === item.id ? { ...row, label: value } : row)),
                })
              }
            />
            <TextField
              label={translate(locale, 'editor.title')}
              value={item.title}
              onChange={(title) =>
                onChange({
                  ...block,
                  items: block.items.map((row) => (row.id === item.id ? { ...row, title } : row)),
                })
              }
            />
          </div>
          {inline(translate(locale, 'editor.description'), item.text, (text) =>
            onChange({ ...block, items: block.items.map((row) => (row.id === item.id ? { ...row, text } : row)) }),
          )}
        </section>
      ))}
      <button
        type="button"
        disabled={block.items.length >= limits.timelineItems}
        onClick={() =>
          onChange({ ...block, items: [...block.items, { id: ids.next('n'), label: '', title: '', text: [] }] })
        }
      >
        ＋ {translate(locale, 'editor.addStage')}
      </button>
    </>
  );
}
