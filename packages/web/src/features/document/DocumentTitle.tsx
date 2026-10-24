import { TextField } from '../../TextField';
import { roleLabel } from '../../app/workspace-helpers';
import { useWorkspace } from '../../app/WorkspaceContext';
export default function DocumentTitle() {
  const {
    locale,
    user,
    docMeta,
    official,
    draftContent,
    draftBaseVersion,
    editing,
    t,
    commitDraft,
    visibleDoc,
    displayedVersion,
  } = useWorkspace();
  if (!user || !docMeta || !official) return null;

  return (
    <div className="doc-title-block">
      {editing ? (
        <TextField
          className="doc-title-edit"
          label={t('common.app.editTitle')}
          value={draftContent?.title ?? ''}
          onChange={(title) => commitDraft((content) => ({ ...content, title }))}
          maxLength={200}
        />
      ) : (
        <h1>{visibleDoc?.title ?? official.title}</h1>
      )}
      <p>{t('common.app.structuredCollaborativeDocument')}</p>
      <div className="doc-meta">
        <span className="avatar avatar-coral">{user.name.slice(0, 1)}</span>
        <b>{user.name}</b>
        <span>·</span>
        <span>{roleLabel(docMeta.role, locale)}</span>
        <span className="meta-separator" />
        <span className="version-pill">
          <i />v{displayedVersion}
        </span>
        {editing && draftBaseVersion !== docMeta.currentVersion && (
          <span className="error-pill">
            {t('common.app.draftBased')}
            {draftBaseVersion}
          </span>
        )}
      </div>
    </div>
  );
}
