import type { JSONContent } from '@tiptap/core';
import type { Inline, TextRun } from '../../core/src/model';

export function inlineToEditor(inline: Inline): JSONContent {
  return {
    type: 'doc',
    content: [
      {
        type: 'paragraph',
        content: inline.map((run) => {
          if ('br' in run) return { type: 'hardBreak' };
          const marks: NonNullable<JSONContent['marks']> = [];
          const names = { b: 'bold', i: 'italic', code: 'code', sup: 'superscript', sub: 'subscript' } as const;
          for (const [field, type] of Object.entries(names)) if (run[field as keyof typeof names]) marks.push({ type });
          if (run.href) marks.push({ type: 'hcdLink', attrs: { href: run.href } });
          return { type: 'text', text: run.t, ...(marks.length ? { marks } : {}) };
        }),
      },
    ],
  };
}
export function editorToInline(doc: JSONContent): Inline {
  const runs: Inline = [];
  (doc.content ?? []).forEach((paragraph, index) => {
    if (index > 0) runs.push({ br: true });
    for (const node of paragraph.content ?? []) {
      if (node.type === 'hardBreak') {
        runs.push({ br: true });
        continue;
      }
      if (node.type !== 'text' || !node.text) continue;
      const run: TextRun = { t: node.text.replace(/[\r\n\t]/g, ' ') };
      for (const mark of node.marks ?? []) {
        if (mark.type === 'bold') run.b = true;
        if (mark.type === 'italic') run.i = true;
        if (mark.type === 'code') run.code = true;
        if (mark.type === 'superscript') run.sup = true;
        if (mark.type === 'subscript') run.sub = true;
        if (mark.type === 'hcdLink' && typeof mark.attrs?.href === 'string' && safeLink(mark.attrs.href))
          run.href = mark.attrs.href;
      }
      if (run.sup) delete run.sub;
      runs.push(run);
    }
  });
  return runs;
}
export function safeLink(value: string): boolean {
  if (/[\u0000-\u0020]/.test(value)) return false;
  try {
    return ['https:', 'http:', 'mailto:'].includes(new URL(value).protocol);
  } catch {
    return false;
  }
}
