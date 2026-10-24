import { translate } from './shared/i18n';
import type { Document, IdSource } from '../../core/src/model';
import { limits } from '../../core/src/model';
import BlockEditor, { BlockPicker } from './BlockEditor';
import { createBlock, duplicateBlock, insertBlock, moveItem, removeBlock, replaceBlock } from './editor-model';
import { TextField } from './TextField';
import './document-editor.css';

type Props = {
  document: Document;
  locale: 'zh-CN' | 'en';
  ids: IdSource;
  onChange: (update: (document: Document) => Document) => void;
  onComment: (moduleId: string) => void;
};
export default function DocumentEditor({ document, locale, ids, onChange, onComment }: Props) {
  const labels = {
    up: translate(locale, 'editor.moveUp'),
    down: translate(locale, 'editor.moveDown'),
    remove: translate(locale, 'editor.delete'),
    duplicate: translate(locale, 'editor.duplicate'),
    module: translate(locale, 'editor.section'),
    block: translate(locale, 'editor.block'),
    title: translate(locale, 'editor.sectionTitle'),
    comment: translate(locale, 'editor.commentOnSection'),
  };
  return (
    <div className="doc-modules structured-document-editor">
      {document.modules.map((module, moduleIndex) => (
        <section className="doc-module" key={module.id} id={`module-${module.id}`}>
          <div className="module-gutter">
            <span className="module-number">{String(moduleIndex + 1).padStart(2, '0')}</span>
            <span className="module-line" />
          </div>
          <div className="module-body">
            <div className="module-title-row">
              <TextField
                className="module-title-edit"
                label={labels.title}
                value={module.title}
                maxLength={limits.title}
                onChange={(title) =>
                  onChange((doc) => ({
                    ...doc,
                    modules: doc.modules.map((item) => (item.id === module.id ? { ...item, title } : item)),
                  }))
                }
              />
            </div>
            <div className="structure-actions" role="group" aria-label={`${labels.module} ${moduleIndex + 1}`}>
              <button
                type="button"
                disabled={moduleIndex === 0}
                onClick={() => onChange((doc) => ({ ...doc, modules: moveItem(doc.modules, module.id, -1) }))}
              >
                ↑ {labels.up}
              </button>
              <button
                type="button"
                disabled={moduleIndex === document.modules.length - 1}
                onClick={() => onChange((doc) => ({ ...doc, modules: moveItem(doc.modules, module.id, 1) }))}
              >
                ↓ {labels.down}
              </button>
              <button type="button" onClick={() => onComment(module.id)}>
                {labels.comment}
              </button>
              <button
                type="button"
                className="structure-delete"
                onClick={() =>
                  onChange((doc) => ({ ...doc, modules: doc.modules.filter((item) => item.id !== module.id) }))
                }
              >
                {labels.remove} {labels.module}
              </button>
            </div>
            <div className="module-content">
              {module.blocks.map((block, blockIndex) => (
                <div className="editable-block" key={block.id}>
                  <div className="structure-actions" role="group" aria-label={`${labels.block} ${blockIndex + 1}`}>
                    <span className="structure-index">
                      {moduleIndex + 1}.{blockIndex + 1}
                    </span>
                    <button
                      type="button"
                      aria-label={`${labels.up} ${labels.block}`}
                      disabled={blockIndex === 0}
                      onClick={() =>
                        onChange((doc) => ({
                          ...doc,
                          modules: doc.modules.map((item) =>
                            item.id === module.id ? { ...item, blocks: moveItem(item.blocks, block.id, -1) } : item,
                          ),
                        }))
                      }
                    >
                      ↑
                    </button>
                    <button
                      type="button"
                      aria-label={`${labels.down} ${labels.block}`}
                      disabled={blockIndex === module.blocks.length - 1}
                      onClick={() =>
                        onChange((doc) => ({
                          ...doc,
                          modules: doc.modules.map((item) =>
                            item.id === module.id ? { ...item, blocks: moveItem(item.blocks, block.id, 1) } : item,
                          ),
                        }))
                      }
                    >
                      ↓
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        const copy = duplicateBlock(block, ids);
                        onChange((doc) => ({
                          ...doc,
                          modules: doc.modules.map((item) =>
                            item.id === module.id
                              ? {
                                  ...item,
                                  blocks: item.blocks.flatMap((child) =>
                                    child.id === block.id ? [child, copy] : [child],
                                  ),
                                }
                              : item,
                          ),
                        }));
                      }}
                    >
                      {labels.duplicate}
                    </button>
                    <button
                      type="button"
                      className="structure-delete"
                      onClick={() => onChange((doc) => removeBlock(doc, module.id, block.id))}
                    >
                      {labels.remove}
                    </button>
                  </div>
                  <BlockEditor
                    block={block}
                    locale={locale}
                    ids={ids}
                    onChange={(next) => onChange((doc) => replaceBlock(doc, module.id, block.id, next))}
                  />
                </div>
              ))}
            </div>
            <BlockPicker
              locale={locale}
              onSelect={(type) => {
                const block = createBlock(type, ids, locale);
                onChange((doc) => insertBlock(doc, module.id, block));
              }}
            />
          </div>
        </section>
      ))}
    </div>
  );
}
