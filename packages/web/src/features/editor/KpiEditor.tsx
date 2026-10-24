import { translate } from '../../shared/i18n';
import type { BlockEditorProps } from './types';
import { limits } from '../../../../core/src/model';
import { moveItem } from '../../editor-model';
import { TextField, SelectField } from '../../EditorFields';
import Actions from './EditorActions';
export default function KpiEditor({ block, locale, onChange, ids }: BlockEditorProps<'kpis'>) {
  return (
    <>
      {block.items.map((item, index) => (
        <section className="be-item" key={item.id}>
          <Actions
            locale={locale}
            index={index}
            count={block.items.length}
            min={1}
            onMove={(direction) => onChange({ ...block, items: moveItem(block.items, item.id, direction) })}
            onDelete={() => onChange({ ...block, items: block.items.filter((value) => value.id !== item.id) })}
          />
          <div className="be-grid">
            {(['label', 'value', 'delta'] as const).map((field) => (
              <TextField
                key={field}
                label={
                  {
                    label: translate(locale, 'editor.metricLabel'),
                    value: translate(locale, 'editor.value'),
                    delta: translate(locale, 'editor.change'),
                  }[field]
                }
                value={item[field]}
                maxLength={40}
                onChange={(value) =>
                  onChange({
                    ...block,
                    items: block.items.map((row) => (row.id === item.id ? { ...row, [field]: value } : row)),
                  })
                }
              />
            ))}
          </div>
          <SelectField
            label={translate(locale, 'editor.trend')}
            value={item.tone}
            choices={[
              ['neutral', translate(locale, 'editor.neutral')],
              ['good', translate(locale, 'editor.positive')],
              ['bad', translate(locale, 'editor.negative')],
            ]}
            onChange={(tone) =>
              onChange({ ...block, items: block.items.map((row) => (row.id === item.id ? { ...row, tone } : row)) })
            }
          />
        </section>
      ))}
      <button
        type="button"
        disabled={block.items.length >= limits.kpiItems}
        onClick={() =>
          onChange({
            ...block,
            items: [...block.items, { id: ids.next('n'), label: '', value: '', delta: '', tone: 'neutral' }],
          })
        }
      >
        ＋ {translate(locale, 'editor.addMetric')}
      </button>
    </>
  );
}
