import React, { useEffect, useRef } from 'react';
import { IconX } from './Icons';

/**
 * Right-hand drawer used by every settings surface.
 *
 * Escape closes it (the bug the user hit: providers had no way out), the
 * backdrop closes it, and focus moves into the panel so keyboard users are not
 * left behind the overlay.
 */
export interface DrawerProps {
  title: string;
  subtitle?: string;
  wide?: boolean;
  footer?: React.ReactNode;
  onClose: () => void;
  children: React.ReactNode;
}

export function Drawer({ title, subtitle, wide, footer, onClose, children }: DrawerProps): React.ReactElement {
  const panelRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey);
    const previouslyFocused = document.activeElement as HTMLElement | null;
    panelRef.current?.focus();
    return () => {
      window.removeEventListener('keydown', onKey);
      previouslyFocused?.focus?.();
    };
  }, [onClose]);

  return (
    <>
      <div className="backdrop" onClick={onClose} role="presentation" />
      <aside
        className={`drawer ${wide ? 'wide' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        ref={panelRef}
      >
        <header className="drawer-header">
          <div>
            <div className="drawer-title">{title}</div>
            {subtitle ? <div className="drawer-sub">{subtitle}</div> : null}
          </div>
          <button className="close-button" onClick={onClose} aria-label="Close" title="Close (Esc)">
            <IconX />
          </button>
        </header>
        <div className="drawer-body">{children}</div>
        {footer ? <footer className="drawer-footer">{footer}</footer> : null}
      </aside>
    </>
  );
}
