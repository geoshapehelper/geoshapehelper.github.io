import { useEffect, useRef, useState } from 'react';

interface NumberFieldProps {
  value: number;
  onValue: (n: number) => void;
  min?: number;
  step?: number;
  disabled?: boolean;
}

/**
 * Numeric input that doesn't fight the user: selecting-all on focus so typing
 * replaces the value (no sticky leading "0"), and allowing the field to be
 * cleared while editing instead of snapping back to 0. The committed numeric
 * value only updates on valid input; on blur the text is canonicalized.
 */
export default function NumberField({ value, onValue, min = 0, step, disabled }: NumberFieldProps) {
  const [draft, setDraft] = useState(() => String(value));
  const focused = useRef(false);

  // Reflect external changes (reset, etc.) unless the user is mid-edit.
  useEffect(() => {
    if (!focused.current) setDraft(String(value));
  }, [value]);

  return (
    <input
      type="number"
      inputMode="decimal"
      min={min}
      step={step}
      disabled={disabled}
      value={draft}
      onFocus={(e) => {
        focused.current = true;
        e.target.select();
      }}
      onBlur={() => {
        focused.current = false;
        setDraft(String(value));
      }}
      onChange={(e) => {
        const s = e.target.value;
        setDraft(s);
        if (s === '') return; // allow an empty field while editing
        const n = Number(s);
        if (!Number.isNaN(n)) onValue(Math.max(min, n));
      }}
    />
  );
}
