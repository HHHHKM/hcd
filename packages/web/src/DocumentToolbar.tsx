import { useEffect, useState } from 'react';
import ActionMenu, { type MenuAction } from './shared/ActionMenu';
import { useLocaleTranslation } from './shared/i18n';
import './document-toolbar.css';

type DocumentToolbarProps = {
  locale: 'en' | 'zh-CN';
  docMeta: { id: string; title: string; role: string };
  displayedVersion: number;
  pendingCount: number;
  canEdit: boolean;
  editing: boolean;
  busy: boolean;
  composing: boolean;
  mobileReading: boolean;
  screen: string;
  goHome: () => void;
  openReview: () => void;
  submitChanges: () => void;
  startEditing: () => void;
  exportHtml: () => void;
  exportZip: () => void;
  loadHistory: () => void;
  setCommentsOpen: (open: boolean) => void;
  setShareOpen: (open: boolean) => void;
  setAiTasksOpen: (open: boolean) => void;
  setMembersOpen: (open: boolean) => void;
  setArchiveDocId: (id: string) => void;
};

export default function DocumentToolbar(props: DocumentToolbarProps) {
  const t = useLocaleTranslation(props.locale);
  const [narrow, setNarrow] = useState(
    () => typeof matchMedia !== 'undefined' && matchMedia('(max-width: 480px)').matches,
  );
  useEffect(() => {
    if (typeof matchMedia === 'undefined') return;
    const query = matchMedia('(max-width: 480px)');
    const update = () => setNarrow(query.matches);
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);
  const { docMeta, busy } = props;
  const owner = docMeta.role === 'owner';
  const menu: MenuAction[] = [
    {
      id: 'export-html',
      label: t('docs.toolbar.exportHtml'),
      onSelect: props.exportHtml,
      disabled: busy,
    },
    {
      id: 'export-zip',
      label: t('docs.toolbar.exportZip'),
      onSelect: props.exportZip,
      disabled: busy,
    },
    {
      id: 'history',
      label: t('docs.toolbar.history'),
      onSelect: props.loadHistory,
    },
    {
      id: 'members',
      label: t('docs.toolbar.members'),
      onSelect: () => props.setMembersOpen(true),
    },
    {
      id: 'imports',
      label: t('docs.toolbar.importHistory'),
      onSelect: () => props.setArchiveDocId(docMeta.id),
    },
  ];
  if (docMeta.role !== 'viewer')
    menu.push({
      id: 'ai-tasks',
      label: t('docs.toolbar.aiTasks'),
      onSelect: () => props.setAiTasksOpen(true),
    });
  if (owner && narrow)
    menu.push({
      id: 'share',
      label: t('docs.toolbar.share'),
      onSelect: () => props.setShareOpen(true),
    });
  return (
    <div className="document-toolbar grouped-document-toolbar">
      <div className="breadcrumbs">
        <button onClick={props.goHome}>{t('docs.toolbar.home')}</button>
        <span aria-hidden="true">›</span>
        <b title={docMeta.title}>{docMeta.title}</b>
      </div>
      <div className="document-actions" role="group" aria-label={t('docs.toolbar.actions')}>
        <span className="version-pill">
          <i />v{new Intl.NumberFormat(props.locale).format(props.displayedVersion)}
        </span>
        <button
          className="icon-button mobile-comments"
          aria-label={t('docs.toolbar.commentsOpen')}
          onClick={() => props.setCommentsOpen(true)}
        >
          ☰
        </button>
        {props.canEdit && !props.mobileReading && !narrow && props.screen === 'document' && (
          <button
            className={`button ${props.editing ? 'button-ink' : 'button-primary'}`}
            onClick={props.editing ? props.submitChanges : props.startEditing}
            disabled={busy || props.composing}
          >
            {t(props.editing ? 'docs.toolbar.submit' : 'docs.toolbar.edit')}
          </button>
        )}
        {owner && (
          <button className="button button-soft" onClick={props.openReview}>
            {props.mobileReading || narrow
              ? t('docs.toolbar.viewReview')
              : t('docs.toolbar.review', { count: props.pendingCount })}
          </button>
        )}
        {owner && !narrow && (
          <button className="button button-soft" onClick={() => props.setShareOpen(true)}>
            {t('docs.toolbar.share')}
          </button>
        )}
        <ActionMenu label={t('docs.toolbar.moreActions')} actions={menu}>
          {t('docs.toolbar.more')}
        </ActionMenu>
      </div>
    </div>
  );
}
