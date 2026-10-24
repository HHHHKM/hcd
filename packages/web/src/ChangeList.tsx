import { translate } from './shared/i18n';
import { useState } from 'react';
import type { AnyNode } from '../../core/src/ops';
import type { Change, ChangeSet, ChangePosition } from '../../core/src/changes';
import type { Document, Block, Inline } from '../../core/src/model';
import type { OperationOutcome } from '../../core/src/merge';
import BlockRead, { RenderInline } from './BlockRead';
import './changes.css';
type Locale = 'zh-CN' | 'en';
const labels: Record<string, string> = {
  text: 'review.changeListCatalog.labels.text',
  field: 'review.changeListCatalog.labels.field',
  insert: 'review.changeListCatalog.labels.insert',
  delete: 'review.changeListCatalog.labels.delete',
  move: 'review.changeListCatalog.labels.move',
  document: 'review.changeListCatalog.labels.document',
  module: 'review.changeListCatalog.labels.module',
  heading: 'review.changeListCatalog.labels.heading',
  paragraph: 'review.changeListCatalog.labels.paragraph',
  quote: 'review.changeListCatalog.labels.quote',
  list: 'review.changeListCatalog.labels.list',
  'list-item': 'review.changeListCatalog.labels.list-item',
  callout: 'review.changeListCatalog.labels.callout',
  divider: 'review.changeListCatalog.labels.divider',
  image: 'review.changeListCatalog.labels.image',
  table: 'review.changeListCatalog.labels.table',
  'table-row': 'review.changeListCatalog.labels.table-row',
  'table-column': 'review.changeListCatalog.labels.table-column',
  chart: 'review.changeListCatalog.labels.chart',
  'chart-category': 'review.changeListCatalog.labels.chart-category',
  'chart-series': 'review.changeListCatalog.labels.chart-series',
  timeline: 'review.changeListCatalog.labels.timeline',
  'timeline-item': 'review.changeListCatalog.labels.timeline-item',
  kpis: 'review.changeListCatalog.labels.kpis',
  'kpi-item': 'review.changeListCatalog.labels.kpi-item',
  columns: 'review.changeListCatalog.labels.columns',
  column: 'review.changeListCatalog.labels.column',
  cards: 'review.changeListCatalog.labels.cards',
  card: 'review.changeListCatalog.labels.card',
  raw: 'review.changeListCatalog.labels.raw',
  title: 'review.changeListCatalog.labels.title',
  level: 'review.changeListCatalog.labels.level',
  ordered: 'review.changeListCatalog.labels.ordered',
  tone: 'review.changeListCatalog.labels.tone',
  asset: 'review.changeListCatalog.labels.asset',
  alt: 'review.changeListCatalog.labels.alt',
  caption: 'review.changeListCatalog.labels.caption',
  width: 'review.changeListCatalog.labels.width',
  header: 'review.changeListCatalog.labels.header',
  align: 'review.changeListCatalog.labels.align',
  kind: 'review.changeListCatalog.labels.kind',
  unit: 'review.changeListCatalog.labels.unit',
  label: 'review.changeListCatalog.labels.label',
  name: 'review.changeListCatalog.labels.name',
  value: 'review.changeListCatalog.labels.value',
  delta: 'review.changeListCatalog.labels.delta',
  ratio: 'review.changeListCatalog.labels.ratio',
  perRow: 'review.changeListCatalog.labels.perRow',
  height: 'review.changeListCatalog.labels.height',
  allowScripts: 'review.changeListCatalog.labels.allowScripts',
  note: 'review.changeListCatalog.labels.note',
  'theme.overrides.accent': 'review.changeListCatalog.labels.theme.overrides.accent',
  applied: 'review.changeListCatalog.labels.applied',
  merged: 'review.changeListCatalog.labels.merged',
  duplicate: 'review.changeListCatalog.labels.duplicate',
  conflict: 'review.changeListCatalog.labels.conflict',
  resolved: 'review.changeListCatalog.labels.resolved',
  dropped: 'review.changeListCatalog.labels.dropped',
  same_field_merge: 'review.changeListCatalog.labels.same_field_merge',
  same_anchor_insert: 'review.changeListCatalog.labels.same_anchor_insert',
  dependency_dropped: 'review.changeListCatalog.labels.dependency_dropped',
  dependency_unresolved: 'review.changeListCatalog.labels.dependency_unresolved',
};
const label = (key: string, locale: Locale) => translate(locale, labels[key] ?? key);
const isInline = (value: unknown): value is Inline =>
  Array.isArray(value) && value.every((item) => item && typeof item === 'object' && ('t' in item || 'br' in item));
function Value({ value, locale }: { value: unknown; locale: Locale }) {
  if (value === null || value === undefined || value === '' || (Array.isArray(value) && value.length === 0))
    return <em className="change-empty">{translate(locale, 'review.empty')}</em>;
  if (isInline(value)) return <RenderInline inline={value} links={false} />;
  if (typeof value === 'boolean')
    return <>{value ? translate(locale, 'review.yes') : translate(locale, 'review.no')}</>;
  return <>{typeof value === 'object' ? JSON.stringify(value) : String(value)}</>;
}
function Position({ position, locale }: { position: ChangePosition; locale: Locale }) {
  return (
    <span>
      {position.parentLabel || position.parent.id} ·{' '}
      {position.after === null
        ? translate(locale, 'review.startOfList')
        : `${translate(locale, 'review.after')}${position.afterLabel || position.after}`}
    </span>
  );
}
export function NodeContent({ node, locale }: { node: AnyNode; locale: Locale }) {
  const value = node as unknown as Record<string, unknown>;
  if (typeof value.type === 'string') {
    if (value.type === 'raw')
      return (
        <p>
          {String(value.note || translate(locale, 'review.readOnlyContent'))} · {String(value.asset)} ·{' '}
          {String(value.height)} px
        </p>
      );
    return <BlockRead block={node as Block} locale={locale} />;
  }
  if (Array.isArray(value.blocks))
    return (
      <>
        <strong>{String(value.title || '')}</strong>
        {(value.blocks as Block[]).map((block) => (
          <NodeContent node={block} locale={locale} key={block.id} />
        ))}
      </>
    );
  if (value.cells || value.values)
    return (
      <>
        {typeof value.name === 'string' && (
          <p>
            <small>{label('name', locale)}: </small>
            {value.name}
          </p>
        )}
        <dl>
          {Object.entries((value.cells || value.values) as Record<string, unknown>).map(([key, cell]) => (
            <div key={key}>
              <dt>{key}</dt>
              <dd>
                <Value value={cell} locale={locale} />
              </dd>
            </div>
          ))}
        </dl>
      </>
    );
  return (
    <>
      {['header', 'label', 'name', 'title', 'text', 'value', 'delta', 'tone', 'align']
        .filter((key) => Object.hasOwn(value, key))
        .map((key) => (
          <p key={key}>
            <small>{label(key, locale)}: </small>
            <Value value={value[key]} locale={locale} />
          </p>
        ))}
      {Array.isArray(value.items) &&
        (value.items as AnyNode[]).map((item) => <NodeContent node={item} locale={locale} key={item.id} />)}
    </>
  );
}
function LinkChanges({ change, locale }: { change: Change; locale: Locale }) {
  const hrefs = (value: unknown) =>
    isInline(value)
      ? [...new Set(value.flatMap((run) => ('href' in run && run.href ? [`${run.t} → ${run.href}`] : [])))].join(', ')
      : '';
  const before = hrefs(change.before);
  const after = hrefs(change.after);
  return before !== after ? (
    <p className="change-links">
      {translate(locale, 'review.linkDestinations')}
      <del>{before || '∅'}</del> → <ins>{after || '∅'}</ins>
    </p>
  ) : null;
}
function ChangeCard({
  change,
  locale,
  outcome,
  excluded,
}: {
  change: Change;
  locale: Locale;
  outcome?: OperationOutcome;
  excluded?: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  return (
    <li className={`change-card change-${change.kind}`}>
      <div className="change-heading">
        <b>
          {change.opIndex + 1}. {label(change.kind, locale)} · {label(change.targetType, locale)}
          {change.field ? ` · ${change.fieldLabel || label(change.field, locale)}` : ''}
        </b>
        <small>{change.moduleTitle || translate(locale, 'review.document')}</small>
      </div>
      {change.uncertain && (
        <p className="change-notice">{translate(locale, 'review.identityMatchRequiresHumanConfirmation')}</p>
      )}
      {outcome && (
        <p className="change-outcome">
          {label(outcome.outcome, locale)}
          {outcome.note ? ` · ${label(outcome.note, locale)}` : ''}
          {excluded ? translate(locale, 'review.entireSubmissionExcludedFromCandidate') : ''}
        </p>
      )}
      {change.segments ? (
        <>
          <div className="change-text">
            {change.segments.map((segment, index) =>
              segment.type === 'eq' ? (
                <span key={index}>
                  <Value value={segment.value} locale={locale} />
                </span>
              ) : segment.type === 'ins' ? (
                <ins key={index}>
                  <span className="change-sr-only">{translate(locale, 'review.added')}</span>
                  <Value value={segment.value} locale={locale} />
                </ins>
              ) : (
                <del key={index}>
                  <span className="change-sr-only">{translate(locale, 'review.removed')}</span>
                  <Value value={segment.value} locale={locale} />
                </del>
              ),
            )}
          </div>
          <LinkChanges change={change} locale={locale} />
          {change.detail === 'replacement' && (
            <small>{translate(locale, 'review.longContentShownAsACompleteBeforeAfterReplacement')}</small>
          )}
        </>
      ) : change.kind === 'field' || change.kind === 'text' ? (
        <div className="change-values">
          <div>
            <small>{translate(locale, 'review.before')}</small>
            <Value value={change.before} locale={locale} />
          </div>
          <div>
            <small>{translate(locale, 'review.after46e3a')}</small>
            <Value value={change.after} locale={locale} />
          </div>
        </div>
      ) : null}
      {(change.from || change.to) && (
        <div className="change-position">
          {change.from && (
            <p>
              {translate(locale, 'review.from')}
              <Position position={change.from} locale={locale} />
            </p>
          )}
          {change.to && (
            <p>
              {translate(locale, 'review.to')}
              <Position position={change.to} locale={locale} />
            </p>
          )}
        </div>
      )}
      {(change.nodeBefore || change.nodeAfter) && (
        <>
          <button
            type="button"
            className="text-link"
            aria-expanded={expanded}
            onClick={() => setExpanded((value) => !value)}
          >
            {expanded ? translate(locale, 'review.hideContent') : translate(locale, 'review.showContent')}
          </button>
          {expanded && (
            <div className="change-node">
              <NodeContent node={(change.nodeAfter || change.nodeBefore)!} locale={locale} />
              {Boolean(change.coupledBefore?.length) && (
                <section>
                  <h4>{translate(locale, 'review.alsoRemovedCellsCategoryValues')}</h4>
                  <dl>
                    {change.coupledBefore?.map((cell) => (
                      <div key={`${cell.targetId}:${cell.field}`}>
                        <dt>{cell.targetId}</dt>
                        <dd>
                          <Value value={cell.value} locale={locale} />
                        </dd>
                      </div>
                    ))}
                  </dl>
                </section>
              )}
            </div>
          )}
        </>
      )}
    </li>
  );
}
export default function ChangeList({
  changeSet,
  locale,
  outcomes = [],
  excluded = false,
}: {
  changeSet: ChangeSet;
  locale: Locale;
  outcomes?: OperationOutcome[];
  excluded?: boolean;
}) {
  const [limit, setLimit] = useState(25);
  const byIndex = new Map(outcomes.map((outcome) => [outcome.index, outcome]));
  if (changeSet.unavailable)
    return (
      <p role="status" className="change-notice">
        {translate(locale, 'review.aDetailedComparisonIsUnavailableForThisRecordReview')}{' '}
        <small>({changeSet.unavailable})</small>
      </p>
    );
  if (!changeSet.changes.length)
    return <p className="change-empty">{translate(locale, 'review.noContentDifferences')}</p>;
  return (
    <div className="change-list">
      <p className="change-count">
        {changeSet.changes.length} {translate(locale, 'review.changes')} ·{' '}
        <ins>{translate(locale, 'review.added6c2d6')}</ins> / <del>{translate(locale, 'review.removedd0dc3')}</del>
      </p>
      <ol>
        {changeSet.changes.slice(0, limit).map((change) => (
          <ChangeCard
            key={change.opIndex}
            change={change}
            locale={locale}
            outcome={byIndex.get(change.opIndex)}
            excluded={excluded}
          />
        ))}
      </ol>
      {limit < changeSet.changes.length && (
        <button type="button" className="button button-soft" onClick={() => setLimit((value) => value + 25)}>
          {translate(locale, 'review.show25More')}
        </button>
      )}
    </div>
  );
}
export function DocumentSnapshot({ document, locale }: { document: Document; locale: Locale }) {
  return (
    <div className="submission-document">
      <h2>{document.title}</h2>
      {document.modules.map((module) => (
        <section className="doc-module" key={module.id}>
          <h3>{module.title}</h3>
          {module.blocks.map((block) => (
            <BlockRead key={block.id} block={block} locale={locale} />
          ))}
        </section>
      ))}
    </div>
  );
}
