import { limits, type IdSource, type LeafBlock } from '../../../../core/src/model';
import { createBlock, moveItem } from '../../editor-model';
import BlockEditor from '../../BlockEditor';
import BlockPicker from './BlockPicker';
import Actions from './EditorActions';
import type { Locale } from './types';
export default function LeafCollection({
  blocks,
  locale,
  ids,
  onChange,
}: {
  blocks: LeafBlock[];
  locale: Locale;
  ids: IdSource;
  onChange: (blocks: LeafBlock[]) => void;
}) {
  return (
    <div className="be-stack">
      {blocks.map((block, index) => (
        <section className="be-item" key={block.id}>
          <Actions
            locale={locale}
            index={index}
            count={blocks.length}
            onMove={(direction) => onChange(moveItem(blocks, block.id, direction))}
            onDelete={() => onChange(blocks.filter((item) => item.id !== block.id))}
          />
          <BlockEditor
            block={block}
            locale={locale}
            ids={ids}
            onChange={(next) => {
              if (next.type !== 'columns' && next.type !== 'cards')
                onChange(blocks.map((item) => (item.id === block.id ? next : item)));
            }}
          />
        </section>
      ))}
      <BlockPicker
        locale={locale}
        leafOnly
        disabled={blocks.length >= limits.nestedBlocks}
        onSelect={(type) => {
          const block = createBlock(type, ids, locale);
          if (block.type !== 'columns' && block.type !== 'cards') onChange([...blocks, block]);
        }}
      />
    </div>
  );
}
