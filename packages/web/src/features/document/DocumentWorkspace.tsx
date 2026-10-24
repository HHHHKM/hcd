import { useLocation, useNavigate } from 'react-router';
import { Suspense } from 'react';
import { VersionComparison } from '../../app/lazy-panels';
import { useWorkspace } from '../../app/WorkspaceContext';
import OutlineRail from './OutlineRail';
import DocumentArticle from './DocumentArticle';
import DiscussionRail from '../comments/DiscussionRail';
import DocumentToolbar from '../../DocumentToolbar';
export default function DocumentWorkspace() {
  const {
    locale,
    mobileReading,
    busy,
    docMeta,
    composing,
    editing,
    screen,
    loadDocument,
    outlineOpen,
    setOutlineOpen,
    setArchiveDocId,
    submissions,
    setCommentsOpen,
    setAiTasksOpen,
    setMembersOpen,
    setShareOpen,
    t,
    goHome,
    openReview,
    loadHistory,
    exportHtml,
    exportZip,
    startEditing,
    submitChanges,
    restoreVersion,
    canEdit,
    displayedVersion,
    user,
    official,
  } = useWorkspace();
  const location = useLocation();
  const navigate = useNavigate();
  const query = new URLSearchParams(location.search);
  if (!user || !docMeta || !official) return null;

  return (
    <>
      <DocumentToolbar
        {...{
          docMeta,
          displayedVersion,
          mobileReading,
          canEdit,
          editing,
          busy,
          composing,
          screen,
          goHome,
          openReview,
          submitChanges,
          startEditing,
          exportHtml,
          exportZip,
          loadHistory,
          setCommentsOpen,
          setShareOpen,
          setAiTasksOpen,
          setMembersOpen,
          setArchiveDocId,
          locale,
        }}
        pendingCount={submissions.length}
      />
      <button
        className="outline-toggle button button-soft"
        aria-expanded={outlineOpen}
        onClick={() => setOutlineOpen((value) => !value)}
      >
        {t('common.app.outline')}
      </button>
      {mobileReading && canEdit && (
        <p className="mobile-reading-note" role="note">
          {t('common.app.useAComputerToEditAndPublish')}
        </p>
      )}
      {screen === 'history' ? (
        <Suspense fallback={<p role="status">{t('common.app.loading')}</p>}>
          <VersionComparison
            key={docMeta.id}
            docId={docMeta.id}
            currentVersion={docMeta.currentVersion}
            locale={locale}
            initialFrom={query.has('from') ? Number(query.get('from')) : undefined}
            initialTo={query.has('to') ? Number(query.get('to')) : undefined}
            onPairChange={({ from, to }) =>
              navigate(`/d/${encodeURIComponent(docMeta.id)}/compare?from=${from}&to=${to}`)
            }
            onReadVersion={(version) => navigate(`/d/${encodeURIComponent(docMeta.id)}?v=${version}`)}
            canRestore={docMeta.role === 'owner' && !mobileReading}
            busy={busy}
            onBack={() => void loadDocument(docMeta.id)}
            onRestore={restoreVersion}
          />
        </Suspense>
      ) : (
        <div className={`document-grid ${outlineOpen ? 'outline-open' : ''}`}>
          <OutlineRail />
          <DocumentArticle />
          <DiscussionRail />
        </div>
      )}
    </>
  );
}
