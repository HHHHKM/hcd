import { useState } from 'react';
import { ApiError, type User } from '../../api';
import { translate } from '../../shared/i18n';
export type Locale = 'zh-CN' | 'en';

export type Role = 'owner' | 'editor' | 'commenter' | 'viewer';

export type Member = {
  id: string;
  name: string;
  email: string;
  role: Role;
  documentRole?: Role | null;
  spaceRole?: Role | null;
  inherited?: boolean;
};

export type Account = User & { disabledAt: string | null };

export const roles: Role[] = ['owner', 'editor', 'commenter', 'viewer'];

export const roleName = (role: Role, locale: Locale) => translate(locale, `admin.roles.${role}`);

export function errorMessage(error: unknown, locale: Locale) {
  const messages: Record<string, string> = {
    LAST_OWNER: 'errors.LAST_OWNER',
    LAST_ADMIN: 'errors.LAST_ADMIN',
    EMAIL_IN_USE: 'errors.EMAIL_IN_USE',
    FORBIDDEN: 'errors.FORBIDDEN',
    USER_NOT_FOUND: 'errors.USER_NOT_FOUND',
  };
  return error instanceof ApiError && messages[error.code]
    ? translate(locale, messages[error.code]!)
    : translate(locale, 'admin.theRequestFailedPleaseRetry');
}

export function ConfirmAction({
  label,
  question,
  locale,
  disabled,
  tone = 'neutral',
  onConfirm,
}: {
  label: string;
  question: string;
  locale: Locale;
  disabled?: boolean;
  tone?: 'neutral' | 'danger';
  onConfirm: () => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const buttonClass = `button button-soft${tone === 'danger' ? ' danger-action' : ''}`;
  return confirming ? (
    <span className="admin-confirm">
      <span>{question}</span>
      <button
        type="button"
        className={buttonClass}
        disabled={disabled}
        onClick={() => {
          onConfirm();
          setConfirming(false);
        }}
      >
        {translate(locale, 'admin.confirm')}
      </button>
      <button type="button" className="text-link" disabled={disabled} onClick={() => setConfirming(false)}>
        {translate(locale, 'admin.cancel')}
      </button>
    </span>
  ) : (
    <button type="button" className={buttonClass} disabled={disabled} onClick={() => setConfirming(true)}>
      {label}
    </button>
  );
}
