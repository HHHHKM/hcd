import type { ChangeSet, ChangePosition } from '../../core/src/changes';
import type { Inline } from '../../core/src/model';

// Source HTML is untrusted terminal input. Keep line breaks but escape terminal controls.
const safe = (value: string) => value.replace(/[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/g, char => `\\u${char.charCodeAt(0).toString(16).padStart(4, '0')}`);
function valueText(value: unknown): string {
  if (Array.isArray(value)) return (value as Inline).map(run => {
    if ('br' in run) return '\n';
    let text = safe(run.t);
    if (run.code) text = '`' + text + '`';
    if (run.b) text = '**' + text + '**';
    if (run.i) text = '_' + text + '_';
    if (run.sup) text = '^{' + text + '}';
    if (run.sub) text = '_{' + text + '}';
    if (run.href) text = `[${text}](${safe(run.href)})`;
    return text;
  }).join('');
  return value === undefined ? '(absent)' : value === null ? '(empty)' : typeof value === 'string' ? safe(value) : JSON.stringify(value);
}
function positionText(position: ChangePosition) {
  return `${safe(position.parentLabel || position.parent.id)} / ${position.parent.list} / ${position.after === null ? 'start' : `after ${safe(position.afterLabel || position.after)}`}`;
}
export function formatChanges(changeSet: ChangeSet): string {
  if (changeSet.unavailable) return `Detailed comparison unavailable (${safe(changeSet.unavailable)}). Inspect the source files or use mdoc diff --ops.\n`;
  if (!changeSet.changes.length) return 'No content differences.\n';
  return safe(changeSet.changes.map(change => {
    const lines = [`${change.opIndex + 1}. ${change.kind.toUpperCase()} · ${safe(change.moduleTitle || 'Document')} · ${change.targetType}${change.field ? ` / ${safe(change.fieldLabel || change.field)}` : ''} (${change.targetId})`];
    if (change.uncertain) lines.push('Identity needs human confirmation.');
    if (change.segments) {
      lines.push(change.segments.map(segment => segment.type === 'eq' ? valueText(segment.value) : segment.type === 'ins' ? `[+${valueText(segment.value)}+]` : `[-${valueText(segment.value)}-]`).join(''));
      if (change.detail === 'replacement') lines.push('(Long text: complete replacement shown.)');
    } else if (change.kind === 'field' || change.kind === 'text') lines.push(`- ${valueText(change.before)}`, `+ ${valueText(change.after)}`);
    if (change.from) lines.push(`From: ${positionText(change.from)}`);
    if (change.to) lines.push(`To: ${positionText(change.to)}`);
    const node = change.nodeAfter ?? change.nodeBefore;
    if (node) lines.push(JSON.stringify(node, null, 2));
    if (change.coupledBefore?.length) { lines.push('Also removed:'); for (const cell of change.coupledBefore) lines.push(`${cell.targetId} / ${cell.field}: ${valueText(cell.value)}`); }
    return lines.join('\n');
  }).join('\n\n') + '\n');
}
