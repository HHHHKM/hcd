import { translate } from '../../shared/i18n';
import type { BlockEditorProps } from './types';
import { moveItem } from '../../editor-model';
import { TextField, SelectField } from '../../EditorFields';
import Actions from './EditorActions';
import LeafCollection from './LeafCollection';
export default function CardsEditor({ block, locale, onChange, ids }: BlockEditorProps<'cards'>) {
  return (
    <>
      <SelectField
        label={translate(locale, 'editor.cardsPerRow')}
        value={String(block.perRow)}
        choices={[
          ['2', '2'],
          ['3', '3'],
          ['4', '4'],
        ]}
        onChange={(value) => onChange({ ...block, perRow: Number(value) as 2 | 3 | 4 })}
      />
      {block.items.map((card, index) => (
        <fieldset className="be-group" key={card.id}>
          <legend>
            {translate(locale, 'editor.card')} {index + 1}
          </legend>
          <Actions
            locale={locale}
            index={index}
            count={block.items.length}
            min={2}
            onMove={(direction) => onChange({ ...block, items: moveItem(block.items, card.id, direction) })}
            onDelete={() => onChange({ ...block, items: block.items.filter((item) => item.id !== card.id) })}
          />
          <TextField
            label={translate(locale, 'editor.cardTitle')}
            value={card.title}
            onChange={(title) =>
              onChange({
                ...block,
                items: block.items.map((item) => (item.id === card.id ? { ...item, title } : item)),
              })
            }
          />
          <LeafCollection
            blocks={card.blocks}
            locale={locale}
            ids={ids}
            onChange={(blocks) =>
              onChange({
                ...block,
                items: block.items.map((item) => (item.id === card.id ? { ...item, blocks } : item)),
              })
            }
          />
        </fieldset>
      ))}
      <button
        type="button"
        disabled={block.items.length >= 12}
        onClick={() => onChange({ ...block, items: [...block.items, { id: ids.next('n'), title: '', blocks: [] }] })}
      >
        ＋ {translate(locale, 'editor.addCard')}
      </button>
    </>
  );
}
