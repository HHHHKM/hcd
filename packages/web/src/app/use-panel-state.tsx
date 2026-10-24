import { useEffect, useState } from 'react';
import { type Preview, type Submission, type Thread } from '../api';
import { ImportPreview } from './workspace-helpers';

export function usePanelState() {
  const [newDocOpen, setNewDocOpen] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [newSpaceId, setNewSpaceId] = useState('');
  const [passwordResetEnabled, setPasswordResetEnabled] = useState(false);
  const [notificationPreferencesOpen, setNotificationPreferencesOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [exportFormat, setExportFormat] = useState<'html' | 'zip' | null>(null);
  const [archiveDocId, setArchiveDocId] = useState<string | null>(null);
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importHtml, setImportHtml] = useState('');
  const [importTitle, setImportTitle] = useState('');
  const [importSpaceId, setImportSpaceId] = useState('');
  const [importPreview, setImportPreview] = useState<ImportPreview | null>(null);
  const [submissions, setSubmissions] = useState<Submission[]>([]);
  const [selectedSubmissions, setSelectedSubmissions] = useState<string[]>([]);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [previewKind, setPreviewKind] = useState<'merge' | 'restore'>('merge');
  const [previewOpen, setPreviewOpen] = useState(false);
  const [manualValues, setManualValues] = useState<Record<string, string>>({});
  const [threads, setThreads] = useState<Thread[]>([]);
  const [commentsOpen, setCommentsOpen] = useState(() => {
    try {
      const saved = localStorage.getItem('hcd.discussion.open');
      return saved === null ? window.innerWidth > 980 : saved === 'true';
    } catch {
      return window.innerWidth > 980;
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem('hcd.discussion.open', String(commentsOpen));
    } catch {
      /* Storage is optional. */
    }
  }, [commentsOpen]);
  const [outlineOpen, setOutlineOpen] = useState(() => {
    try {
      return localStorage.getItem('hcd.outline.open') === 'true';
    } catch {
      return false;
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem('hcd.outline.open', String(outlineOpen));
    } catch {
      /* Storage is optional. */
    }
  }, [outlineOpen]);
  return {
    newDocOpen,
    setNewDocOpen,
    newTitle,
    setNewTitle,
    newSpaceId,
    setNewSpaceId,
    passwordResetEnabled,
    setPasswordResetEnabled,
    notificationPreferencesOpen,
    setNotificationPreferencesOpen,
    importOpen,
    setImportOpen,
    exportFormat,
    setExportFormat,
    archiveDocId,
    setArchiveDocId,
    importFile,
    setImportFile,
    importHtml,
    setImportHtml,
    importTitle,
    setImportTitle,
    importSpaceId,
    setImportSpaceId,
    importPreview,
    setImportPreview,
    submissions,
    setSubmissions,
    selectedSubmissions,
    setSelectedSubmissions,
    preview,
    setPreview,
    previewKind,
    setPreviewKind,
    previewOpen,
    setPreviewOpen,
    manualValues,
    setManualValues,
    threads,
    setThreads,
    outlineOpen,
    setOutlineOpen,
    commentsOpen,
    setCommentsOpen,
  };
}
