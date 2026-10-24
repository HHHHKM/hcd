import SelectionComment from '../../SelectionComment';
import { ActiveTextAnchorContext } from '../../AnchorText';
import { ModuleView } from '../../app/workspace-helpers';
import { useWorkspace } from '../../app/WorkspaceContext';
export default function ReadingContent() {
  const {
    locale,
    busy,
    docMeta,
    official,
    officialVersion,
    readingRoot,
    selectCommentAnchor,
    commentOnModule,
    visibleModules,
    activeTextAnchor,
    user,
  } = useWorkspace();
  if (!user || !docMeta || !official) return null;

  return (
    <div ref={readingRoot}>
      <ActiveTextAnchorContext.Provider value={activeTextAnchor}>
        <SelectionComment
          document={official}
          version={officialVersion}
          disabled={busy || docMeta.role === 'viewer'}
          locale={locale}
          onComment={selectCommentAnchor}
        >
          <div className="doc-modules">
            {visibleModules.map((module, index) => (
              <ModuleView
                key={module.id}
                module={module}
                index={index}
                locale={locale}
                onComment={() => commentOnModule(module.id)}
              />
            ))}
          </div>
        </SelectionComment>
      </ActiveTextAnchorContext.Provider>
    </div>
  );
}
