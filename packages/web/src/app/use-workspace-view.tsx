import { useMemo } from 'react';
import { useLocation } from 'react-router';
import { threadTextAnchor } from '../comment-location';

import type { useWorkspaceSession } from './use-workspace-session';
import type { useDocumentState } from '../features/document/use-document-state';
import type { usePanelState } from './use-panel-state';
type Input = Pick<ReturnType<typeof useWorkspaceSession>, 'docs' | 'docMeta' | 'official' | 'officialVersion'> &
  Pick<
    ReturnType<typeof useDocumentState>,
    | 'commentAnchor'
    | 'focusedThread'
    | 'draftContent'
    | 'draftBaseVersion'
    | 'editing'
    | 'screen'
    | 'setActiveModule'
    | 'searchText'
  > &
  Pick<ReturnType<typeof usePanelState>, 'preview' | 'threads'>;
export function useWorkspaceView(model: Input) {
  const {
    docs,
    docMeta,
    official,
    officialVersion,
    commentAnchor,
    focusedThread,
    draftContent,
    draftBaseVersion,
    editing,
    screen,
    setActiveModule,
    searchText,
    preview,
    threads,
  } = model;
  const selectedSpaceId = /^\/spaces\/([^/]+)/.exec(useLocation().pathname)?.[1];
  const publishable = preview?.publishable ?? preview?.result?.publishable ?? false;
  const conflicts = preview?.conflicts ?? preview?.result?.conflicts ?? [];
  const unresolved = conflicts.filter((conflict) => !conflict.resolution);
  const visibleDoc = editing ? draftContent : official;
  const visibleModules = visibleDoc?.modules ?? [];
  const canEdit = Boolean(docMeta && ['owner', 'editor'].includes(docMeta.role));
  const displayedVersion =
    screen === 'history' ? (docMeta?.currentVersion ?? officialVersion) : editing ? draftBaseVersion : officialVersion;
  const selectedThread =
    focusedThread?.docId === docMeta?.id
      ? threads.find((thread) => thread.root.id === focusedThread?.threadId)
      : undefined;
  const activeTextAnchor =
    !editing && official && selectedThread ? threadTextAnchor(selectedThread, official, officialVersion) : null;
  const selectedCommentAnchor = commentAnchor?.docId === docMeta?.id ? commentAnchor?.anchor : null;
  const filteredDocs = useMemo(
    () =>
      docs.filter(
        (doc) =>
          (!selectedSpaceId || doc.spaceId === selectedSpaceId) &&
          doc.title.toLocaleLowerCase().includes(searchText.toLocaleLowerCase()),
      ),
    [docs, searchText, selectedSpaceId],
  );
  const scrollToModule = (id: string) => {
    setActiveModule(id);
    document.getElementById(`module-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };
  return {
    publishable,
    conflicts,
    unresolved,
    visibleDoc,
    visibleModules,
    canEdit,
    displayedVersion,
    selectedThread,
    activeTextAnchor,
    selectedCommentAnchor,
    filteredDocs,
    scrollToModule,
    selectedSpaceId,
  };
}
