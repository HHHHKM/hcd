import { translate } from './shared/i18n';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { Anchor } from '../../core/src/anchors';
import type { Document } from '../../core/src/model';
import { commentSelectionFromDom, type CommentSelection, type CommentSelectionSource } from './comment-selection';
import './selection-comment.css';

type Props = {
  document: Document;
  version: number;
  disabled?: boolean;
  locale: 'zh-CN' | 'en';
  onComment: (anchor: Anchor) => void;
  children: ReactNode;
};
type Captured = { document: Document; version: number; result: CommentSelection; fingerprint: string };
const messages = {
  cross_field: 'comments.selectionCommentCatalog.messages.cross_field',
  too_long: 'comments.selectionCommentCatalog.messages.too_long',
  unsupported: 'comments.selectionCommentCatalog.messages.unsupported',
  changed: 'comments.selectionCommentCatalog.messages.changed',
  unicode: 'comments.selectionCommentCatalog.messages.unicode',
  ambiguous: 'comments.selectionCommentCatalog.messages.ambiguous',
};

export default function SelectionComment({ document, version, disabled = false, locale, onComment, children }: Props) {
  const root = useRef<HTMLDivElement>(null);
  const [captured, setCaptured] = useState<Captured | null>(null);
  const toolbar = useRef<HTMLDivElement>(null);
  const selectedRange = useRef<Range | null>(null);
  const active = !disabled && captured?.document === document && captured.version === version ? captured.result : null;
  useEffect(() => {
    setCaptured(null);
    selectedRange.current = null;
    const element = root.current;
    if (!element || disabled) return;
    const owner = element.ownerDocument;
    const capture = () => {
      const selection = owner.getSelection();
      // Tabbing to the action may collapse the platform selection. Keep its
      // captured Range while the toolbar owns focus, then validate it on click.
      if (toolbar.current?.contains(owner.activeElement) && (!selection || selection.isCollapsed)) return;
      const result = commentSelectionFromDom({ root: element, selection, document, version });
      selectedRange.current =
        result.kind === 'ready' && selection?.rangeCount === 1 ? selection.getRangeAt(0).cloneRange() : null;
      const fingerprint = JSON.stringify(result);
      setCaptured((previous) =>
        previous?.document === document && previous.version === version && previous.fingerprint === fingerprint
          ? previous
          : { document, version, result, fingerprint },
      );
    };
    // Mouse/keyboard fallbacks also cover environments that do not dispatch
    // selectionchange. Identical selections do not cause another state update.
    owner.addEventListener('selectionchange', capture);
    element.addEventListener('mouseup', capture);
    element.addEventListener('keyup', capture);
    return () => {
      owner.removeEventListener('selectionchange', capture);
      element.removeEventListener('mouseup', capture);
      element.removeEventListener('keyup', capture);
    };
  }, [document, version, disabled]);
  const comment = () => {
    const element = root.current;
    if (!element || active?.kind !== 'ready' || disabled) return;
    let selection: CommentSelectionSource | null = element.ownerDocument.getSelection();
    const range = selectedRange.current;
    if (
      (!selection || selection.isCollapsed) &&
      range &&
      toolbar.current?.contains(element.ownerDocument.activeElement)
    )
      selection = { rangeCount: 1, isCollapsed: range.collapsed, getRangeAt: () => range };
    const current = commentSelectionFromDom({ root: element, selection, document, version });
    if (current.kind !== 'ready' || JSON.stringify(current.anchor) !== JSON.stringify(active.anchor)) {
      selectedRange.current = null;
      setCaptured(null);
      return;
    }
    const anchor = { ...active.anchor };
    selectedRange.current = null;
    setCaptured(null);
    onComment(anchor);
  };

  return (
    <div className="selection-comment">
      <div ref={root} className="selection-comment-content">
        {children}
      </div>
      {active?.kind === 'ready' ? (
        <div
          ref={toolbar}
          className="selection-comment-tools"
          data-hcd-selection-ignore="true"
          onBlur={(event) => {
            if (!event.currentTarget.contains(event.relatedTarget) && elementSelectionCollapsed(root.current)) {
              selectedRange.current = null;
              setCaptured(null);
            }
          }}
        >
          <span>{translate(locale, 'comments.textSelected')}</span>
          <button
            type="button"
            className="button button-soft"
            onMouseDown={(event) => event.preventDefault()}
            onClick={comment}
          >
            {translate(locale, 'comments.commentOnSelectedText')}
          </button>
        </div>
      ) : active?.kind === 'invalid' ? (
        <p className="selection-comment-hint" role="status" data-hcd-selection-ignore="true">
          {translate(locale, messages[active.reason] ?? '')}
        </p>
      ) : null}
    </div>
  );
}

function elementSelectionCollapsed(element: HTMLElement | null) {
  return element?.ownerDocument.getSelection()?.isCollapsed !== false;
}
