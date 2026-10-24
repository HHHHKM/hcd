import { useNavigate } from 'react-router';
import type { Dispatch, SetStateAction } from 'react';
import type { WorkspaceModel } from './WorkspaceContext';

/** UI actions keep modal pages and the browser history in step. */
export function useRouteActions(model: WorkspaceModel): WorkspaceModel {
  const navigate = useNavigate();
  const documentPath = model.docMeta ? `/d/${encodeURIComponent(model.docMeta.id)}` : '/';
  const panel =
    (setter: Dispatch<SetStateAction<boolean>>, current: boolean, path: string): Dispatch<SetStateAction<boolean>> =>
    (value) => {
      const next = typeof value === 'function' ? value(current) : value;
      setter(next);
      navigate(next ? path : documentPath);
    };
  return {
    ...model,
    setPreviewOpen: panel(model.setPreviewOpen, model.previewOpen, `${documentPath}/review`),
    setSettingsOpen: panel(model.setSettingsOpen, model.settingsOpen, '/settings'),
    setNotificationPreferencesOpen: panel(
      model.setNotificationPreferencesOpen,
      model.notificationPreferencesOpen,
      '/settings/notifications',
    ),
    setAdministrationOpen: panel(model.setAdministrationOpen, model.administrationOpen, '/admin/users'),
    setNewDocOpen: panel(model.setNewDocOpen, model.newDocOpen, '/new'),
    setImportOpen: panel(model.setImportOpen, model.importOpen, '/import'),
    setAiTasksOpen: panel(model.setAiTasksOpen, model.aiTasksOpen, `${documentPath}/ai-tasks`),
    setShareOpen: panel(model.setShareOpen, model.shareOpen, `${documentPath}/settings?panel=share`),
    setMembersOpen: panel(model.setMembersOpen, model.membersOpen, `${documentPath}/settings?panel=members`),
    setExportFormat: (value) => {
      const next = typeof value === 'function' ? value(model.exportFormat) : value;
      model.setExportFormat(next);
      navigate(next ? `${documentPath}/export` : documentPath);
    },
  };
}
