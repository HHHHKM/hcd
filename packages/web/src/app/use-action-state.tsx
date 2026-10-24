import { useRef, useState } from 'react';
import type { AiTask } from '../AiTasks';
import { type PersonalToken } from '../api';

import type { useWorkspaceSession } from './use-workspace-session';
import { useLocaleTranslation } from '../shared/i18n';
type Input = Pick<ReturnType<typeof useWorkspaceSession>, 'locale'>;
export function useActionState(model: Input) {
  const { locale } = model;
  const [newComment, setNewComment] = useState('');
  const [aiSuggestions, setAiSuggestions] = useState<AiTask[]>([]);
  const [submissionDetailsId, setSubmissionDetailsId] = useState<string | null>(null);
  const [aiTasksOpen, setAiTasksOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [administrationOpen, setAdministrationOpen] = useState(false);
  const [membersOpen, setMembersOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [tokens, setTokens] = useState<PersonalToken[]>([]);
  const [tokenName, setTokenName] = useState('');
  const [newToken, setNewToken] = useState('');
  const [tokenScopes, setTokenScopes] = useState<string[]>(['read']);
  const [submissionMessage, setSubmissionMessage] = useState('');
  const [settingsTitle, setSettingsTitle] = useState('');
  const [toast, setToast] = useState('');
  const saveTimer = useRef<number | undefined>(undefined);
  const saveRevision = useRef(0);
  const saveQueue = useRef<Promise<void>>(Promise.resolve());
  const t = useLocaleTranslation(locale);
  return {
    newComment,
    setNewComment,
    aiSuggestions,
    setAiSuggestions,
    submissionDetailsId,
    setSubmissionDetailsId,
    aiTasksOpen,
    setAiTasksOpen,
    settingsOpen,
    setSettingsOpen,
    administrationOpen,
    setAdministrationOpen,
    membersOpen,
    setMembersOpen,
    shareOpen,
    setShareOpen,
    tokens,
    setTokens,
    tokenName,
    setTokenName,
    newToken,
    setNewToken,
    tokenScopes,
    setTokenScopes,
    submissionMessage,
    setSubmissionMessage,
    settingsTitle,
    setSettingsTitle,
    toast,
    setToast,
    saveTimer,
    saveRevision,
    saveQueue,
    t,
  };
}
