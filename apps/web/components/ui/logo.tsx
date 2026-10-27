"use client";

import { useId } from "react";
import { cn } from "@/lib/format";

/**
 * Логотип: плитка с фирменным градиентом + готовый глиф из lucide
 * (`chart-no-axes-column-increasing`, MIT, github.com/lucide-icons/lucide).
 * Тот же рисунок используется в иконках приложения (public/icons).
 */
export function LogoMark({ size = 40, className }: { size?: number; className?: string }) {
  const id = useId().replace(/[:]/g, "");
  return (
    <svg
      viewBox="0 0 48 48"
      width={size}
      height={size}
      className={cn("shrink-0", className)}
      aria-hidden="true"
    >
      <defs>
        <linearGradient id={`g${id}`} x1="0.1" y1="0" x2="0.9" y2="1">
          <stop offset="0%" stopColor="#FFCE7A" />
          <stop offset="42%" stopColor="#FF8A2B" />
          <stop offset="100%" stopColor="#C43C08" />
        </linearGradient>
        <radialGradient id={`h${id}`} cx="0.5" cy="0.02" r="0.85">
          <stop offset="0%" stopColor="#FFFFFF" stopOpacity="0.32" />
          <stop offset="55%" stopColor="#FFFFFF" stopOpacity="0" />
        </radialGradient>
      </defs>
      <rect width="48" height="48" rx="13" fill={`url(#g${id})`} />
      <rect width="48" height="48" rx="13" fill={`url(#h${id})`} />
      {/* lucide: chart-no-axes-column-increasing */}
      <g
        transform="translate(9.6 9.6) scale(1.2)"
        stroke="#201003"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M5 21v-6" />
        <path d="M12 21V9" />
        <path d="M19 21V3" />
      </g>
    </svg>
  );
}

export function Logo({
  size = 40,
  withWordmark = false,
  className,
}: {
  size?: number;
  withWordmark?: boolean;
  className?: string;
}) {
  if (!withWordmark) return <LogoMark size={size} className={className} />;
  return (
    <div className={cn("flex items-center gap-2.5", className)}>
      <LogoMark size={size} />
      <div className="leading-none">
        <div className="text-[12px] font-semibold tracking-[0.2em] text-ink">METEORA</div>
        <div className="mt-1 text-[8.5px] tracking-[0.34em] text-dim">TERMINAL</div>
      </div>
    </div>
  );
}
