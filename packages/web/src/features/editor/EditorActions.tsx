import { translate } from '../../shared/i18n';
import type { Locale } from './types';
export default function EditorActions({
  locale,
  index,
  count,
  min = 0,
  onMove,
  onDelete,
}: {
  locale: Locale;
  index: number;
  count: number;
  min?: number;
  onMove: (direction: -1 | 1) => void;
  onDelete: () => void;
}) {
  return (
    <div className="be-actions">
      <span>{index + 1}</span>
      <button
        type="button"
        disabled={index === 0}
        onClick={() => onMove(-1)}
        aria-label={translate(locale, 'editor.moveItemUp')}
      >
        ↑
      </button>
      <button
        type="button"
        disabled={index === count - 1}
        onClick={() => onMove(1)}
        aria-label={translate(locale, 'editor.moveItemDown')}
      >
        ↓
      </button>
      <button type="button" disabled={count <= min} onClick={onDelete}>
        {translate(locale, 'editor.delete')}
      </button>
    </div>
  );
}
