import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { createCounterIdSource } from '../../core/src/model';
import { blockTypes, createBlock } from './editor-model';
import BlockEditor, { BlockPicker } from './BlockEditor';

describe('block editing controls', () => {
  it(
    'AT-43 renders every editable model type in both languages without changing IDs or allocating ' + 'during render',
    () => {
      for (const locale of ['zh-CN', 'en'] as const) {
        const factoryIds = createCounterIdSource();
        const noAllocation = {
          next: () => {
            throw new Error('Render must not allocate IDs');
          },
        };
        for (const type of blockTypes) {
          const block = createBlock(type, factoryIds, locale);
          const original = JSON.stringify(block);
          const html = renderToStaticMarkup(
            <BlockEditor
              block={block}
              locale={locale}
              ids={noAllocation}
              onChange={() => {
                throw new Error('Render must not change content');
              }}
            />,
          );
          expect(html).toContain('block-editor');
          expect(JSON.stringify(block)).toBe(original);
        }
      }
    },
  );
  it('restricts nested block pickers and raw content editing', () => {
    const html = renderToStaticMarkup(<BlockPicker locale="en" leafOnly onSelect={() => undefined} />);
    expect(html).toContain('value="table"');
    expect(html).not.toContain('value="columns"');
    expect(html).not.toContain('value="cards"');
    expect(html).not.toContain('value="raw"');
    const raw = renderToStaticMarkup(
      <BlockEditor
        block={{
          id: 'n_aaaaaaaa',
          type: 'raw',
          asset: 'as_aaaaaaaaaaaa',
          height: 300,
          allowScripts: false,
          note: 'Original source',
        }}
        locale="en"
        ids={createCounterIdSource()}
        onChange={() => undefined}
      />,
    );
    expect(raw).toContain('Original source');
    expect(raw).not.toContain('<input');
  });
});
