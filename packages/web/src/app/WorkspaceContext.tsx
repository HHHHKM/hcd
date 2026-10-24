import { useRouteActions } from './use-route-actions';
import WorkspaceRouteSync from './WorkspaceRouteSync';
import { createContext, useContext, type ReactNode } from 'react';
import { useWorkspaceController } from './use-workspace-controller';
export type WorkspaceModel = ReturnType<typeof useWorkspaceController>;
const WorkspaceContext = createContext<WorkspaceModel | null>(null);
export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const controller = useWorkspaceController();
  const value = useRouteActions(controller);
  return (
    <WorkspaceContext.Provider value={value}>
      <WorkspaceRouteSync model={controller} />
      {children}
    </WorkspaceContext.Provider>
  );
}
export function useWorkspace() {
  const context = useContext(WorkspaceContext);
  if (!context) throw new Error('WorkspaceProvider is required');
  return context;
}
