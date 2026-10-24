import { useTheme } from './use-theme';
import { browserLocale } from '../shared/i18n';
import { useEffect, useState } from 'react';
import type { Document } from '../../../core/src/model';
import { type DocMeta, type Space, type User } from '../api';
import { Locale } from './workspace-helpers';

export function useWorkspaceSession() {
  const [locale, setLocale] = useState<Locale>(browserLocale);
  const { dark, setDark } = useTheme();
  const [mobileReading, setMobileReading] = useState(
    () => window.matchMedia?.('(max-width: 720px)').matches ?? window.innerWidth <= 720,
  );
  useEffect(() => {
    const query = window.matchMedia?.('(max-width: 720px)');
    if (!query) return;
    const update = () => setMobileReading(query.matches);
    update();
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);
  const [user, setUser] = useState<User | null>(null);
  const [email, setEmail] = useState('d@example.com');
  const [password, setPassword] = useState('hcd-demo-2026');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [spaces, setSpaces] = useState<Space[]>([]);
  const [docs, setDocs] = useState<DocMeta[]>([]);
  const [docMeta, setDocMeta] = useState<DocMeta | null>(null);
  const [official, setOfficial] = useState<Document | null>(null);
  const [officialVersion, setOfficialVersion] = useState(0);
  return {
    locale,
    setLocale,
    dark,
    setDark,
    mobileReading,
    setMobileReading,
    user,
    setUser,
    email,
    setEmail,
    password,
    setPassword,
    busy,
    setBusy,
    error,
    setError,
    spaces,
    setSpaces,
    docs,
    setDocs,
    docMeta,
    setDocMeta,
    official,
    setOfficial,
    officialVersion,
    setOfficialVersion,
  };
}
