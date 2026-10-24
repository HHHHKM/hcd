import { translate } from '../../shared/i18n';
import type { BlockEditorProps, Locale } from './types';
import { limits } from '../../../../core/src/model';
import { moveItem, removeChartCategory } from '../../editor-model';
import { TextField } from '../../EditorFields';
import { ChartRead } from '../../BlockRead';
import Actions from './EditorActions';
export default function ChartEditor({ block, locale, onChange, ids }: BlockEditorProps<'chart'>) {
  return (
    <>
      <label className="be-field">
        <span>{translate(locale, 'editor.chartType')}</span>
        <select
          value={block.kind}
          onChange={(event) => onChange({ ...block, kind: event.currentTarget.value as typeof block.kind })}
        >
          <option value="bar">{translate(locale, 'editor.bar')}</option>
          <option value="line">{translate(locale, 'editor.line')}</option>
          <option value="pie" disabled={block.series.length > 1}>
            {translate(locale, 'editor.pieOneSeries')}
          </option>
        </select>
      </label>
      <div className="be-grid">
        <TextField
          label={translate(locale, 'editor.title')}
          value={block.title}
          onChange={(title) => onChange({ ...block, title })}
        />
        <TextField
          label={translate(locale, 'editor.unit')}
          value={block.unit}
          onChange={(unit) => onChange({ ...block, unit })}
        />
      </div>
      <div className="be-table-scroll">
        <table className="be-data-table">
          <thead>
            <tr>
              <th>{translate(locale, 'editor.category')}</th>
              {block.series.map((series, index) => (
                <th key={series.id}>
                  <Actions
                    locale={locale}
                    index={index}
                    count={block.series.length}
                    min={1}
                    onMove={(direction) => onChange({ ...block, series: moveItem(block.series, series.id, direction) })}
                    onDelete={() =>
                      onChange({ ...block, series: block.series.filter((item) => item.id !== series.id) })
                    }
                  />
                  <TextField
                    label={translate(locale, 'editor.seriesName')}
                    value={series.name}
                    onChange={(name) =>
                      onChange({
                        ...block,
                        series: block.series.map((item) => (item.id === series.id ? { ...item, name } : item)),
                      })
                    }
                  />
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {block.categories.map((category, index) => (
              <tr key={category.id}>
                <th scope="row">
                  <Actions
                    locale={locale}
                    index={index}
                    count={block.categories.length}
                    min={1}
                    onMove={(direction) =>
                      onChange({ ...block, categories: moveItem(block.categories, category.id, direction) })
                    }
                    onDelete={() => onChange(removeChartCategory(block, category.id))}
                  />
                  <TextField
                    label={translate(locale, 'editor.categoryLabel')}
                    value={category.label}
                    onChange={(name) =>
                      onChange({
                        ...block,
                        categories: block.categories.map((item) =>
                          item.id === category.id ? { ...item, label: name } : item,
                        ),
                      })
                    }
                  />
                </th>
                {block.series.map((series) => (
                  <td key={series.id}>
                    <ChartNumber
                      label={`${category.label} · ${series.name}`}
                      value={series.values[category.id] ?? null}
                      locale={locale}
                      onChange={(value) =>
                        onChange({
                          ...block,
                          series: block.series.map((item) =>
                            item.id === series.id
                              ? { ...item, values: { ...item.values, [category.id]: value } }
                              : item,
                          ),
                        })
                      }
                    />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="be-actions">
        <button
          type="button"
          disabled={block.categories.length >= limits.chartCategories}
          onClick={() => onChange({ ...block, categories: [...block.categories, { id: ids.next('n'), label: '' }] })}
        >
          ＋ {translate(locale, 'editor.addCategory')}
        </button>
        <button
          type="button"
          disabled={block.series.length >= limits.chartSeries || (block.kind === 'pie' && block.series.length >= 1)}
          onClick={() => onChange({ ...block, series: [...block.series, { id: ids.next('n'), name: '', values: {} }] })}
        >
          ＋ {translate(locale, 'editor.addSeries')}
        </button>
      </div>
      <ChartRead block={block} locale={locale} />
    </>
  );
}

function ChartNumber({
  label,
  value,
  locale,
  onChange,
}: {
  label: string;
  value: number | null;
  locale: Locale;
  onChange: (value: number | null) => void;
}) {
  return (
    <TextField
      label={label}
      value={value === null ? '' : String(value)}
      inputMode="decimal"
      maxLength={40}
      onChange={(text) => {
        if (text.trim() === '') onChange(null);
        else if (Number.isFinite(Number(text))) onChange(Number(text));
      }}
      className={locale === 'zh-CN' ? 'be-number zh' : 'be-number'}
    />
  );
}
