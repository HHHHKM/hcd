import { BrowserRouter, useInRouterContext } from 'react-router';
import { WorkspaceProvider } from './app/WorkspaceContext';
import WorkspaceShell from './app/WorkspaceShell';
import './styles.css';
function Workspace() {
  return (
    <WorkspaceProvider>
      <WorkspaceShell />
    </WorkspaceProvider>
  );
}

export default function App() {
  const routed = useInRouterContext();
  return routed ? (
    <Workspace />
  ) : (
    <BrowserRouter>
      <Workspace />
    </BrowserRouter>
  );
}
