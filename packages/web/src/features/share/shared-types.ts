import type { Comment } from '../../api';
import type { Document } from '../../../../core/src/model';
export type Locale = 'zh-CN' | 'en';
export type Shared = {
  doc: {
    id: string;
    title: string;
    currentVersion?: number;
    version: number;
    role: string;
    showComments: boolean;
    aiEnabled: boolean;
    expiresAt: string | null;
  };
  content: Document;
  guest: { id: string; name: string } | null;
};
export const author = (comment?: Comment) =>
  comment?.authorName ?? (typeof comment?.author === 'object' ? comment.author.name : comment?.author) ?? '—';
export const anchorErrors = new Set([
  'ANCHOR_STALE',
  'INVALID_ANCHOR_VERSION',
  'INVALID_ANCHOR_FIELD',
  'ANCHOR_NOT_FOUND',
  'ANCHOR_QUOTE_MISMATCH',
]);
