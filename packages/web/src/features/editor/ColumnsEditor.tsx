import { translate } from '../../shared/i18n';
import type { BlockEditorProps } from './types';
import { limits } from '../../../../core/src/model';
import { moveItem } from '../../editor-model';
import LeafCollection from './LeafCollection';
export default function ColumnsEditor({ block, locale, onChange, ids }: BlockEditorProps<'columns'>) {
  return (
    <>
      <label className="be-field">
        <span>{translate(locale, 'editor.columnRatio')}</span>
        <select
          value={block.ratio}
          onChange={(event) => {
            const ratio = event.currentTarget.value as typeof block.ratio;
            if (ratio === '1:1:1' && block.cols.length === 2)
              onChange({ ...block, ratio, cols: [...block.cols, { id: ids.next('n'), blocks: [] }] });
            else if (ratio !== '1:1:1' && block.cols.length === 3) {
              const combined = [...block.cols[1]!.blocks, ...block.cols[2]!.blocks];
              if (combined.length <= limits.nestedBlocks)
                onChange({ ...block, ratio, cols: [block.cols[0]!, { ...block.cols[1]!, blocks: combined }] });
            } else onChange({ ...block, ratio });
          }}
        >
          {(['1:1', '1:2', '2:1', '1:1:1'] as const).map((ratio) => (
            <option
              key={ratio}
              value={ratio}
              disabled={
                ratio !== '1:1:1' &&
                block.cols.length === 3 &&
                block.cols[1]!.blocks.length + block.cols[2]!.blocks.length > limits.nestedBlocks
              }
            >
              {ratio}
            </option>
          ))}
        </select>
      </label>
      {block.cols.length === 3 && (
        <p className="be-note">{translate(locale, 'editor.switchingToTwoColumnsMovesTheThirdColumnS')}</p>
      )}
      {block.cols.map((col, index) => (
        <fieldset className="be-group" key={col.id}>
          <legend>
            {translate(locale, 'editor.column')} {index + 1}
          </legend>
          <div className="be-actions">
            <button
              type="button"
              disabled={index === 0}
              onClick={() => onChange({ ...block, cols: moveItem(block.cols, col.id, -1) })}
            >
              ↑ {translate(locale, 'editor.moveUp')}
            </button>
            <button
              type="button"
              disabled={index === block.cols.length - 1}
              onClick={() => onChange({ ...block, cols: moveItem(block.cols, col.id, 1) })}
            >
              ↓ {translate(locale, 'editor.moveDown')}
            </button>
          </div>
          <LeafCollection
            blocks={col.blocks}
            locale={locale}
            ids={ids}
            onChange={(blocks) =>
              onChange({
                ...block,
                cols: block.cols.map((item) => (item.id === col.id ? { ...item, blocks } : item)),
              })
            }
          />
        </fieldset>
      ))}
    </>
  );
}
