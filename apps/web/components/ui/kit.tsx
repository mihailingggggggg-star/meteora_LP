"use client";

import { motion } from "framer-motion";
import { cn } from "@/lib/format";
import * as React from "react";

export function Card({
  className,
  children,
  as: As = "div",
  ...rest
}: React.HTMLAttributes<HTMLDivElement> & { as?: any }) {
  return (
    <As className={cn("surface relative min-w-0 overflow-hidden p-5", className)} {...rest}>
      {children}
    </As>
  );
}

export function CardTitle({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn("text-[13px] font-medium text-ink/90", className)}>{children}</div>;
}

export function Muted({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn("text-[12px] text-muted", className)}>{children}</div>;
}

export function Stat({
  label,
  value,
  sub,
  className,
  valueClass,
}: {
  label: string;
  value: React.ReactNode;
  sub?: React.ReactNode;
  className?: string;
  valueClass?: string;
}) {
  return (
    <div className={cn("min-w-0", className)}>
      <div className="text-[11px] uppercase tracking-[0.14em] text-dim">{label}</div>
      <div className={cn("num mt-1 text-[20px] font-semibold text-ink", valueClass)}>{value}</div>
      {sub ? <div className="mt-0.5 text-[11px] text-muted">{sub}</div> : null}
    </div>
  );
}

export function Chip({
  children,
  tone = "neutral",
  className,
}: {
  children: React.ReactNode;
  tone?: "mint" | "danger" | "accent" | "neutral";
  className?: string;
}) {
  const tones: Record<string, string> = {
    mint: "bg-mint/12 text-mint border-mint/20",
    danger: "bg-danger/12 text-danger border-danger/20",
    accent: "bg-accent/14 text-accent2 border-accent/25",
    neutral: "bg-white/[0.04] text-muted border-white/[0.06]",
  };
  return (
    <span
      className={cn(
        "num inline-flex items-center gap-1 rounded-full border px-2 py-[3px] text-[11px] font-medium leading-none",
        tones[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

export function Button({
  children,
  variant = "accent",
  size = "md",
  className,
  ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "accent" | "ghost" | "outline" | "mint" | "light";
  size?: "sm" | "md" | "lg";
}) {
  const variants: Record<string, string> = {
    accent:
      "bg-gradient-to-b from-[#ff9a3d] to-[#f2670a] text-[#241000] shadow-[0_10px_24px_-10px_rgba(255,122,24,0.8)] hover:brightness-110",
    ghost: "bg-white/[0.04] text-ink hover:bg-white/[0.07] border border-white/[0.06]",
    outline: "border border-white/[0.12] text-ink hover:border-white/25",
    mint: "bg-mint/15 text-mint border border-mint/25 hover:bg-mint/20",
    light: "bg-[#f7f2ea] text-[#150f08] hover:bg-white",
  };
  const sizes: Record<string, string> = {
    sm: "h-8 px-3 text-[12px] rounded-[10px]",
    md: "h-10 px-4 text-[13px] rounded-[13px]",
    lg: "h-12 px-6 text-[14px] rounded-[16px]",
  };
  return (
    <button
      className={cn(
        "inline-flex select-none items-center justify-center gap-2 font-medium transition-all duration-200 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-40",
        variants[variant],
        sizes[size],
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  );
}

export function IconButton({ children, className, ...rest }: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      className={cn(
        "grid h-9 w-9 place-items-center rounded-full border border-white/[0.06] bg-white/[0.03] text-muted transition-all duration-200 hover:text-ink hover:bg-white/[0.07] active:scale-95",
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  );
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
  className,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
  className?: string;
}) {
  return (
    <div className={cn("no-scrollbar inline-flex max-w-full items-center gap-1 overflow-x-auto rounded-full border border-white/[0.06] bg-white/[0.03] p-1", className)}>
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            onClick={() => onChange(o.value)}
            className={cn(
              "relative rounded-full px-3 py-[6px] text-[11.5px] font-medium transition-colors duration-200",
              active ? "text-[#20140a]" : "text-muted hover:text-ink",
            )}
          >
            {active && (
              <motion.span
                layoutId={`seg-${options.map((x) => x.value).join("-")}`}
                className="absolute inset-0 rounded-full bg-[#f3e9dc]"
                transition={{ type: "spring", stiffness: 380, damping: 32 }}
              />
            )}
            <span className="relative z-10">{o.label}</span>
          </button>
        );
      })}
    </div>
  );
}

export function Progress({ value, tone = "mint" }: { value: number; tone?: "mint" | "accent" | "danger" }) {
  const colors = { mint: "bg-mint", accent: "bg-accent", danger: "bg-danger" };
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/[0.07]">
      <motion.div
        className={cn("h-full rounded-full", colors[tone])}
        initial={{ width: 0 }}
        animate={{ width: `${Math.min(100, Math.max(0, value))}%` }}
        transition={{ duration: 0.8, ease: [0.22, 1, 0.36, 1] }}
      />
    </div>
  );
}

export function FadeIn({
  children,
  delay = 0,
  className,
}: {
  children: React.ReactNode;
  delay?: number;
  className?: string;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, delay, ease: [0.22, 1, 0.36, 1] }}
      className={className}
    >
      {children}
    </motion.div>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn("shimmer rounded-xl", className)} />;
}

export function Empty({ title, hint, action }: { title: string; hint?: string; action?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 py-10 text-center">
      <div className="text-[14px] text-ink/90">{title}</div>
      {hint ? <div className="max-w-[280px] text-[12px] text-muted">{hint}</div> : null}
      {action}
    </div>
  );
}

export function Sparkline({ data, className, stroke = "#35e0a1" }: { data: number[]; className?: string; stroke?: string }) {
  if (!data.length) return null;
  const min = Math.min(...data);
  const max = Math.max(...data);
  const span = max - min || 1;
  const pts = data
    .map((v, i) => `${(i / (data.length - 1 || 1)) * 100},${36 - ((v - min) / span) * 32}`)
    .join(" ");
  return (
    <svg viewBox="0 0 100 40" preserveAspectRatio="none" className={className}>
      <polyline points={pts} fill="none" stroke={stroke} strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}
