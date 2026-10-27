"use client";

import Link from "next/link";
import { motion } from "framer-motion";
import { ArrowUpRight, ArrowDownRight, ChevronRight, Clock3, RefreshCw, Percent, ShieldAlert } from "lucide-react";
import { Card, Chip } from "@/components/ui/kit";
import { TokenIcon } from "@/components/ui/token-icon";
import { hours, pct, pctPlain, priceSmart, reasonLabel, usd } from "@/lib/format";

/** Полоса диапазона ±range с текущей ценой внутри. */
export function RangeBar({ p, height = 34 }: { p: any; height?: number }) {
  const lo = p.entryPrice * (1 - p.rangePct);
  const hi = p.entryPrice * (1 + p.rangePct);
  const span = Math.max(1e-12, hi - lo);
  const raw = (p.lastPrice - lo) / span;
  const x = Math.min(1, Math.max(0, raw));
  const outside = raw < 0 || raw > 1;
  return (
    <div className="select-none" style={{ height }}>
      <div className="relative h-[9px] w-full overflow-visible rounded-full bg-white/[0.06]">
        {/* зона в диапазоне */}
        <div className="absolute inset-y-0 left-0 right-0 rounded-full bg-gradient-to-r from-[#ff5f56]/25 via-[#ffb347]/25 to-[#35e0a1]/25" />
        {/* заполненная (токен) часть — ниже текущей цены */}
        <div
          className="absolute inset-y-0 left-0 rounded-l-full bg-gradient-to-r from-[#ff9a3d]/55 to-[#ff9a3d]/20"
          style={{ width: `${x * 100}%` }}
        />
        {/* маркер текущей цены */}
        <div
          className="absolute top-1/2 h-3.5 w-[3px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-white shadow-[0_0_10px_rgba(255,255,255,0.85)]"
          style={{ left: `${x * 100}%` }}
        />
      </div>
      <div className="mt-1 flex items-center justify-between text-[9.5px] text-dim">
        <span className="num text-danger/80">{priceSmart(lo)}</span>
        <span className={`num ${outside ? "text-danger" : "text-mint"}`}>
          {outside
            ? "пробита граница"
            : `до границы ${Math.min(
                (p.lastPrice / lo - 1) * 100,
                (hi / p.lastPrice - 1) * 100,
              ).toFixed(2)}%`}
        </span>
        <span className="num text-mint/80">{priceSmart(hi)}</span>
      </div>
    </div>
  );
}

/** Сплит капитала SOL / токен — 50/50 на входе, перетекает при движении цены. */
export function SplitBar({ solPct, tokenPct, compact = false }: { solPct: number; tokenPct: number; compact?: boolean }) {
  const sol = Math.max(0, Math.min(100, solPct));
  return (
    <div>
      <div className="flex h-[7px] w-full overflow-hidden rounded-full bg-white/[0.05]">
        <motion.div
          className="h-full bg-[#35e0a1]"
          initial={{ width: 0 }}
          animate={{ width: `${sol}%` }}
          transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
        />
        <motion.div
          className="h-full bg-[#ff9a3d]"
          initial={{ width: 0 }}
          animate={{ width: `${100 - sol}%` }}
          transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
        />
      </div>
      {!compact && (
        <div className="mt-1 flex items-center justify-between text-[9.5px] text-dim">
          <span className="num text-mint/80">SOL {pctPlain(sol, 0)}</span>
          <span className="num text-accent2/80">токен {pctPlain(100 - sol, 0)}</span>
        </div>
      )}
    </div>
  );
}

export function PositionCard({ p, index = 0, onClose }: { p: any; index?: number; onClose?: (id: number) => void }) {
  const up = (p.pnl ?? 0) >= 0;
  const lossLeft = Math.max(0, (p.consecutiveLossStop ?? 3) - (p.consecutiveLosses ?? 0));
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: Math.min(index * 0.06, 0.3), duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
    >
      <Card className="p-4">
        <div className="flex items-start gap-3">
          <TokenIcon mint={p.tokenMint} symbol={p.tokenSymbol} size={40} rounded={13} />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <Link href={`/positions/${p.id}`} className="truncate text-[13.5px] font-medium hover:underline">
                {p.poolName}
              </Link>
              {p.inRange ? <Chip tone="mint">в сетке</Chip> : <Chip tone="danger">пробита</Chip>}
            </div>
            <div className="num mt-0.5 text-[10.5px] text-dim">
              #{p.id} · капитал {usd(p.capital, 0)} · сетка ±{pctPlain(p.rangePct * 100, 2)} · {hours(p.timeInTradeHours)}
            </div>
          </div>
          <div className="shrink-0 text-right">
            <div className={`num flex items-center justify-end gap-0.5 text-[14.5px] font-semibold ${up ? "text-mint" : "text-danger"}`}>
              {up ? <ArrowUpRight className="h-3.5 w-3.5" /> : <ArrowDownRight className="h-3.5 w-3.5" />}
              {usd(p.pnl ?? 0)}
            </div>
            <div className={`num text-[10.5px] ${up ? "text-mint/70" : "text-danger/70"}`}>{pct(p.pnlPctOfDeposit ?? 0)} депозита</div>
          </div>
        </div>

        <div className="mt-3.5 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <div className="mb-1 flex items-center justify-between text-[10px] uppercase tracking-wider text-dim">
              <span>Сетка</span>
              <span className="num text-muted">{priceSmart(p.lastPrice)}</span>
            </div>
            <RangeBar p={p} />
          </div>
          <div>
            <div className="mb-1 flex items-center justify-between text-[10px] uppercase tracking-wider text-dim">
              <span>Сплит 50/50</span>
              <span className="num text-muted">{usd(p.value ?? p.capital, 0)}</span>
            </div>
            <SplitBar solPct={p.solPct ?? 50} tokenPct={p.tokenPct ?? 50} />
          </div>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 border-t border-white/[0.05] pt-2.5 text-[10.5px]">
          <span className="flex items-center gap-1 text-mint">
            <Percent className="h-3 w-3" /> {usd((p.feesAccrued ?? 0) + (p.feesClaimed ?? 0))}
            <span className="num text-[9.5px] text-mint/60">{pctPlain(p.liveDailyPct ?? 0, 2)}/сут</span>
          </span>
          <span className="flex items-center gap-1 text-accent2">
            <RefreshCw className="h-3 w-3" /> {p.rebalances ?? 0}/{p.maxRebalances ?? 8} ребалансов
          </span>
          <span className="flex items-center gap-1 text-dim">
            <ShieldAlert className="h-3 w-3" /> серия {p.consecutiveLosses ?? 0}/{p.consecutiveLossStop ?? 3}
            {lossLeft === 1 && <span className="text-danger">· ещё 1 и стоп</span>}
          </span>
          <span className="flex items-center gap-1 text-dim">
            <Clock3 className="h-3 w-3" /> ATR {pctPlain(p.atrPct ?? 0, 2)}
          </span>
          <div className="ml-auto flex items-center gap-2">
            {onClose && (
              <button
                onClick={() => onClose(p.id)}
                className="rounded-full border border-white/[0.08] px-2.5 py-1 text-[10.5px] text-muted transition hover:border-danger/40 hover:text-danger"
              >
                Закрыть
              </button>
            )}
            <Link
              href={`/positions/${p.id}`}
              className="flex items-center gap-0.5 rounded-full border border-white/[0.08] px-2.5 py-1 text-[10.5px] text-ink transition hover:border-white/25"
            >
              Карточка <ChevronRight className="h-3 w-3" />
            </Link>
          </div>
        </div>
      </Card>
    </motion.div>
  );
}

export function EmptySlot({ hint }: { hint?: string }) {
  return (
    <Card className="flex items-center gap-3 border-dashed border-white/[0.08] bg-transparent p-4">
      <div className="grid h-10 w-10 place-items-center rounded-[13px] border border-dashed border-white/[0.12] text-dim">+</div>
      <div>
        <div className="text-[12.5px] text-muted">Свободный слот</div>
        <div className="text-[10.5px] text-dim">{hint ?? "бот войдёт, когда найдёт пул под фильтры"}</div>
      </div>
    </Card>
  );
}
