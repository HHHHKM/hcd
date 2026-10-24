import { useEffect, useRef, useState } from 'react';

export function TextField({
  label,
  value,
  onChange,
  maxLength = 200,
  className,
  inputMode,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  maxLength?: number;
  className?: string;
  inputMode?: 'decimal';
}) {
  const [draft, setDraft] = useState(value);
  const composing = useRef(false);
  useEffect(() => {
    if (!composing.current) setDraft(value);
  }, [value]);
  return (
    <label className="be-field">
      <span>{label}</span>
      <input
        className={className}
        value={draft}
        maxLength={maxLength}
        inputMode={inputMode}
        onCompositionStart={() => {
          composing.current = true;
        }}
        onCompositionEnd={(event) => {
          composing.current = false;
          const next = event.currentTarget.value;
          setDraft(next);
          onChange(next);
        }}
        onChange={(event) => {
          const next = event.currentTarget.value;
          setDraft(next);
          if (!composing.current) onChange(next);
        }}
      />
    </label>
  );
}
