import { translate } from '../../shared/i18n';
import { limits, type IdSource, type ListItem } from '../../../../core/src/model';
import { moveItem } from '../../editor-model';
import { InlineField } from '../../EditorFields';
import Actions from './EditorActions';
import type { Locale } from './types';
export default function ListEditor({
  items,
  locale,
  ids,
  onChange,
  depth = 1,
}: {
  items: ListItem[];
  locale: Locale;
  ids: IdSource;
  onChange: (items: ListItem[]) => void;
  depth?: number;
}) {
  return (
    <div className="be-list">
      {items.map((item, index) => (
        <section className="be-item" key={item.id}>
          <Actions
            locale={locale}
            index={index}
            count={items.length}
            onMove={(direction) => onChange(moveItem(items, item.id, direction))}
            onDelete={() => onChange(items.filter((value) => value.id !== item.id))}
          />
          <InlineField
            label={translate(locale, 'editor.itemText')}
            value={item.text}
            locale={locale}
            onChange={(text) => onChange(items.map((value) => (value.id === item.id ? { ...value, text } : value)))}
          />
          {depth === 1 && (
            <div className="be-nested">
              <ListEditor
                items={item.items}
                locale={locale}
                ids={ids}
                depth={2}
                onChange={(children) =>
                  onChange(items.map((value) => (value.id === item.id ? { ...value, items: children } : value)))
                }
              />
            </div>
          )}
        </section>
      ))}
      <button
        type="button"
        disabled={items.length >= limits.listItems}
        onClick={() => onChange([...items, { id: ids.next('n'), text: [], items: [] }])}
      >
        ＋ {depth === 1 ? translate(locale, 'editor.addItem') : translate(locale, 'editor.addChild')}
      </button>
    </div>
  );
}
