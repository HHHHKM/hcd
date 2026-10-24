import { useState } from 'react';
import { api } from '../../api';
import { useLocaleTranslation } from '../../shared/i18n';

export default function MentionPicker({
  docId,
  locale,
  aiEnabled,
  onSelect,
}: {
  docId: string;
  locale: 'en' | 'zh-CN';
  aiEnabled: boolean;
  onSelect: (mention: string) => void;
}) {
  const t = useLocaleTranslation(locale);
  const [members, setMembers] = useState<Array<{ id: string; name: string }>>([]);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState(false);
  const choose = (id: string, name: string) => {
    onSelect(`@[${name.replace(/[\[\]\n]/g, ' ').slice(0, 100)}](${id}) `);
    setOpen(false);
  };
  return (
    <div className="mention-picker">
      <button
        type="button"
        className="text-link"
        aria-expanded={open}
        onClick={async () => {
          setOpen(!open);
          if (!open) {
            try {
              const result = await api<{
                members: Array<{ id: string; name: string }>;
              }>(`/docs/${encodeURIComponent(docId)}/members`);
              setMembers(result.members);
              setError(false);
            } catch {
              setError(true);
            }
          }
        }}
      >
        {t('comments.mention')}
      </button>
      {open && (
        <div className="mention-options">
          {error && <span role="alert">{t('comments.memberLoadError')}</span>}
          {aiEnabled && (
            <button type="button" onClick={() => choose('ai', 'AI')}>
              <span className="mention-avatar" aria-hidden="true">
                AI
              </span>
              <span className="mention-name">@AI</span>
            </button>
          )}
          {members.map((member) => (
            <button type="button" key={member.id} onClick={() => choose(member.id, member.name)}>
              <span className="mention-avatar" aria-hidden="true">
                {Array.from(member.name.trim())[0] ?? '?'}
              </span>
              <span className="mention-name">{member.name}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
