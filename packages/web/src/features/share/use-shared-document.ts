import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import type { Anchor } from '../../../../core/src/anchors';
import { api, ApiError, type Thread } from '../../api';
import { findCommentTarget, threadTextAnchor } from '../../comment-location';
import { anchorErrors, type Locale, type Shared } from './shared-types';
export function useSharedDocument(token: string) {
  const [locale, setLocale] = useState<Locale>(() =>
    navigator.language.toLowerCase().startsWith('zh') ? 'zh-CN' : 'en',
  );
  const [result, setResult] = useState<Shared | null>(null);
  const [threads, setThreads] = useState<Thread[]>([]);
  const [error, setError] = useState('');
  const [verification, setVerification] = useState(false);
  const [revision, setRevision] = useState(0);
  const [body, setBody] = useState('');
  const [moduleId, setModuleId] = useState('');
  const [parentId, setParentId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [discussionError, setDiscussionError] = useState('');
  const [notice, setNotice] = useState(false);
  const [selectedAnchor, setSelectedAnchor] = useState<Anchor | null>(null);
  const [focusedThreadId, setFocusedThreadId] = useState<string | null>(null);
  const [locationError, setLocationError] = useState(false);
  const readingRoot = useRef<HTMLDivElement>(null);
  const composer = useRef<HTMLTextAreaElement>(null);
  const sending = useRef(false);
  const mounted = useRef(true);
  const commentsRequest = useRef(0);
  const base = `/s/${encodeURIComponent(token)}`;
  const canComment = Boolean(result?.guest && result.doc.role === 'commenter' && result.doc.showComments);
  const focusedThread = threads.find((thread) => thread.root.id === focusedThreadId);
  const activeTextAnchor =
    result && focusedThread ? threadTextAnchor(focusedThread, result.content, result.doc.version) : null;
  const visibleThreadAnchor = (thread: Thread) =>
    result ? threadTextAnchor(thread, result.content, result.doc.version) : null;
  // A slow initial read must never overwrite the discussion returned after a post.
  const readComments = useCallback(
    async (failure: 'load' | 'refresh', active: () => boolean = () => true) => {
      const request = ++commentsRequest.current;
      const current = () => mounted.current && active() && request === commentsRequest.current;
      try {
        const response = await api<{ threads: Thread[] }>(`${base}/comments`);
        if (current()) {
          setThreads(response.threads);
          setDiscussionError('');
        }
      } catch {
        if (current()) setDiscussionError(failure);
      }
    },
    [base],
  );
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(() => {
    let active = true;
    commentsRequest.current++;
    setError('');
    setVerification(false);
    setResult(null);
    setThreads([]);
    setParentId(null);
    setNotice(false);
    setDiscussionError('');
    setSelectedAnchor(null);
    setFocusedThreadId(null);
    setLocationError(false);
    api<Shared>(`${base}/doc`)
      .then(async (shared) => {
        if (!active) return;
        setResult(shared);
        document.title = `${shared.content.title} · HCD`;
        setModuleId((current) => (shared.content.modules.some((module) => module.id === current) ? current : ''));
        if (shared.doc.showComments) await readComments('load', () => active);
      })
      .catch((reason) => {
        if (!active) return;
        if (reason instanceof ApiError && reason.code === 'GUEST_VERIFICATION_REQUIRED') setVerification(true);
        else setError(reason instanceof ApiError && reason.status === 404 ? 'invalid' : 'failed');
      });
    return () => {
      active = false;
    };
  }, [base, revision, readComments]);
  const clearLocation = () => {
    setFocusedThreadId(null);
    setLocationError(false);
    readingRoot.current
      ?.querySelectorAll('[data-hcd-location-active]')
      .forEach((node) => node.removeAttribute('data-hcd-location-active'));
  };
  const chooseAnchor = (anchor: Anchor) => {
    if (!canComment || busy || !result || anchor.version !== result.doc.version) return;
    clearLocation();
    setSelectedAnchor(anchor);
    setModuleId(anchor.moduleId ?? '');
    setParentId(null);
    setDiscussionError('');
    setNotice(false);
    requestAnimationFrame(() => {
      composer.current?.focus();
      composer.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
  };
  const locateComment = (thread: Thread) => {
    clearLocation();
    if (
      !result ||
      !readingRoot.current ||
      !thread.root.anchor ||
      thread.root.deletedAt ||
      thread.anchorState === 'lost'
    )
      return;
    const exact = threadTextAnchor(thread, result.content, result.doc.version);
    const target = findCommentTarget(readingRoot.current, thread.root.anchor, Boolean(exact));
    if (!target) {
      setLocationError(true);
      return;
    }
    setFocusedThreadId(thread.root.id);
    for (let parent = target.parentElement; parent && parent !== readingRoot.current; parent = parent.parentElement)
      if (parent.tagName === 'DETAILS') (parent as HTMLDetailsElement).open = true;
    target.dataset.hcdLocationActive = 'true';
    target.tabIndex = -1;
    target.focus({ preventScroll: true });
    target.scrollIntoView({ behavior: 'smooth', block: 'center' });
  };
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!canComment || !result || !body.trim() || sending.current) return;
    sending.current = true;
    commentsRequest.current++;
    setBusy(true);
    setDiscussionError('');
    setNotice(false);
    let sent = false;
    try {
      const anchor = selectedAnchor ?? (moduleId ? { moduleId, version: result.doc.version } : {});
      const response = await api<{ aiTask?: unknown }>(`${base}/comments`, {
        method: 'POST',
        body: { body: body.trim(), ...(parentId ? { parentId } : { anchor }) },
      });
      sent = true;
      if (!mounted.current) return;
      setBody('');
      setParentId(null);
      setSelectedAnchor(null);
      setNotice(Boolean(response.aiTask));
      await readComments('refresh');
    } catch (reason) {
      if (!mounted.current) return;
      if (sent) setDiscussionError('refresh');
      else if (reason instanceof ApiError && reason.code === 'GUEST_VERIFICATION_REQUIRED') {
        setResult(null);
        setVerification(true);
        setSelectedAnchor(null);
        clearLocation();
      } else if (reason instanceof ApiError && reason.code === 'INVITE_INVALID') {
        setResult(null);
        setError('invalid');
        setSelectedAnchor(null);
        clearLocation();
      } else setDiscussionError(reason instanceof ApiError && anchorErrors.has(reason.code) ? 'anchor' : 'send');
    } finally {
      sending.current = false;
      if (mounted.current) setBusy(false);
    }
  };
  return {
    locale,
    setLocale,
    result,
    threads,
    error,
    verification,
    setRevision,
    body,
    setBody,
    moduleId,
    setModuleId,
    parentId,
    setParentId,
    busy,
    discussionError,
    setDiscussionError,
    notice,
    selectedAnchor,
    setSelectedAnchor,
    locationError,
    readingRoot,
    composer,
    base,
    canComment,
    activeTextAnchor,
    visibleThreadAnchor,
    clearLocation,
    chooseAnchor,
    locateComment,
    submit,
  };
}
export type SharedDocumentModel = ReturnType<typeof useSharedDocument>;
