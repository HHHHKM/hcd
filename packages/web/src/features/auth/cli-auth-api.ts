import { api, ApiError } from '../../api';
export type Locale = 'zh-CN' | 'en';

export type Status = 'pending' | 'approved' | 'denied' | 'expired';

export type CliAuthData = {
  request: {
    code: string;
    clientName: string;
    hostname: string;
    scopes: string[];
    optionalScopes?: string[];
    expiresAt: string;
    status: Status;
  };
  documents: Array<{ id: string; title: string }>;
  user: { id: string; email: string; name: string; locale: string };
};

export type CliAuthResource =
  | { key: string; status: 'loading' }
  | { key: string; status: 'login' }
  | { key: string; status: 'error'; reason: unknown }
  | { key: string; status: 'ready'; value: CliAuthData };

export type CliAuthDecision = {
  decision: 'approve' | 'deny';
  scopes: string[];
  docIds: string[] | null;
  expiresInDays: number;
};

export const scopeText: Record<string, string> = {
  read: 'auth.cliAuthCatalog.scopeText.read',
  comment: 'auth.cliAuthCatalog.scopeText.comment',
  submit: 'auth.cliAuthCatalog.scopeText.submit',
  ai_tasks: 'auth.cliAuthCatalog.scopeText.ai_tasks',
  preview: 'auth.cliAuthCatalog.scopeText.preview',
};

const statuses: Status[] = ['pending', 'approved', 'denied', 'expired'];

export function normalizeCliAuthCode(value: string): string | null {
  const code = value.trim().toUpperCase();
  if (!/^[A-Z0-9]{4}-?[A-Z0-9]{4}$/.test(code)) return null;
  const compact = code.replace('-', '');
  return `${compact.slice(0, 4)}-${compact.slice(4)}`;
}

function validScopes(value: unknown): value is string[] {
  return (
    Array.isArray(value) &&
    value.every((scope) => typeof scope === 'string' && Object.hasOwn(scopeText, scope)) &&
    new Set(value).size === value.length
  );
}

export async function readCliAuthRequest(code: string, signal: AbortSignal): Promise<CliAuthData> {
  signal.throwIfAborted();
  const normalized = normalizeCliAuthCode(code);
  if (!normalized) throw new ApiError('INVALID_CODE', '', 400);
  const value = await api<CliAuthData>(`/cli-auth/requests/${encodeURIComponent(normalized)}`, { signal });
  signal.throwIfAborted();
  if (
    !value?.request ||
    value.request.code !== normalized ||
    !statuses.includes(value.request.status) ||
    !Number.isFinite(Date.parse(value.request.expiresAt)) ||
    typeof value.request.hostname !== 'string' ||
    typeof value.request.clientName !== 'string' ||
    !validScopes(value.request.scopes) ||
    !validScopes(value.request.optionalScopes ?? []) ||
    !Array.isArray(value.documents) ||
    value.documents.some((doc) => !doc || typeof doc.id !== 'string' || typeof doc.title !== 'string') ||
    !value.user ||
    typeof value.user.id !== 'string' ||
    typeof value.user.email !== 'string'
  )
    throw new Error('CLI_AUTH_RESPONSE_MISMATCH');
  return value;
}

export function buildCliAuthDecision(
  data: CliAuthData,
  choice: {
    decision: 'approve' | 'deny';
    confirmed: boolean;
    scopes: string[];
    allDocuments: boolean;
    selected: string[];
    days: number;
  },
): CliAuthDecision {
  if (choice.decision === 'deny')
    return { decision: 'deny', scopes: [...data.request.scopes], docIds: null, expiresInDays: 30 };
  const allowed = new Set([...data.request.scopes, ...(data.request.optionalScopes ?? [])]);
  const docs = new Set(data.documents.map((doc) => doc.id));
  if (
    !choice.confirmed ||
    !choice.scopes.length ||
    new Set(choice.scopes).size !== choice.scopes.length ||
    choice.scopes.some((scope) => !allowed.has(scope)) ||
    !Number.isInteger(choice.days) ||
    choice.days < 1 ||
    choice.days > 90 ||
    (!choice.allDocuments &&
      (!choice.selected.length ||
        choice.selected.length > 100 ||
        new Set(choice.selected).size !== choice.selected.length ||
        choice.selected.some((id) => !docs.has(id))))
  )
    throw new Error('CLI_AUTH_INVALID_CHOICE');
  return {
    decision: 'approve',
    scopes: [...choice.scopes],
    docIds: choice.allDocuments ? null : [...choice.selected],
    expiresInDays: choice.days,
  };
}

export async function sendCliAuthDecision(
  code: string,
  body: CliAuthDecision,
  signal: AbortSignal,
): Promise<{ status: 'approved' | 'denied' | 'expired' }> {
  signal.throwIfAborted();
  const normalized = normalizeCliAuthCode(code);
  if (!normalized) throw new ApiError('INVALID_CODE', '', 400);
  const result = await api<{ status: Status }>(`/cli-auth/requests/${encodeURIComponent(normalized)}`, {
    method: 'POST',
    body,
    signal,
  });
  signal.throwIfAborted();
  if (result.status !== 'expired' && result.status !== (body.decision === 'approve' ? 'approved' : 'denied'))
    throw new Error('CLI_AUTH_DECISION_MISMATCH');
  return { status: result.status as 'approved' | 'denied' | 'expired' };
}
