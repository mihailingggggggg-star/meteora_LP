import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export const usd = (v: number | null | undefined, digits = 2) =>
  v == null || !Number.isFinite(v)
    ? "—"
    : `$${v.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits })}`;

export const usdCompact = (v: number | null | undefined) => {
  if (v == null || !Number.isFinite(v)) return "—";
  const abs = Math.abs(v);
  if (abs >= 1_000_000) return `$${(v / 1_000_000).toFixed(2)}M`;
  if (abs >= 10_000) return `$${(v / 1000).toFixed(0)}k`;
  if (abs >= 1000) return `$${(v / 1000).toFixed(1)}k`;
  return `$${v.toFixed(2)}`;
};

export const pct = (v: number | null | undefined, digits = 2) =>
  v == null || !Number.isFinite(v) ? "—" : `${v > 0 ? "+" : ""}${v.toFixed(digits)}%`;

export const pctPlain = (v: number | null | undefined, digits = 2) =>
  v == null || !Number.isFinite(v) ? "—" : `${v.toFixed(digits)}%`;

export const price = (v: number | null | undefined) => {
  if (v == null || !Number.isFinite(v)) return "—";
  if (v === 0) return "0";
  if (v >= 1000) return v.toLocaleString("en-US", { maximumFractionDigits: 2 });
  if (v >= 1) return v.toFixed(4);
  if (v >= 0.01) return v.toFixed(5);
  if (v >= 0.0001) return v.toFixed(7);
  return v.toExponential(3);
};

/** Читаемая цена: для микрокапов — обычные десятичные, без «e-5». */
export const priceSmart = (v: number | null | undefined) => {
  if (v == null || !Number.isFinite(v)) return "—";
  if (v === 0) return "0";
  const abs = Math.abs(v);
  if (abs >= 1000) return v.toLocaleString("en-US", { maximumFractionDigits: 2 });
  if (abs >= 10) return v.toFixed(3);
  if (abs >= 1) return v.toFixed(4);
  if (abs >= 0.01) return v.toFixed(5);
  if (abs >= 0.0001) return v.toFixed(7);
  const exp = Math.floor(Math.log10(abs));
  return v.toFixed(Math.min(12, -exp + 3));
};

export const time = (ts: number | null | undefined) =>
  ts ? new Date(ts).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" }) : "—";

export const dateTime = (ts: number | null | undefined) =>
  ts
    ? new Date(ts).toLocaleString("ru-RU", {
        day: "2-digit",
        month: "short",
        hour: "2-digit",
        minute: "2-digit",
      })
    : "—";

export const dateShort = (ts: number | null | undefined) =>
  ts ? new Date(ts).toLocaleDateString("ru-RU", { day: "2-digit", month: "short" }) : "—";

export const hours = (h: number | null | undefined) => {
  if (h == null || !Number.isFinite(h)) return "—";
  const hh = Math.floor(h);
  const mm = Math.round((h - hh) * 60);
  return `${hh}ч ${String(mm).padStart(2, "0")}м`;
};

export const shortAddr = (a?: string | null, n = 4) =>
  a ? `${a.slice(0, n)}…${a.slice(-n)}` : "—";

export const reasonLabel: Record<string, string> = {
  // новая логика
  CONSECUTIVE_LOSS: "Серия убытков",
  MAX_REBALANCES: "Лимит ребалансов",
  EXIT_VOLATILITY: "Рост волатильности",
  EXIT_FLOW: "Пул остыл",
  EXIT_TIME: "Отработала срок",
  MANUAL: "Вручную",
  DUPLICATE: "Дубликат (снят)",
  // старая логика (в истории)
  STOP: "Стоп",
  EXIT_UP: "Выход вверх",
  EXIT_ROTATE: "Ротация",
};

export const reasonTone: Record<string, "mint" | "danger" | "accent" | "neutral"> = {
  CONSECUTIVE_LOSS: "danger",
  MAX_REBALANCES: "accent",
  EXIT_VOLATILITY: "accent",
  EXIT_FLOW: "accent",
  EXIT_TIME: "neutral",
  MANUAL: "neutral",
  DUPLICATE: "neutral",
  STOP: "danger",
  EXIT_UP: "mint",
  EXIT_ROTATE: "neutral",
};

/** Оборот пула: суточный объём / TVL — «сколько раз TVL обернулся за сутки». */
export const turnover = (v: number | null | undefined) =>
  v == null || !Number.isFinite(v) ? "—" : `${v.toFixed(v >= 10 ? 0 : 1)}x`;

/** Публичная карточка пула (смартконтракта) в Meteora DLMM. */
export const meteoraPoolUrl = (pool?: string | null) =>
  pool ? `https://app.meteora.ag/dlmm/${pool}` : null;
