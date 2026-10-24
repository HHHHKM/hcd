import { useEffect, useRef } from 'react';
import { useLocation } from 'react-router';
import { api, type Preview, type VersionSnapshot } from '../api';
import { type ImportPreview, errorText } from './workspace-helpers';
import type { WorkspaceModel } from './WorkspaceContext';

/** Rehydrates pages from a real browser location, including popstate and refresh. */
export default function WorkspaceRouteSync({ model }: { model: WorkspaceModel }) {
  const location = useLocation();
  const latest = useRef(model);
  latest.current = model;
  const applied = useRef('');
  const located = useRef('');
  const versionRead = useRef({ key: '', pending: false });
  useEffect(() => {
    const m = latest.current;
    if (!m.user) {
      applied.current = '';
      return;
    }
    const match = /^\/d\/([^/]+)(?:\/(.*))?\/?$/.exec(location.pathname);
    const id = match?.[1];
    if (id && m.docMeta?.id !== id) {
      if (m.loadingDocumentId.current !== id) void m.loadDocument(id, true, false);
      return;
    }
    const key = location.pathname + location.search + ':' + (m.docMeta?.id ?? '');
    if (applied.current === key) return;
    applied.current = key;
    m.setSettingsOpen(false);
    m.setNotificationPreferencesOpen(false);
    m.setPreviewOpen(false);
    m.setAiTasksOpen(false);
    m.setMembersOpen(false);
    m.setShareOpen(false);
    m.setAdministrationOpen(false);
    m.setNewDocOpen(false);
    m.setImportOpen(false);
    m.setExportFormat(null);
    const controller = new AbortController();
    versionRead.current = { key, pending: false };
    const section = match?.[2] ?? '';
    if (id) {
      m.setScreen(section === 'history' || section === 'compare' ? 'history' : 'document');
      if (section.startsWith('review')) {
        const previewId = section.split('/')[1];
        if (previewId && m.preview?.id === previewId) m.setPreviewOpen(true);
        else
          void m
            .openReview(false)
            .then(async () => {
              if (previewId && !controller.signal.aborted) {
                const result = await api<{ preview: Preview }>(`/previews/${encodeURIComponent(previewId)}`, {
                  signal: controller.signal,
                });
                if (!controller.signal.aborted) {
                  latest.current.setPreviewKind(result.preview.kind === 'restore' ? 'restore' : 'merge');
                  latest.current.setPreview(result.preview);
                  latest.current.setPreviewOpen(true);
                }
              }
            })
            .catch(() => undefined);
      } else if (section === 'settings') {
        const panel = new URLSearchParams(location.search).get('panel');
        if (panel === 'share') m.setShareOpen(true);
        else if (panel === 'members') m.setMembersOpen(true);
        else void m.openSettings(false);
      } else if (section === 'ai-tasks') m.setAiTasksOpen(true);
      else if (section === 'export') m.setExportFormat('html');
      if (new URLSearchParams(location.search).get('edit') !== '1') m.setEditing(false);
      const version = new URLSearchParams(location.search).get('v');
      if (version && /^\d+$/.test(version)) {
        versionRead.current = { key, pending: true };
        void api<{ version: VersionSnapshot }>(`/docs/${encodeURIComponent(id)}/versions/${version}`, {
          signal: controller.signal,
        })
          .then((result) => {
            if (!controller.signal.aborted) {
              versionRead.current.pending = false;
              latest.current.setOfficial(result.version.content);
              latest.current.setOfficialVersion(result.version.number);
              latest.current.setEditing(false);
            }
          })
          .catch(() => undefined);
      } else if (!section && m.officialVersion !== m.docMeta?.currentVersion) void m.loadDocument(id, true, false);
      if (new URLSearchParams(location.search).get('edit') === '1' && !m.mobileReading && m.canEdit)
        m.startEditing(false);
    } else if (location.pathname.startsWith('/settings')) {
      if (location.pathname === '/settings/notifications') m.setNotificationPreferencesOpen(true);
      else void m.openSettings(false);
    } else if (location.pathname.startsWith('/admin/')) m.setAdministrationOpen(true);
    else if (location.pathname === '/new') m.setNewDocOpen(true);
    else if (location.pathname.startsWith('/import')) {
      m.setImportOpen(true);
      const importId = /^\/import\/([^/]+)$/.exec(location.pathname)?.[1];
      if (importId && m.importPreview?.id !== importId) {
        void api<{ import: ImportPreview }>(`/imports/${encodeURIComponent(importId)}`, { signal: controller.signal })
          .then((result) => {
            if (!controller.signal.aborted) {
              latest.current.setImportPreview(result.import);
              latest.current.setImportTitle(result.import.content.title);
            }
          })
          .catch((reason) => {
            if (!controller.signal.aborted)
              latest.current.setError(errorText(reason, m.t('common.app.unexpected'), m.locale));
          });
      }
    } else if (location.pathname.startsWith('/spaces/')) {
      m.cancelDocumentRequest();
      void m.goHome(false);
      m.setAdministrationOpen(location.pathname.endsWith('/settings'));
    } else if (location.pathname === '/') {
      m.cancelDocumentRequest();
      void m.goHome(false);
    }
    return () => {
      controller.abort();
      if (section.startsWith('review')) m.cancelDocumentRequest();
    };
  }, [location.pathname, location.search, model.user?.id, model.docMeta?.id]);
  useEffect(() => {
    const m = latest.current;
    const match = /^#comment-(.+)$/.exec(location.hash);
    const version = new URLSearchParams(location.search).get('v');
    if (
      !match ||
      !m.official ||
      !m.docMeta ||
      m.editing ||
      m.loadingDocumentId.current ||
      versionRead.current.pending ||
      (version && m.officialVersion !== Number(version))
    ) {
      located.current = '';
      return;
    }
    const key = location.pathname + location.search + location.hash;
    if (located.current === key) return;
    const thread = m.threads.find((item) => item.root.id === decodeURIComponent(match[1]!));
    if (!thread) return;
    located.current = key;
    m.setCommentsOpen(true);
    requestAnimationFrame(() => {
      latest.current.locateComment(thread);
      latest.current.setCommentsOpen(true);
    });
  }, [
    location.pathname,
    location.search,
    location.hash,
    model.docMeta?.id,
    model.threads,
    model.official,
    model.officialVersion,
    model.editing,
  ]);
  return null;
}
