import { Suspense } from 'react';
import { limits } from '../../../../core/src/model';
import { Icon, editorIds } from '../../app/workspace-helpers';
import { DocumentEditor } from '../../app/lazy-panels';
import { useWorkspace } from '../../app/WorkspaceContext';
import DocumentTitle from './DocumentTitle';
import ReadingContent from './ReadingContent';
import EditDock from './EditDock';
export default function DocumentArticle() {
  const {
    locale,
    busy,
    draftContent,
    setComposing,
    draftBaseVersion,
    dirty,
    saving,
    editing,
    saveTimer,
    t,
    loadHistory,
    commitDraft,
    addModule,
    commentOnModule,
    visibleModules,
    displayedVersion,
    user,
    docMeta,
    official,
  } = useWorkspace();
  if (!user || !docMeta || !official) return null;

  return (
    <article
      className="document-page"
      onCompositionStart={() => {
        setComposing(true);
        window.clearTimeout(saveTimer.current);
      }}
      onCompositionEnd={() => setComposing(false)}
    >
      <div className="doc-kicker">
        <span className="kicker-mark">✳</span>
        <span>{t('common.app.plan')}</span>
        <i />
        <span>v{displayedVersion}</span>
        <button className="more-inline" aria-label={t('common.app.history')} onClick={loadHistory}>
          <Icon name="clock" size={17} />
        </button>
      </div>
      <DocumentTitle />
      {editing && (
        <div className="edit-mode-note">
          <span className="edit-live-dot" />
          {saving || dirty ? t('common.app.save') : t('common.app.clean')}
          <span>·</span>
          {t('common.app.draftBased')}
          {draftBaseVersion}
        </div>
      )}
      {editing && draftContent ? (
        <fieldset
          className="document-editor-fields"
          disabled={busy}
          onCompositionStart={() => {
            setComposing(true);
            window.clearTimeout(saveTimer.current);
          }}
          onCompositionEnd={() => setComposing(false)}
        >
          <Suspense fallback={<p>{t('common.app.loading')}</p>}>
            <DocumentEditor
              document={draftContent}
              locale={locale}
              ids={editorIds}
              onChange={commitDraft}
              onComment={commentOnModule}
            />
          </Suspense>
        </fieldset>
      ) : (
        <ReadingContent />
      )}
      {editing && (
        <button className="add-module" onClick={addModule} disabled={busy || visibleModules.length >= limits.modules}>
          ＋ {t('common.app.addSection')}
        </button>
      )}
      <div className="doc-end">
        <span />
        {t('common.app.endOfDocument')}
        <span />
      </div>
      {editing && <EditDock />}
    </article>
  );
}
