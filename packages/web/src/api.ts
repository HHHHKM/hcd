import type { ChangeSet } from '../../core/src/changes';
import type { ReviewPresentation } from '../../core/src/review-types';
import type { Document } from '../../core/src/model';
import type { Anchor, AnchorState } from '../../core/src/anchors';

export type User = { id: string; name: string; email: string; locale: string; isAdmin?: boolean };
export type Space = { id: string; name: string; role?: string };
export type DocMeta = {
  id: string;
  title: string;
  currentVersion: number;
  aiEnabled: boolean;
  role: string;
  spaceId?: string;
  updatedAt?: string;
};
export type Draft = { baseVersion: number; content: Document; updatedAt?: string };
export type Submission = {
  changeSet?: ChangeSet;
  id: string;
  authorId: string;
  authorName?: string;
  message: string;
  status: string;
  baseVersion: number;
  createdAt: string;
  content?: Document;
  author?: string | { name: string };
  opCount?: number;
  via?: string;
};
export type Comment = {
  submissionId?: string;
  external?: boolean;
  id: string;
  body: string;
  authorId: string;
  authorName?: string;
  createdAt: string;
  anchor?: Anchor;
  anchorState?: AnchorState;
  range?: { start: number; end: number };
  parentId?: string;
  status?: string;
  deletedAt?: string | null;
  editedAt?: string | null;
  author?: string | { name: string };
};
export type Thread = {
  root: Comment;
  replies: Comment[];
  anchorState?: AnchorState;
  range?: { start: number; end: number };
};
export type Conflict = {
  id: string;
  kind?: string;
  targetId?: string;
  moduleId?: string;
  blockId?: string;
  field?: string;
  base?: unknown;
  current?: unknown;
  incoming?: unknown;
  allowed?: string[];
  submissionId?: string;
  opIndex?: number;
  resolution?: unknown;
};
export type Preview = {
  presentation?: ReviewPresentation | null;
  items?: Array<{
    submissionId: string;
    status: string;
    ops?: Array<{ index: number; outcome: string; note?: string }>;
  }>;
  id: string;
  kind?: string;
  revision: number;
  baseVersion: number;
  status: string;
  publishable?: boolean;
  conflicts: Conflict[];
  candidate?: Document;
  result?: { conflicts?: Conflict[]; publishable?: boolean; changes?: unknown[] };
  resolutions?: Record<string, unknown>;
  submissionIds?: string[];
  submissions?: Submission[];
};
export type Version = {
  version: number;
  createdAt?: string;
  created_at?: string;
  createdBy?: string;
  created_by?: string;
  kind?: string;
  authorName?: string | null;
};
export type VersionComparisonResponse = { from: number; to: number; changeSet?: ChangeSet };
export type VersionSnapshot = {
  number: number;
  kind: string;
  content: Document;
  createdBy: string;
  authorName?: string | null;
  createdAt: string;
};
export type PersonalToken = {
  kind?: 'pat' | 'oauth';
  doc_ids?: string | null;
  expires_at?: string | null;
  id: string;
  name: string;
  scopes: string[] | string;
  created_at: string;
  revoked_at?: string | null;
  last_used_at?: string | null;
  last_used_ip?: string | null;
};

export class ApiError extends Error {
  constructor(
    public code: string,
    message: string,
    public status: number,
  ) {
    super(message);
  }
}
export async function api<T>(
  path: string,
  options: { method?: string; body?: unknown; idempotencyKey?: string; signal?: AbortSignal } = {},
): Promise<T> {
  const method = options.method ?? 'GET';
  const response = await fetch(`/api/v1${path}`, {
    method,
    signal: options.signal,
    credentials: 'same-origin',
    headers: {
      ...(options.body === undefined ? {} : { 'Content-Type': 'application/json' }),
      ...(method === 'GET' ? {} : { 'X-HCD-Request': '1' }),
      ...(options.idempotencyKey ? { 'Idempotency-Key': options.idempotencyKey } : {}),
    },
    ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
  });
  if (response.status === 204) return undefined as T;
  const result = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (!response.ok) {
    const error = result.error as { code?: string; message?: string } | undefined;
    throw new ApiError(
      error?.code ?? String(result.code ?? 'REQUEST_FAILED'),
      error?.message ?? String(result.message ?? response.statusText),
      response.status,
    );
  }
  return result as T;
}
export const unwrapList = <T>(result: T[] | Record<string, unknown>, key: string): T[] =>
  Array.isArray(result) ? result : ((result[key] as T[]) ?? []);
export const plainValue = (value: unknown): string => {
  if (typeof value === 'string') return value;
  if (Array.isArray(value) && value.every((item) => item && typeof item === 'object' && ('t' in item || 'br' in item)))
    return value.map((item: { t?: string; br?: boolean }) => (item.br ? '\n' : (item.t ?? ''))).join('');
  return JSON.stringify(value, null, 2) ?? '';
};
