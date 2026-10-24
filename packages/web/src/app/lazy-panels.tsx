import { lazy } from 'react';
export const DocumentEditor = lazy(() => import('../DocumentEditor'));
export const NotificationPreferences = lazy(() => import('../NotificationPreferences'));
export const ReviewChanges = lazy(() => import('../ReviewChanges'));
export const VersionComparison = lazy(() => import('../VersionComparison'));
export const SubmissionDetails = lazy(() => import('../SubmissionDetails'));
export const AiTasks = lazy(() => import('../AiTasks'));
export const ExportPanel = lazy(() => import('../ExportPanel'));
export const ShareLinks = lazy(() => import('../ShareLinks'));
export const Administration = lazy(() =>
  import('../Administration').then((module) => ({
    default: module.Administration,
  })),
);
export const DocumentMembers = lazy(() =>
  import('../Administration').then((module) => ({
    default: module.DocumentMembers,
  })),
);
