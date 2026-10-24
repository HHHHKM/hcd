import { translate } from '../../shared/i18n';
import { blockTypes, type EditableBlockType } from '../../editor-model';
import type { Locale } from './types';
export default function BlockPicker({
  locale,
  onSelect,
  leafOnly = false,
  disabled = false,
}: {
  locale: Locale;
  onSelect: (type: EditableBlockType) => void;
  leafOnly?: boolean;
  disabled?: boolean;
}) {
  return (
    <select
      className="be-picker"
      aria-label={translate(locale, 'editor.addBlock')}
      value=""
      disabled={disabled}
      onChange={(event) => {
        if (event.currentTarget.value) onSelect(event.currentTarget.value as EditableBlockType);
      }}
    >
      <option value="">＋ {translate(locale, 'editor.addBlock')}</option>
      {blockTypes
        .filter((type) => !leafOnly || !['columns', 'cards'].includes(type))
        .map((type) => (
          <option key={type} value={type}>
            {translate(locale, `editor.blockNames.${type}`)}
          </option>
        ))}
    </select>
  );
}
