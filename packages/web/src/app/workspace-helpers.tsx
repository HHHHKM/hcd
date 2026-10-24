import { type ReactNode } from 'react';
import BlockRead from '../BlockRead';
import type { Document, Inline, Module, IdSource } from '../../../core/src/model';
import { ApiError, type PersonalToken, type Thread } from '../api';
import { translate, useLocaleTranslation, translateErrorCode } from '../shared/i18n';
export type Locale = 'zh-CN' | 'en';
export type Screen = 'documents' | 'document' | 'history';
export type ImportPreview = {
  id: string;
  status: 'ready' | 'confirmed' | 'discarded';
  filename: string;
  report: {
    removed: number;
    warnings: string[];
    modules?: number;
    blocks?: number;
    images?: { imported: number; external: number; missing: number };
    archiveAssets?: number;
    rawBlocks?: number;
  };
  content: Document;
};
export const Icon = ({ name, size = 18 }: { name: string; size?: number }) => {
  const shared = {
    width: size,
    height: size,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.7,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    'aria-hidden': true as const,
  };
  const paths: Record<string, ReactNode> = {
    search: (
      <>
        <circle cx="10.8" cy="10.8" r="6.8" />
        <path d="m16 16 4.5 4.5" />
      </>
    ),
    bell: (
      <>
        <path d="M18 9a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9" />
        <path d="M10 21h4" />
      </>
    ),
    grid: (
      <>
        <rect x="3.5" y="3.5" width="7" height="7" rx="1.4" />
        <rect x="13.5" y="3.5" width="7" height="7" rx="1.4" />
        <rect x="3.5" y="13.5" width="7" height="7" rx="1.4" />
        <rect x="13.5" y="13.5" width="7" height="7" rx="1.4" />
      </>
    ),
    clock: (
      <>
        <circle cx="12" cy="12" r="8.5" />
        <path d="M12 7v5l3 2" />
      </>
    ),
    plus: (
      <>
        <path d="M12 5v14M5 12h14" />
      </>
    ),
    chevron: <path d="m9 18 6-6-6-6" />,
    more: (
      <>
        <circle cx="5" cy="12" r=".8" fill="currentColor" />
        <circle cx="12" cy="12" r=".8" fill="currentColor" />
        <circle cx="19" cy="12" r=".8" fill="currentColor" />
      </>
    ),
    comment: (
      <>
        <path d="M20 11.5a7.5 7.5 0 0 1-7.5 7.5H6l-3 2v-9.5a7.5 7.5 0 1 1 15 0Z" />
        <path d="M8 11.5h8M8 14.5h5" />
      </>
    ),
    sun: (
      <>
        <circle cx="12" cy="12" r="4" />
        <path d="M12 2v2m0 16v2M4.9 4.9l1.4 1.4m11.4 11.4 1.4 1.4M2 12h2m16 0h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
      </>
    ),
    check: <path d="m5 12 4 4L19 6" />,
    close: (
      <>
        <path d="m6 6 12 12M18 6 6 18" />
      </>
    ),
    arrow: (
      <>
        <path d="M5 12h14M13 6l6 6-6 6" />
      </>
    ),
    list: (
      <>
        <path d="M9 6h11M9 12h11M9 18h11" />
        <path d="M4 6h.01M4 12h.01M4 18h.01" />
      </>
    ),
  };
  return <svg {...shared}>{paths[name] ?? paths.grid}</svg>;
};
export const inlineText = (inline: Inline): string => inline.map((item) => ('br' in item ? '\n' : item.t)).join('');
export const conflictText = (value: unknown): string => {
  if (
    Array.isArray(value) &&
    value.every((part) => typeof part === 'object' && part !== null && ('t' in part || 'br' in part))
  )
    return inlineText(value as Inline);
  if (value && typeof value === 'object') return JSON.stringify(value);
  return String(value ?? '');
};
export const textToInline = (value: string): Inline => {
  const result: Inline = [];
  value.split(/\r?\n/).forEach((line, index) => {
    if (index) result.push({ br: true });
    if (line) result.push({ t: line });
  });
  return result;
};
export const roleLabel = (role: string, locale: Locale) =>
  ({
    owner: translate(locale, 'common.app.roleOwner'),
    editor: translate(locale, 'common.app.roleEditor'),
    commenter: translate(locale, 'common.app.roleCommenter'),
    viewer: translate(locale, 'common.app.roleViewer'),
  })[role] ?? role;
export const authorName = (comment?: { author?: string | { name: string }; authorName?: string }) =>
  typeof comment?.author === 'string'
    ? comment.author
    : comment?.author && typeof comment.author === 'object'
      ? comment.author.name
      : (comment?.authorName ?? '—');
export const tokenScopesText = (scopes: PersonalToken['scopes']) =>
  Array.isArray(scopes) ? scopes.join(', ') : scopes;
export const makeId = (prefix: 'd' | 'm' | 'n') => {
  const alphabet = 'abcdefghijklmnopqrstuvwxyz234567';
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  return `${prefix}_${Array.from(bytes, (byte) => alphabet[byte % alphabet.length]).join('')}`;
};
export const editorIds: IdSource = { next: makeId };
export const normalizeThreads = (data: { threads?: Thread[] } | Thread[] | undefined): Thread[] =>
  Array.isArray(data) ? data : (data?.threads ?? []);
export const errorText = (error: unknown, fallback: string, locale: Locale) =>
  error instanceof ApiError ? translateErrorCode(locale, error.code, fallback) : fallback;
export function ModuleView({
  module,
  index,
  locale,
  onComment,
}: {
  module: Module;
  index: number;
  locale: Locale;
  onComment: () => void;
}) {
  const t = useLocaleTranslation(locale);
  return (
    <section className="doc-module" id={`module-${module.id}`} data-hcd-module-id={module.id}>
      <div className="module-gutter">
        <span className="module-number">{String(index + 1).padStart(2, '0')}</span>
        <span className="module-line" />
      </div>
      <div className="module-body">
        <div className="module-title-row">
          <h2>{module.title}</h2>
          <button className="module-comment" onClick={onComment} aria-label={t('common.app.commentsOpen')}>
            <Icon name="comment" size={16} />
          </button>
        </div>
        <div className="module-content">
          {module.blocks.map((block) => (
            <BlockRead block={block} key={block.id} locale={locale} />
          ))}
        </div>
      </div>
    </section>
  );
}
export const conflictKindLabel = (kind: string | undefined, locale: Locale) =>
  [
    'text_overlap',
    'field_changed',
    'target_deleted',
    'delete_modified',
    'parent_missing',
    'anchor_lost',
    'moved_elsewhere',
    'uncertain',
    'invalid_structure',
  ].includes(kind ?? '')
    ? translate(locale, `review.conflict.${kind}`)
    : translate(locale, 'common.app.conflict');

export async function fileBase64(file: File) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = '';
  for (let index = 0; index < bytes.length; index += 32768)
    binary += String.fromCharCode(...bytes.subarray(index, index + 32768));
  return btoa(binary);
}
