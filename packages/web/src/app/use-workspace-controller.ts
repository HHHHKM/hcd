import { useWorkspaceSession } from './use-workspace-session';
import { useDocumentState } from '../features/document/use-document-state';
import { usePanelState } from './use-panel-state';
import { useActionState } from './use-action-state';
import { useWorkspaceData } from './use-workspace-data';
import { useDocumentNavigation } from '../features/document/use-document-navigation';
import { useSettingsActions } from '../features/settings/use-settings-actions';
import { useImportActions } from '../features/import/use-import-actions';
import { useDraftActions } from '../features/document/use-draft-actions';
import { useReviewPolling } from '../features/review/use-review-polling';
import { useCommentActions } from '../features/comments/use-comment-actions';
import { useReviewActions } from '../features/review/use-review-actions';
import { useWorkspaceView } from './use-workspace-view';
export function useWorkspaceController() {
  const model0 = useWorkspaceSession();
  const model1 = { ...model0, ...useDocumentState(model0) };
  const model2 = { ...model1, ...usePanelState() };
  const model3 = { ...model2, ...useActionState(model2) };
  const model4 = { ...model3, ...useWorkspaceData(model3) };
  const model5 = { ...model4, ...useDocumentNavigation(model4) };
  const model6 = { ...model5, ...useSettingsActions(model5) };
  const model7 = { ...model6, ...useImportActions(model6) };
  const model8 = { ...model7, ...useDraftActions(model7) };
  const model9 = { ...model8, ...useReviewPolling(model8) };
  const model10 = { ...model9, ...useCommentActions(model9) };
  const model11 = { ...model10, ...useReviewActions(model10) };
  const model12 = { ...model11, ...useWorkspaceView(model11) };
  return model12;
}
