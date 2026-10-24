import { lazy, Suspense } from 'react';
import { BrowserRouter, Route, Routes, useParams } from 'react-router';
import App from '../App';
import ForgotPassword from '../ForgotPassword';
import AuthLink from '../AuthLink';
import SharedDocument from '../SharedDocument';
const CliAuth = lazy(() => import('../CliAuth'));
const OAuthConsent = lazy(() => import('../OAuthConsent'));
function GuestRoute() {
  const { token = '' } = useParams();
  return <SharedDocument token={token} />;
}
function AuthRoute({ kind }: { kind: 'invite' | 'reset' }) {
  const { token = '' } = useParams();
  return <AuthLink kind={kind} token={token} />;
}
const workspaceRoutes = [
  '/',
  '/login',
  '/spaces/:id',
  '/spaces/:id/settings',
  '/d/:docId',
  '/d/:docId/history',
  '/d/:docId/compare',
  '/d/:docId/review',
  '/d/:docId/review/:previewId',
  '/d/:docId/settings',
  '/d/:docId/ai-tasks',
  '/d/:docId/export',
  '/new',
  '/import',
  '/import/:id',
  '/settings',
  '/settings/notifications',
  '/settings/tokens',
  '/admin/users',
];
export default function ApplicationRouter() {
  return (
    <BrowserRouter>
      <Suspense fallback={<p role="status">HCD…</p>}>
        <Routes>
          <Route path="/forgot" element={<ForgotPassword />} />
          <Route path="/auth/forgot" element={<ForgotPassword />} />
          <Route path="/invite/:token" element={<AuthRoute kind="invite" />} />
          <Route path="/reset/:token" element={<AuthRoute kind="reset" />} />
          <Route path="/s/:token" element={<GuestRoute />} />
          <Route path="/cli-auth" element={<CliAuth />} />
          <Route path="/oauth/consent" element={<OAuthConsent />} />
          {workspaceRoutes.map((path) => (
            <Route key={path} path={path} element={<App />} />
          ))}
          <Route path="*" element={<App />} />
        </Routes>
      </Suspense>
    </BrowserRouter>
  );
}
