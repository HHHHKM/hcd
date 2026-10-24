import { translate } from '../../shared/i18n';
import type { BlockEditorProps } from './types';
import { limits } from '../../../../core/src/model';
import { moveItem, removeTableColumn } from '../../editor-model';
import { TextField, SelectField } from '../../EditorFields';
import Actions from './EditorActions';
import { inlineRenderer } from './inline-renderer';
export default function TableEditor({ block, locale, onChange, ids }: BlockEditorProps<'table'>) {
  const inline = inlineRenderer(locale);
  return (
    <>
      <TextField
        label={translate(locale, 'editor.tableCaption')}
        value={block.caption}
        maxLength={limits.inline}
        onChange={(caption) => onChange({ ...block, caption })}
      />
      <div className="be-table-scroll">
        <table className="be-data-table">
          <thead>
            <tr>
              <th>{translate(locale, 'editor.row')}</th>
              {block.columns.map((column, index) => (
                <th key={column.id}>
                  <Actions
                    locale={locale}
                    index={index}
                    count={block.columns.length}
                    min={1}
                    onMove={(direction) =>
                      onChange({ ...block, columns: moveItem(block.columns, column.id, direction) })
                    }
                    onDelete={() => onChange(removeTableColumn(block, column.id))}
                  />
                  {inline(translate(locale, 'editor.columnHeader'), column.header, (header) =>
                    onChange({
                      ...block,
                      columns: block.columns.map((item) => (item.id === column.id ? { ...item, header } : item)),
                    }),
                  )}
                  <SelectField
                    label={translate(locale, 'editor.alignment')}
                    value={column.align}
                    choices={[
                      ['left', translate(locale, 'editor.left')],
                      ['center', translate(locale, 'editor.center')],
                      ['right', translate(locale, 'editor.right')],
                    ]}
                    onChange={(align) =>
                      onChange({
                        ...block,
                        columns: block.columns.map((item) => (item.id === column.id ? { ...item, align } : item)),
                      })
                    }
                  />
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {block.rows.map((row, index) => (
              <tr key={row.id}>
                <th scope="row">
                  <Actions
                    locale={locale}
                    index={index}
                    count={block.rows.length}
                    onMove={(direction) => onChange({ ...block, rows: moveItem(block.rows, row.id, direction) })}
                    onDelete={() => onChange({ ...block, rows: block.rows.filter((item) => item.id !== row.id) })}
                  />
                </th>
                {block.columns.map((column, colIndex) => (
                  <td key={column.id}>
                    {inline(
                      `${translate(locale, 'editor.cell')} ${index + 1}, ${colIndex + 1}`,
                      row.cells[column.id] ?? [],
                      (text) =>
                        onChange({
                          ...block,
                          rows: block.rows.map((item) =>
                            item.id === row.id ? { ...item, cells: { ...item.cells, [column.id]: text } } : item,
                          ),
                        }),
                    )}
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
          disabled={block.columns.length >= limits.tableColumns}
          onClick={() =>
            onChange({ ...block, columns: [...block.columns, { id: ids.next('n'), header: [], align: 'left' }] })
          }
        >
          ＋ {translate(locale, 'editor.addColumn')}
        </button>
        <button
          type="button"
          disabled={block.rows.length >= limits.tableRows}
          onClick={() => onChange({ ...block, rows: [...block.rows, { id: ids.next('n'), cells: {} }] })}
        >
          ＋ {translate(locale, 'editor.addRow')}
        </button>
      </div>
    </>
  );
}
