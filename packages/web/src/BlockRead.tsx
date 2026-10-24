import type { CSSProperties } from 'react';
import type { Block, Inline, ListItem } from '../../core/src/model';
import './block-read.css';
import { DocumentImage, DocumentRaw } from './DocumentAssets';
import { ChartRead } from '../../render/src/Chart';
import { AnchorText, InlineText } from './AnchorText';
export { ChartRead } from '../../render/src/Chart';

export function RenderInline({ inline, links = true }: { inline: Inline; links?: boolean }) {
  return <InlineText inline={inline} links={links} />;
}

function List({ items, ordered, blockId }: { items: ListItem[]; ordered: boolean; blockId?: string }) {
  const Tag = ordered ? 'ol' : 'ul';
  return (
    <Tag className="document-list" data-hcd-block-id={blockId}>
      {items.map((item) => (
        <li key={item.id} data-hcd-block-id={item.id}>
          <AnchorText nodeId={item.id} field="text" value={item.text} />
          {item.items.length > 0 && <List items={item.items} ordered={ordered} />}
        </li>
      ))}
    </Tag>
  );
}

export default function BlockRead({ block, locale }: { block: Block; locale: 'zh-CN' | 'en' }) {
  switch (block.type) {
    case 'paragraph':
      return (
        <p className="edit-paragraph" data-hcd-block-id={block.id}>
          <AnchorText nodeId={block.id} field="text" value={block.text} />
        </p>
      );
    case 'heading': {
      const Tag = block.level === 3 ? 'h3' : 'h4';
      return (
        <Tag className="edit-heading" data-hcd-block-id={block.id}>
          <AnchorText nodeId={block.id} field="text" value={block.text} />
        </Tag>
      );
    }
    case 'quote':
      return (
        <blockquote className="module-quote" data-hcd-block-id={block.id}>
          <AnchorText nodeId={block.id} field="text" value={block.text} />
        </blockquote>
      );
    case 'list':
      return <List items={block.items} ordered={block.ordered} blockId={block.id} />;
    case 'callout':
      return (
        <aside className={`callout callout-${block.tone}`} data-hcd-block-id={block.id}>
          <span className="callout-mark">↳</span>
          <div>
            {block.title && (
              <strong>
                <AnchorText nodeId={block.id} field="title" value={block.title} />
              </strong>
            )}
            <div>
              <AnchorText nodeId={block.id} field="text" value={block.text} />
            </div>
          </div>
        </aside>
      );
    case 'table':
      return (
        <div className="table-scroll" data-hcd-block-id={block.id}>
          <table>
            {block.caption && (
              <caption>
                <AnchorText nodeId={block.id} field="caption" value={block.caption} />
              </caption>
            )}
            <thead>
              <tr>
                {block.columns.map((column) => (
                  <th key={column.id} data-hcd-block-id={column.id} scope="col" style={{ textAlign: column.align }}>
                    <AnchorText nodeId={column.id} field="header" value={column.header} />
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {block.rows.map((row) => (
                <tr key={row.id} data-hcd-block-id={row.id}>
                  {block.columns.map((column) => (
                    <td key={column.id} style={{ textAlign: column.align }}>
                      {row.cells[column.id] !== undefined && (
                        <AnchorText nodeId={row.id} field={`cell:${column.id}`} value={row.cells[column.id]!} />
                      )}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    case 'chart':
      return (
        <ChartRead
          block={block}
          locale={locale}
          renderText={(nodeId, field, value) => <AnchorText nodeId={nodeId} field={field} value={value} />}
        />
      );
    case 'kpis':
      return (
        <div className="kpi-grid" data-hcd-block-id={block.id}>
          {block.items.map((item) => (
            <div className={`kpi kpi-${item.tone}`} key={item.id} data-hcd-block-id={item.id}>
              <span>
                <AnchorText nodeId={item.id} field="label" value={item.label} />
              </span>
              <strong>
                <AnchorText nodeId={item.id} field="value" value={item.value} />
              </strong>
              <small>
                <AnchorText nodeId={item.id} field="delta" value={item.delta} />
              </small>
            </div>
          ))}
        </div>
      );
    case 'timeline':
      return (
        <ol className="timeline read-timeline" data-hcd-block-id={block.id}>
          {block.items.map((item, i) => (
            <li className="timeline-item" key={item.id} data-hcd-block-id={item.id}>
              <div className="timeline-side">
                <span>
                  <AnchorText nodeId={item.id} field="label" value={item.label} />
                </span>
                <i className={i === 0 ? 'active' : ''} />
              </div>
              <div className="timeline-copy">
                <strong>
                  <AnchorText nodeId={item.id} field="title" value={item.title} />
                </strong>
                <p>
                  <AnchorText nodeId={item.id} field="text" value={item.text} />
                </p>
              </div>
            </li>
          ))}
        </ol>
      );
    case 'columns':
      return (
        <div
          className="columns-view read-columns"
          data-hcd-block-id={block.id}
          style={
            {
              '--column-widths': block.ratio
                .split(':')
                .map((part) => `minmax(0,${part}fr)`)
                .join(' '),
            } as CSSProperties
          }
        >
          {block.cols.map((col) => (
            <div key={col.id} data-hcd-block-id={col.id}>
              {col.blocks.map((child) => (
                <BlockRead key={child.id} block={child} locale={locale} />
              ))}
            </div>
          ))}
        </div>
      );
    case 'cards':
      return (
        <div
          className="idea-grid read-cards"
          data-hcd-block-id={block.id}
          style={{ '--card-count': block.perRow } as CSSProperties}
        >
          {block.items.map((card) => (
            <article className="idea-card" key={card.id} data-hcd-block-id={card.id}>
              <h4>
                <AnchorText nodeId={card.id} field="title" value={card.title} />
              </h4>
              {card.blocks.map((child) => (
                <BlockRead key={child.id} block={child} locale={locale} />
              ))}
            </article>
          ))}
        </div>
      );
    case 'image':
      return (
        <DocumentImage
          asset={block.asset}
          alt={block.alt}
          caption={block.caption}
          width={block.width}
          locale={locale}
          blockId={block.id}
          renderText={(field, value) => <AnchorText nodeId={block.id} field={field} value={value} />}
        />
      );
    case 'raw':
      return (
        <DocumentRaw asset={block.asset} note={block.note} height={block.height} locale={locale} blockId={block.id} />
      );
    case 'divider':
      return <hr className="doc-divider" data-hcd-block-id={block.id} />;
  }
}
