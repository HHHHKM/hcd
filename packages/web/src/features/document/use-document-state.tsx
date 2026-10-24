import { useRef, useState } from 'react';
import type { Anchor } from '../../../../core/src/anchors';
import { useDraftHistory } from '../../use-draft-history';
import { Screen } from '../../app/workspace-helpers';
import type { useWorkspaceSession } from '../../app/use-workspace-session';
type Input = Pick<ReturnType<typeof useWorkspaceSession>, 'mobileReading' | 'docMeta'>;
export function useDocumentState(model: Input) {
  const { mobileReading, docMeta } = model;
  const [commentAnchor, setCommentAnchor] = useState<{
    docId: string;
    anchor: Anchor;
  } | null>(null);
  const [focusedThread, setFocusedThread] = useState<{
    docId: string;
    threadId: string;
  } | null>(null);
  const readingRoot = useRef<HTMLDivElement>(null);
  const composer = useRef<HTMLTextAreaElement>(null);
  const commentSending = useRef(false);
  const currentDocId = useRef<string | null>(null);
  currentDocId.current = docMeta?.id ?? null;
  const {
    content: draftContent,
    load: setDraftContent,
    change: changeDraft,
    travel: travelDraft,
    canUndo,
    canRedo,
  } = useDraftHistory();
  const [composing, setComposing] = useState(false);
  const submissionAttempt = useRef<{ fingerprint: string; key: string } | null>(null);
  const [draftBaseVersion, setDraftBaseVersion] = useState(0);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editingSession, setEditing] = useState(false);
  const editing = editingSession && !mobileReading;
  const [screen, setScreen] = useState<Screen>('documents');
  const [activeModule, setActiveModule] = useState('');
  const [searchText, setSearchText] = useState('');
  return {
    commentAnchor,
    setCommentAnchor,
    focusedThread,
    setFocusedThread,
    readingRoot,
    composer,
    commentSending,
    currentDocId,
    draftContent,
    setDraftContent,
    changeDraft,
    travelDraft,
    canUndo,
    canRedo,
    composing,
    setComposing,
    submissionAttempt,
    draftBaseVersion,
    setDraftBaseVersion,
    dirty,
    setDirty,
    saving,
    setSaving,
    editingSession,
    setEditing,
    editing,
    screen,
    setScreen,
    activeModule,
    setActiveModule,
    searchText,
    setSearchText,
  };
}
