import type { Document } from '../../core/src/model';
import type { Anchor } from '../../core/src/anchors';
import { anchorText } from '../../core/src/anchors';
import { locate } from '../../core/src/ops';
import type { Thread } from './api';

/** Stored offsets apply only to the official snapshot they describe. */
export function threadTextAnchor(thread: Thread, document: Document, version: number) {
  const anchor = thread.root.anchor;
  const range = thread.range;
  if (
    thread.root.deletedAt ||
    thread.anchorState !== 'ok' ||
    !anchor?.blockId ||
    !anchor.quote ||
    !range ||
    anchor.version !== version
  )
    return null;
  const module = document.modules.find((item) => item.id === anchor.moduleId);
  if (!module) return null;
  const node = locate({ ...document, modules: [module] }, anchor.blockId)?.value;
  if (!node) return null;
  const text = anchorText(node, anchor.field ?? 'text');
  if (
    text === undefined ||
    !Number.isInteger(range.start) ||
    !Number.isInteger(range.end) ||
    range.start < 0 ||
    range.end <= range.start ||
    range.end > text.length ||
    text.slice(range.start, range.end) !== anchor.quote
  )
    return null;
  return { blockId: anchor.blockId, field: anchor.field ?? 'text', quote: anchor.quote, range };
}

/** Restrict navigation to the displayed document, without interpolating IDs as CSS. */
export function findCommentTarget(root: HTMLElement, anchor: Anchor, field = true): HTMLElement | null {
  const module = Array.from(root.querySelectorAll<HTMLElement>('[data-hcd-module-id]')).find(
    (item) => item.dataset.hcdModuleId === anchor.moduleId,
  );
  if (!module) return null;
  if (anchor.blockId) {
    if (field) {
      const target = Array.from(module.querySelectorAll<HTMLElement>('[data-hcd-node-id][data-hcd-field]')).find(
        (item) => item.dataset.hcdNodeId === anchor.blockId && item.dataset.hcdField === (anchor.field ?? 'text'),
      );
      if (target) return target;
    }
    const block = Array.from(module.querySelectorAll<HTMLElement>('[data-hcd-block-id]')).find(
      (item) => item.dataset.hcdBlockId === anchor.blockId,
    );
    if (block) return block;
  }
  return module;
}
