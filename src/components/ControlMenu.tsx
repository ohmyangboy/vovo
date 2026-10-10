import { useEffect, useRef, useState, type ReactNode } from "react";

export function ControlMenu({ label, className = "", trigger, children }: {
  label: string; className?: string; trigger: ReactNode; children: ReactNode;
}) {
  const element = useRef<HTMLDetailsElement>(null);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open) return;
    const close = (event: PointerEvent) => {
      if (event.target instanceof Node && !element.current?.contains(event.target))
        element.current?.removeAttribute("open");
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [open]);
  return <details ref={element} className={"control-menu " + className}
    onToggle={(event) => setOpen(event.currentTarget.open)} onKeyDown={(event) => {
      if (event.key === "Escape" && element.current?.open) {
        event.stopPropagation();
        event.preventDefault();
        element.current.open = false;
        element.current.querySelector("summary")?.focus();
      }
    }}>
    <summary aria-label={label}>{trigger}</summary>{children}
  </details>;
}
