import { translate } from '../../shared/i18n';
import type { Module } from '../../../../core/src/model';
import BlockRead from '../../BlockRead';
import GuestVerification from '../../GuestVerification';
import { DocumentAssetContext } from '../../DocumentAssets';
import { ActiveTextAnchorContext } from '../../AnchorText';
import SelectionComment from '../../SelectionComment';
import { useSharedDocument } from './use-shared-document';
import SharedDiscussions from './SharedDiscussions';
import '../../sharing.css';
export default function SharedDocument({ token }: { token: string }) {
  return <SharedDocumentPage key={token} token={token} />;
}
function SharedDocumentPage({ token }: { token: string }) {
  const model = useSharedDocument(token);
  const {
    locale,
    setLocale,
    result,
    verification,
    setRevision,
    error,
    base,
    readingRoot,
    activeTextAnchor,
    canComment,
    busy,
    chooseAnchor,
  } = model;
  return (
    <div className="shared-document-app" lang={locale}>
      <header className="shared-header">
        <a href="/" aria-label="HCD">
          <span className="brand-mark">
            <i />
            <i />
            <i />
          </span>
          <b>
            hcd<span className="brand-period">.</span>
          </b>
        </a>
        <span>
          {result?.guest
            ? `${translate(locale, 'share.externalfce61')} · ${result.guest.name}`
            : translate(locale, 'share.sharedDocument505b3')}
        </span>
        <button className="language-button" onClick={() => setLocale(locale === 'zh-CN' ? 'en' : 'zh-CN')}>
          {translate(locale, 'share.label')}
        </button>
      </header>
      {verification ? (
        <GuestVerification token={token} locale={locale} onVerified={() => setRevision((value) => value + 1)} />
      ) : error ? (
        <main className="shared-state" role="alert">
          {error === 'invalid'
            ? translate(locale, 'share.thisShareLinkIsInvalidExpiredOrRevoked')
            : translate(locale, 'share.thisDocumentCouldNotBeLoaded')}
          <button className="text-link" onClick={() => setRevision((value) => value + 1)}>
            {translate(locale, 'share.retry')}
          </button>
        </main>
      ) : !result ? (
        <main className="shared-state" role="status">
          {translate(locale, 'share.loadingSharedDocument')}
        </main>
      ) : (
        <DocumentAssetContext.Provider value={{ docId: result.doc.id, assetBase: `/api/v1${base}/assets` }}>
          <main className="shared-page">
            <p className="shared-version">
              {translate(locale, 'share.publishedVersion')} v{result.doc.version}
              {result.doc.version !== result.doc.currentVersion ? translate(locale, 'share.pinnedVersion') : ''}
            </p>
            <h1>{result.content.title}</h1>
            <div ref={readingRoot}>
              <ActiveTextAnchorContext.Provider value={activeTextAnchor}>
                <SelectionComment
                  document={result.content}
                  version={result.doc.version}
                  disabled={!canComment || busy}
                  locale={locale}
                  onComment={chooseAnchor}
                >
                  {result.content.modules.map((module: Module, index: number) => (
                    <section className="shared-module" data-hcd-module-id={module.id} key={module.id}>
                      <span className="shared-module-index">{String(index + 1).padStart(2, '0')}</span>
                      <div>
                        <h2>{module.title}</h2>
                        {module.blocks.map((block) => (
                          <BlockRead key={block.id} block={block} locale={locale} />
                        ))}
                      </div>
                    </section>
                  ))}
                </SelectionComment>
              </ActiveTextAnchorContext.Provider>
            </div>
            {result.doc.showComments && <SharedDiscussions model={model} />}
          </main>
        </DocumentAssetContext.Provider>
      )}
    </div>
  );
}
