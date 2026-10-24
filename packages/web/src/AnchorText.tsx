import { createContext, useContext, type ReactNode } from 'react';
import { plainText, type Inline } from '../../core/src/model';
import './anchor-text.css';

export type ActiveTextAnchor = {
  blockId: string;
  field?: string;
  range: { start: number; end: number };
  quote: string;
};
export const ActiveTextAnchorContext = createContext<ActiveTextAnchor | null>(null);
type TextRange = { start: number; end: number };

function splitsSurrogate(text: string, offset: number): boolean {
  return (
    offset > 0 &&
    offset < text.length &&
    /[\uD800-\uDBFF]/.test(text[offset - 1]!) &&
    /[\uDC00-\uDFFF]/.test(text[offset]!)
  );
}

/** The core anchor offsets are UTF-16; never highlight stale or partial-character quotes. */
export function anchorHighlightRange(
  active: ActiveTextAnchor | null,
  nodeId: string,
  field: string,
  value: Inline | string,
): TextRange | null {
  if (
    !active ||
    active.blockId !== nodeId ||
    (active.field ?? 'text') !== field ||
    !active.range ||
    typeof active.quote !== 'string' ||
    !active.quote
  )
    return null;
  const { start, end } = active.range;
  const text = typeof value === 'string' ? value : plainText(value);
  if (
    !Number.isInteger(start) ||
    !Number.isInteger(end) ||
    start < 0 ||
    end <= start ||
    end > text.length ||
    splitsSurrogate(text, start) ||
    splitsSurrogate(text, end) ||
    text.slice(start, end) !== active.quote
  )
    return null;
  return { start, end };
}

function highlightedText(text: string, offset: number, range: TextRange | null): ReactNode {
  if (!range || range.end <= offset || range.start >= offset + text.length) return text;
  const start = Math.max(0, range.start - offset);
  const end = Math.min(text.length, range.end - offset);
  return (
    <>
      {text.slice(0, start)}
      <mark className="hcd-anchor-highlight" data-hcd-highlight="true">
        {text.slice(start, end)}
      </mark>
      {text.slice(end)}
    </>
  );
}

export function InlineText({
  inline,
  links = true,
  range = null,
  annotateBreaks = false,
}: {
  inline: Inline;
  links?: boolean;
  range?: TextRange | null;
  annotateBreaks?: boolean;
}) {
  let offset = 0;
  return (
    <>
      {inline.map((run, index) => {
        if ('br' in run) {
          const highlighted = range && range.start <= offset && range.end > offset;
          offset++;
          return highlighted ? (
            <mark className="hcd-anchor-highlight" data-hcd-highlight="true" key={index}>
              <br data-hcd-br={annotateBreaks ? 'true' : undefined} />
            </mark>
          ) : (
            <br key={index} data-hcd-br={annotateBreaks ? 'true' : undefined} />
          );
        }
        let content: ReactNode = highlightedText(run.t, offset, range);
        offset += run.t.length;
        if (run.code) content = <code>{content}</code>;
        if (run.b) content = <strong>{content}</strong>;
        if (run.i) content = <em>{content}</em>;
        if (run.sup) content = <sup>{content}</sup>;
        if (run.sub) content = <sub>{content}</sub>;
        if (links && run.href && /^(https?:\/\/|mailto:)/i.test(run.href) && !/[\u0000-\u0020]/.test(run.href))
          content = (
            <a href={run.href} rel="noreferrer">
              {content}
            </a>
          );
        return <span key={index}>{content}</span>;
      })}
    </>
  );
}

/** Each wrapper contains exactly one core anchorText field, excluding nested child content. */
export function AnchorText({
  nodeId,
  field,
  value,
  links = true,
}: {
  nodeId: string;
  field: string;
  value: Inline | string;
  links?: boolean;
}) {
  const active = useContext(ActiveTextAnchorContext);
  const range = anchorHighlightRange(active, nodeId, field, value);
  return (
    <span className="hcd-anchor-text" data-hcd-node-id={nodeId} data-hcd-field={field}>
      {typeof value === 'string' ? (
        highlightedText(value, 0, range)
      ) : (
        <InlineText inline={value} links={links} range={range} annotateBreaks />
      )}
    </span>
  );
}
