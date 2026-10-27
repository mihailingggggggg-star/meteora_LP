"use client";

import { useState } from "react";
import { cn } from "@/lib/format";

export function TokenIcon({
  mint,
  symbol,
  size = 36,
  className,
  rounded = 12,
  href,
  hrefTitle = "Открыть пул в Meteora",
}: {
  mint?: string | null;
  symbol?: string | null;
  size?: number;
  className?: string;
  rounded?: number;
  /** если задан — иконка становится ссылкой (карточка смартконтракта в Meteora) */
  href?: string | null;
  hrefTitle?: string;
}) {
  const [failed, setFailed] = useState(false);
  const label = (symbol ?? "??").replace(/[^A-Za-z0-9]/g, "").slice(0, 2).toUpperCase() || "??";

  const icon = (
    <div
      className={cn(
        "relative shrink-0 overflow-hidden border border-white/[0.08] bg-gradient-to-br from-[#2a2016] to-[#15100a]",
        className,
      )}
      style={{ width: size, height: size, borderRadius: rounded }}
    >
      {mint && !failed ? (
        <img
          src={`/api/icon?mint=${mint}`}
          alt={symbol ?? "token"}
          width={size}
          height={size}
          loading="lazy"
          onError={() => setFailed(true)}
          className="h-full w-full object-cover"
        />
      ) : (
        <div
          className="grid h-full w-full place-items-center font-bold text-accent2"
          style={{ fontSize: Math.max(9, size * 0.32) }}
        >
          {label}
        </div>
      )}
    </div>
  );

  if (!href) return icon;

  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      title={hrefTitle}
      aria-label={hrefTitle}
      onClick={(e) => e.stopPropagation()}
      className="relative inline-flex shrink-0 transition hover:opacity-85 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent2/60 active:scale-[0.97]"
    >
      {icon}
    </a>
  );
}
