"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";

/**
 * Секция мобильной версии: на телефоне — аккуратный аккордеон,
 * на десктопе — прежний блок без обёртки и заголовка.
 *
 * По умолчанию в HTML рендерится открытой (десктоп и no-JS не страдают),
 * на телефоне эффект сворачивает секции при монтировании.
 */
export function Section({
  title,
  hint,
  right,
  defaultOpen = false,
  children,
}: {
  title: string;
  hint?: string;
  right?: ReactNode;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDetailsElement>(null);
  const [open, setOpen] = useState(true);

  useEffect(() => {
    const mq = window.matchMedia("(min-width: 1024px)");
    const apply = () => {
      const next = mq.matches ? true : defaultOpen;
      if (ref.current) ref.current.open = next;
      setOpen(next);
    };
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, [defaultOpen]);

  return (
    <details
      ref={ref}
      open
      onToggle={(e) => setOpen((e.currentTarget as HTMLDetailsElement).open)}
      className="group block [&::-webkit-details-marker]:hidden"
    >
      <summary className="flex cursor-pointer list-none items-center gap-2 rounded-2xl border border-white/[0.06] bg-white/[0.02] px-3.5 py-3 text-[12.5px] text-ink/90 transition active:bg-white/[0.05] lg:hidden [&::-webkit-details-marker]:hidden">
        <span className="min-w-0 flex-1 truncate font-medium">{title}</span>
        {right}
        {hint ? <span className="num shrink-0 text-[10px] text-dim">{hint}</span> : null}
        <ChevronDown className={`h-4 w-4 shrink-0 text-dim transition ${open ? "rotate-180" : ""}`} />
      </summary>
      <div className="pt-2.5 lg:pt-0">{children}</div>
    </details>
  );
}
