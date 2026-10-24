import { useWorkspace } from '../../app/WorkspaceContext';
export default function OutlineRail() {
  const { outlineOpen, docMeta, activeModule, t, visibleModules, displayedVersion, scrollToModule, user, official } =
    useWorkspace();
  if (!user || !docMeta || !official) return null;

  return (
    <aside className={`outline-rail ${outlineOpen ? 'open' : ''}`}>
      <div className="outline-heading">
        {t('common.app.outline')}
        <span>{visibleModules.length}</span>
      </div>
      <div className="outline-items">
        {visibleModules.map((module, index) => (
          <button
            key={module.id}
            className={`outline-item ${activeModule === module.id ? 'active' : ''}`}
            onClick={() => scrollToModule(module.id)}
          >
            <span>{String(index + 1).padStart(2, '0')}</span>
            <b>{module.title}</b>
          </button>
        ))}
      </div>
      <div className="outline-bottom">
        <span>{docMeta.aiEnabled ? t('common.app.aiOn') : t('common.app.aiOff')}</span>
        <span className="outline-version">v{displayedVersion}</span>
      </div>
    </aside>
  );
}
