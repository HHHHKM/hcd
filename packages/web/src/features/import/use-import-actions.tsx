import { fileBase64 } from '../../app/workspace-helpers';
import { useNavigate } from 'react-router';
import type { Document } from '../../../../core/src/model';
import { api, type DocMeta } from '../../api';
import { ImportPreview, errorText } from '../../app/workspace-helpers';
import type { useWorkspaceSession } from '../../app/use-workspace-session';
import type { usePanelState } from '../../app/use-panel-state';
import type { useActionState } from '../../app/use-action-state';
import type { useWorkspaceData } from '../../app/use-workspace-data';
import type { useDocumentNavigation } from '../document/use-document-navigation';
type Input = { locale: 'zh-CN' | 'en' } & Pick<
  ReturnType<typeof useWorkspaceSession>,
  'docMeta' | 'setBusy' | 'setError'
> &
  Pick<
    ReturnType<typeof usePanelState>,
    | 'setImportOpen'
    | 'setExportFormat'
    | 'importFile'
    | 'setImportFile'
    | 'importHtml'
    | 'setImportHtml'
    | 'importTitle'
    | 'setImportTitle'
    | 'importSpaceId'
    | 'importPreview'
    | 'setImportPreview'
  > &
  Pick<ReturnType<typeof useActionState>, 't'> &
  Pick<ReturnType<typeof useWorkspaceData>, 'refreshWorkspace'> &
  Pick<ReturnType<typeof useDocumentNavigation>, 'loadDocument'>;
export function useImportActions(model: Input) {
  const {
    setBusy,
    setError,
    docMeta,
    setImportOpen,
    setExportFormat,
    importFile,
    setImportFile,
    importHtml,
    setImportHtml,
    importTitle,
    setImportTitle,
    importSpaceId,
    importPreview,
    setImportPreview,
    t,
    refreshWorkspace,
    loadDocument,
  } = model;
  const navigate = useNavigate();
  const prepareImport = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!importFile) {
      setError(t('common.app.fileRequired'));
      return;
    }
    if (importFile.size > 30 * 1024 * 1024 || (!/\.zip$/i.test(importFile.name) && !importHtml.trim())) {
      setError(t('common.app.importTooLarge'));
      return;
    }
    if (!importSpaceId) {
      setError(t('common.app.noSpaces'));
      return;
    }
    setBusy(true);
    setError('');
    try {
      const result = /\.zip$/i.test(importFile.name)
        ? await api<{ import: ImportPreview }>('/imports/archive', {
            method: 'POST',
            body: {
              archiveBase64: await fileBase64(importFile),
              filename: importFile.name,
              spaceId: importSpaceId,
            },
          })
        : await api<{ import: ImportPreview }>('/imports', {
            method: 'POST',
            body: {
              html: importHtml,
              filename: importFile.name,
              spaceId: importSpaceId,
              title: importTitle.trim(),
            },
          });
      setImportPreview(result.import);
      navigate(`/import/${encodeURIComponent(result.import.id)}`);
      if (/\.zip$/i.test(importFile.name)) setImportTitle(result.import.content.title);
    } catch (reason) {
      setError(errorText(reason, t('common.app.unexpected'), model.locale));
    } finally {
      setBusy(false);
    }
  };
  const confirmImport = async () => {
    if (!importPreview) return;
    setBusy(true);
    setError('');
    try {
      const result = await api<{ doc: DocMeta; content: Document }>(
        `/imports/${encodeURIComponent(importPreview.id)}/confirm`,
        { method: 'POST', body: { title: importTitle.trim() } },
      );
      setImportOpen(false);
      setImportPreview(null);
      setImportFile(null);
      setImportHtml('');
      await refreshWorkspace();
      await loadDocument(result.doc.id);
    } catch (reason) {
      setError(errorText(reason, t('common.app.unexpected'), model.locale));
    } finally {
      setBusy(false);
    }
  };
  const discardImport = async () => {
    if (importPreview?.status === 'ready') {
      setBusy(true);
      try {
        await api(`/imports/${encodeURIComponent(importPreview.id)}/discard`, {
          method: 'POST',
          body: {},
        });
      } catch (reason) {
        setError(errorText(reason, t('common.app.unexpected'), model.locale));
        setBusy(false);
        return;
      }
      setBusy(false);
    }
    setImportPreview(null);
    setImportOpen(false);
    setImportFile(null);
    setImportHtml('');
    navigate(docMeta ? `/d/${encodeURIComponent(docMeta.id)}` : '/');
  };
  const exportHtml = () => {
    setExportFormat('html');
  };
  const exportZip = () => {
    setExportFormat('zip');
  };
  return { prepareImport, confirmImport, discardImport, exportHtml, exportZip };
}
