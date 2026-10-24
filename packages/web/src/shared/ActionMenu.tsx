import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import './action-menu.css';

export type MenuAction = {
  id: string;
  label: string;
  onSelect: () => void;
  disabled?: boolean;
  danger?: boolean;
};

/** A compact action menu with the standard menu button keyboard interactions. */
export default function ActionMenu({
  label,
  children = '…',
  actions,
  disabled = false,
}: {
  label: string;
  children?: React.ReactNode;
  actions: MenuAction[];
  disabled?: boolean;
}) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const container = useRef<HTMLDivElement>(null);
  const initialFocus = useRef<'first' | 'last'>('first');
  const items = () => [
    ...(container.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not(:disabled)') ?? []),
  ];
  const close = (restoreFocus = true) => {
    setOpen(false);
    if (restoreFocus) trigger.current?.focus();
  };
  useEffect(() => {
    if (!open) return;
    const available = [
      ...(container.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not(:disabled)') ?? []),
    ];
    (initialFocus.current === 'last' ? available.at(-1) : available[0])?.focus();
    const outside = (event: PointerEvent) => {
      if (!container.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', outside);
    return () => document.removeEventListener('pointerdown', outside);
  }, [open]);
  const show = (position: 'first' | 'last' = 'first') => {
    initialFocus.current = position;
    setOpen(true);
  };
  const navigate = (event: KeyboardEvent) => {
    const available = items();
    const index = available.indexOf(document.activeElement as HTMLButtonElement);
    let next: number | undefined;
    if (event.key === 'ArrowDown') next = (index + 1) % available.length;
    if (event.key === 'ArrowUp') next = (index - 1 + available.length) % available.length;
    if (event.key === 'Home') next = 0;
    if (event.key === 'End') next = available.length - 1;
    if (next !== undefined) {
      event.preventDefault();
      available[next]?.focus();
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      close();
    }
    if (event.key === 'Tab') close(false);
  };
  return (
    <div className="action-menu" ref={container}>
      <button
        type="button"
        className="button button-soft action-menu-trigger"
        ref={trigger}
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        disabled={disabled}
        onClick={() => (open ? close() : show())}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault();
            show(event.key === 'ArrowUp' ? 'last' : 'first');
          }
        }}
      >
        {children}
      </button>
      {open && (
        <div className="action-menu-items" role="menu" id={id} aria-label={label} onKeyDown={navigate}>
          {actions.map((action) => (
            <button
              key={action.id}
              type="button"
              role="menuitem"
              tabIndex={-1}
              className={action.danger ? 'danger-action' : undefined}
              disabled={action.disabled}
              onClick={() => {
                close();
                action.onSelect();
              }}
            >
              {action.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
