import { Suspense } from 'react';
import { useLocation, useNavigate } from 'react-router';
import ImportArchive from '../ImportArchive';
import { DocumentAssetContext } from '../DocumentAssets';
import { Icon } from './workspace-helpers';
import {
  NotificationPreferences,
  SubmissionDetails,
  AiTasks,
  ExportPanel,
  ShareLinks,
  Administration,
  DocumentMembers,
} from './lazy-panels';
import { useWorkspace } from './WorkspaceContext';
import AuthScreen from './AuthScreen';
import Topbar from './Topbar';
import Sidebar from './Sidebar';
import DocumentsHome from '../features/document/DocumentsHome';
import DocumentWorkspace from '../features/document/DocumentWorkspace';
import ReviewDialog from '../features/review/ReviewDialog';
import NewDocumentDialog from '../features/document/NewDocumentDialog';
import ImportDialog from '../features/import/ImportDialog';
import SettingsDialog from '../features/settings/SettingsDialog';
export default function WorkspaceShell() {
  const {
    locale,
    dark,
    user,
    busy,
    error,
    setError,
    spaces,
    docMeta,
    official,
    screen,
    newDocOpen,
    notificationPreferencesOpen,
    setNotificationPreferencesOpen,
    importOpen,
    exportFormat,
    setExportFormat,
    archiveDocId,
    setArchiveDocId,
    previewOpen,
    submissionDetailsId,
    setSubmissionDetailsId,
    aiTasksOpen,
    setAiTasksOpen,
    settingsOpen,
    administrationOpen,
    setAdministrationOpen,
    membersOpen,
    setMembersOpen,
    shareOpen,
    setShareOpen,
    toast,
    setToast,
    t,
    membershipUpdated,
    openReview,
  } = useWorkspace();
  const location = useLocation();
  const navigate = useNavigate();
  const spaceSettingsId = /^\/spaces\/([^/]+)\/settings$/.exec(location.pathname)?.[1];
  if (!user) return <AuthScreen />;
  return (
    <DocumentAssetContext.Provider value={docMeta ? { docId: docMeta.id } : null}>
      <div className={`app ${dark ? 'dark' : ''}`}>
        <Topbar />
        <div className="app-frame">
          <Sidebar />
          <main className="main-area">
            {error && (
              <div className="error-banner global-error" role="alert">
                <span>{error}</span>
                <button onClick={() => setError('')} aria-label={t('common.app.close')}>
                  <Icon name="close" size={15} />
                </button>
              </div>
            )}
            {busy && !docMeta && screen !== 'documents' ? (
              <div className="loading-view">{t('common.app.loading')}</div>
            ) : null}
            {screen === 'documents' && <DocumentsHome />}
            {(screen === 'document' || screen === 'history') && docMeta && official && <DocumentWorkspace />}
          </main>
        </div>
        <Suspense
          fallback={
            <div className="toast" role="status">
              {t('common.app.loading')}
            </div>
          }
        >
          {aiTasksOpen && docMeta && official && (
            <AiTasks
              key={docMeta.id}
              docId={docMeta.id}
              userId={user.id}
              role={docMeta.role}
              modules={official.modules}
              locale={locale}
              aiEnabled={docMeta.aiEnabled}
              onSubmission={(id) => {
                setAiTasksOpen(false);
                setSubmissionDetailsId(id);
              }}
              onClose={() => setAiTasksOpen(false)}
              onReview={openReview}
            />
          )}
          {shareOpen && docMeta && docMeta.role === 'owner' && (
            <ShareLinks
              docId={docMeta.id}
              locale={locale}
              currentVersion={docMeta.currentVersion}
              onClose={() => setShareOpen(false)}
            />
          )}
          {administrationOpen && (
            <Administration
              key={spaceSettingsId ?? 'accounts'}
              initialSpaceId={spaceSettingsId}
              initialTab={spaceSettingsId ? 'spaces' : undefined}
              onSpaceChange={
                spaceSettingsId ? (id) => navigate(`/spaces/${encodeURIComponent(id)}/settings`) : undefined
              }
              user={user}
              spaces={spaces}
              locale={locale}
              onClose={() => setAdministrationOpen(false)}
              onUpdated={membershipUpdated}
            />
          )}
          {membersOpen && docMeta && (
            <DocumentMembers
              id={docMeta.id}
              locale={locale}
              editable={docMeta.role === 'owner'}
              onClose={() => setMembersOpen(false)}
              onUpdated={membershipUpdated}
            />
          )}
        </Suspense>
        {archiveDocId && <ImportArchive docId={archiveDocId} locale={locale} onClose={() => setArchiveDocId(null)} />}
        {newDocOpen && <NewDocumentDialog />}
        {previewOpen && <ReviewDialog />}
        {importOpen && <ImportDialog />}
        {exportFormat && docMeta && user && (
          <Suspense fallback={null}>
            <ExportPanel
              key={docMeta.id}
              userId={user.id}
              docId={docMeta.id}
              version={docMeta.currentVersion}
              canViewPending={docMeta.role !== 'viewer'}
              locale={locale}
              initialFormat={exportFormat}
              onClose={() => setExportFormat(null)}
            />
          </Suspense>
        )}
        {notificationPreferencesOpen && (
          <Suspense fallback={<p role="status">{t('common.app.loading')}</p>}>
            <NotificationPreferences locale={locale} onClose={() => setNotificationPreferencesOpen(false)} />
          </Suspense>
        )}
        {settingsOpen && <SettingsDialog />}
        {submissionDetailsId && (
          <Suspense fallback={<p role="status">{t('common.app.loading')}</p>}>
            <SubmissionDetails
              key={submissionDetailsId}
              id={submissionDetailsId}
              locale={locale}
              onClose={() => setSubmissionDetailsId(null)}
            />
          </Suspense>
        )}
        {toast && (
          <div className="toast" role="status">
            <span>
              <Icon name="check" size={16} />
            </span>
            {toast}
            <button onClick={() => setToast('')} aria-label={t('common.app.close')}>
              <Icon name="close" size={14} />
            </button>
          </div>
        )}
      </div>
    </DocumentAssetContext.Provider>
  );
}
