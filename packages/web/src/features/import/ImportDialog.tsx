import BlockRead from '../../BlockRead';
import { DocumentAssetContext } from '../../DocumentAssets';

import { Icon } from '../../app/workspace-helpers';
import { useWorkspace } from '../../app/WorkspaceContext';
export default function ImportDialog() {
  const {
    locale,
    busy,
    error,
    setError,
    spaces,
    importFile,
    setImportFile,
    importHtml,
    setImportHtml,
    importTitle,
    setImportTitle,
    importSpaceId,
    setImportSpaceId,
    importPreview,
    t,
    prepareImport,
    confirmImport,
    discardImport,
    user,
  } = useWorkspace();
  if (!user) return null;

  return (
    <div className="overlay">
      <section
        className="review-modal create-modal import-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="import-title"
      >
        <div className="modal-top">
          <div>
            <div className="modal-eyebrow">HTML → HCD</div>
            <h2 id="import-title">{t('common.app.imported')}</h2>
            <p>{t('common.app.importDescription')}</p>
          </div>
          <button className="modal-close" onClick={discardImport} disabled={busy} aria-label={t('common.app.close')}>
            <Icon name="close" />
          </button>
        </div>
        {error && (
          <div className="error-banner" role="alert">
            {error}
          </div>
        )}
        {!importPreview ? (
          <form onSubmit={prepareImport}>
            <label>
              {t('common.app.chooseFile')}
              <input
                className="file-picker"
                type="file"
                accept=".html,.htm,.zip,text/html,application/zip"
                onChange={async (event) => {
                  const file = event.target.files?.[0];
                  if (!file) return;
                  setError('');
                  setImportFile(file);
                  setImportTitle(file.name.replace(/\.(?:html?|zip)$/i, ''));
                  if (file.size > (/\.zip$/i.test(file.name) ? 30 : 2) * 1024 * 1024) {
                    setError(t('common.app.importTooLarge'));
                    setImportHtml('');
                    return;
                  }
                  setImportHtml(/\.zip$/i.test(file.name) ? '' : await file.text());
                }}
                required
              />
            </label>
            <label>
              {t('common.app.title')}
              <input value={importTitle} onChange={(event) => setImportTitle(event.target.value)} maxLength={200} />
            </label>
            <label>
              {t('common.app.spaces')}
              <select value={importSpaceId} onChange={(event) => setImportSpaceId(event.target.value)} required>
                {spaces.map((space) => (
                  <option key={space.id} value={space.id}>
                    {space.name}
                  </option>
                ))}
              </select>
            </label>
            <div className="modal-footer">
              <button type="button" className="button button-soft" onClick={discardImport}>
                {t('common.app.cancel')}
              </button>
              <button
                className="button button-primary"
                disabled={busy || !importFile || (!/\.zip$/i.test(importFile.name) && !importHtml.trim())}
              >
                {busy ? t('common.app.loading') : t('common.app.importPreview')}
              </button>
            </div>
          </form>
        ) : (
          <div className="import-report">
            <div className="import-report-heading">
              <span className="summary-check">
                <Icon name="check" size={16} />
              </span>
              <div>
                <h3>{t('common.app.importReady')}</h3>
                <p>{importPreview.filename}</p>
              </div>
            </div>
            <dl>
              <div>
                <dt>{t('common.app.removed')}</dt>
                <dd>{importPreview.report.removed}</dd>
              </div>
              <div>
                <dt>{t('common.app.importedBlocks')}</dt>
                <dd>
                  {importPreview.report.modules ?? importPreview.content.modules.length} /{' '}
                  {importPreview.report.blocks ??
                    importPreview.content.modules.reduce((count, module) => count + module.blocks.length, 0)}
                </dd>
              </div>
            </dl>
            {importPreview.report.warnings.length > 0 && (
              <div className="import-warnings">
                <strong>{t('common.app.warnings')}</strong>
                <ul>
                  {importPreview.report.warnings.map((warning, index) => (
                    <li key={index}>{warning}</li>
                  ))}
                </ul>
              </div>
            )}
            {importPreview.report.images && (
              <p className="import-image-report">
                {t('common.app.imagesImportedExternalMissingOrUnsupported', {
                  value0: importPreview.report.images.imported,
                  value1: importPreview.report.images.external,
                  value2: importPreview.report.images.missing,
                })}
              </p>
            )}
            {importPreview.report.archiveAssets !== undefined && (
              <p>
                {t('common.app.includesImages', {
                  value0: importPreview.report.archiveAssets,
                })}
              </p>
            )}
            {Boolean(importPreview.report.rawBlocks) && (
              <p>
                {t('common.app.readOnlyBlocksPreservedWithScriptsDisabled', {
                  value0: importPreview.report.rawBlocks,
                })}
              </p>
            )}
            <DocumentAssetContext.Provider
              value={{
                docId: importPreview.content.id,
                assetBase: `/api/v1/imports/${encodeURIComponent(importPreview.id)}/assets`,
              }}
            >
              <div className="import-content-preview">
                {importPreview.content.modules.map((module) => (
                  <details key={module.id}>
                    <summary>
                      <strong>{module.title}</strong>
                      <small>
                        {module.blocks.length} {t('common.app.blocks')}
                      </small>
                    </summary>
                    <div className="import-preview-blocks">
                      {module.blocks.map((block) => (
                        <BlockRead block={block} key={block.id} locale={locale} />
                      ))}
                    </div>
                  </details>
                ))}
              </div>
            </DocumentAssetContext.Provider>
            <div className="modal-footer">
              <button className="button button-soft" onClick={discardImport} disabled={busy}>
                {t('common.app.discard')}
              </button>
              <button className="button button-primary" onClick={confirmImport} disabled={busy}>
                {busy ? t('common.app.loading') : t('common.app.confirmImport')}
              </button>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
