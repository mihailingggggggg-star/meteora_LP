"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import {
  ArrowLeft,
  ArrowUp,
  ArrowDown,
  BarChart3,
  Clock3,
  Droplets,
  Layers,
  RefreshCw,
  Sparkles,
  Target,
  TrendingDown,
  TrendingUp,
  Waves,
  Percent,
  ShieldAlert, Gauge } from "lucide-react";
import { Area, AreaChart, Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";
import { Button, Card, Chip, FadeIn, Muted, Segmented, Skeleton, Stat } from "@/components/ui/kit";
import { TokenIcon } from "@/components/ui/token-icon";
import { Section } from "@/components/ui/section";
import { SplitBar } from "@/components/positions/position-card";
import { PriceChart, type ChartCandle, type ChartLayers } from "@/components/charts/price-chart";
import { engineGet, enginePost } from "@/lib/api";
import { dateTime, hours, meteoraPoolUrl, pct, pctPlain, priceSmart, reasonLabel, reasonTone, usd, usdCompact } from "@/lib/format";
import { toast } from "sonner";

const TFS = [
  { value: "1m", label: "1м" },
  { value: "5m", label: "5м" },
  { value: "30m", label: "30м" },
  { value: "1h", label: "1ч" },
  { value: "4h", label: "4ч" },
  { value: "1d", label: "1д" },
];

function MetricTile({
  label,
  value,
  sub,
  tone = "ink",
  icon,
}: {
  label: string;
  value: React.ReactNode;
  sub?: React.ReactNode;
  tone?: "ink" | "mint" | "danger" | "accent";
  icon?: React.ReactNode;
}) {
  const tones: Record<string, string> = { ink: "text-ink", mint: "text-mint", danger: "text-danger", accent: "text-accent2" };
  return (
    <Card className="p-4">
      <div className="flex items-center justify-between">
        <span className="text-[10.5px] uppercase tracking-[0.14em] text-dim">{label}</span>
        <span className="text-dim">{icon}</span>
      </div>
      <div className={`num mt-1.5 text-[20px] font-semibold leading-none ${tones[tone]}`}>{value}</div>
      {sub ? <div className="mt-1 text-[10.5px] text-muted">{sub}</div> : null}
    </Card>
  );
}

function LayerToggle({ active, onClick, label, color }: { active: boolean; onClick: () => void; label: string; color: string }) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10.5px] transition-all duration-200 ${
        active ? "border-white/[0.14] bg-white/[0.07] text-ink" : "border-white/[0.05] bg-white/[0.02] text-dim hover:text-muted"
      }`}
    >
      <span className="h-2 w-2 rounded-full" style={{ background: active ? color : "#3a3129" }} />
      {label}
    </button>
  );
}

function AllocationCard({ solUsd, tokenUsd, history, tokenSymbol }: { solUsd: number; tokenUsd: number; history: any[]; tokenSymbol: string }) {
  const total = solUsd + tokenUsd || 1;
  const tokenPct = (tokenUsd / total) * 100;
  const data = [
    { name: "SOL", value: solUsd, color: "#35e0a1" },
    { name: tokenSymbol || "Токен", value: tokenUsd, color: "#ff9a3d" },
  ];
  return (
    <Card>
      <div className="flex items-center gap-2">
        <Waves className="h-4 w-4 text-accent2" />
        <div className="text-[13px] font-medium">Распределение капитала</div>
        <Chip tone="neutral" className="ml-auto">
          50/50 на входе
        </Chip>
      </div>
      <div className="mt-2 flex items-center gap-3">
        <div className="relative h-[118px] w-[118px] shrink-0">
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie data={data} dataKey="value" innerRadius={40} outerRadius={57} paddingAngle={2} stroke="none" isAnimationActive={false}>
                {data.map((d) => (
                  <Cell key={d.name} fill={d.color} />
                ))}
              </Pie>
              <Tooltip
                content={({ active, payload }) => {
                  if (!active || !payload?.length) return null;
                  const p = payload[0].payload as any;
                  return (
                    <div className="rounded-xl border border-white/[0.08] bg-[#1a130b] px-2.5 py-1.5 text-[11px] shadow-xl">
                      {p.name}: <span className="num font-semibold">{usd(p.value)}</span>
                    </div>
                  );
                }}
              />
            </PieChart>
          </ResponsiveContainer>
          <div className="pointer-events-none absolute inset-0 grid place-items-center">
            <div className="text-center">
              <div className="num text-[17px] font-semibold leading-none">{pctPlain(tokenPct, 0)}</div>
              <div className="text-[9px] text-dim">в токене</div>
            </div>
          </div>
        </div>
        <div className="min-w-0 flex-1 space-y-2">
          {data.map((d) => (
            <div key={d.name} className="flex items-center justify-between">
              <span className="flex min-w-0 items-center gap-1.5 text-[11.5px] text-muted">
                <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: d.color }} />
                <span className="truncate">{d.name}</span>
              </span>
              <span className="num text-[12px] text-ink">{usd(d.value)}</span>
            </div>
          ))}
          <div className="mt-1 flex items-center justify-between border-t border-white/[0.05] pt-2">
            <span className="text-[11px] text-dim">всего</span>
            <span className="num text-[12.5px] font-semibold">{usd(total)}</span>
          </div>
          <SplitBar solPct={(solUsd / total) * 100} tokenPct={(tokenUsd / total) * 100} />
        </div>
      </div>

      {history.length > 2 && (
        <div className="mt-3 h-[62px]">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={history} margin={{ top: 2, right: 0, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id="tokFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#ff9a3d" stopOpacity={0.5} />
                  <stop offset="100%" stopColor="#ff9a3d" stopOpacity={0.03} />
                </linearGradient>
              </defs>
              <Area type="monotone" dataKey="token" stroke="#ff9a3d" strokeWidth={1.6} fill="url(#tokFill)" isAnimationActive={false} />
              <Tooltip
                content={({ active, payload }) => {
                  if (!active || !payload?.length) return null;
                  const p = payload[0].payload;
                  return (
                    <div className="rounded-lg border border-white/[0.08] bg-[#1a130b] px-2 py-1 text-[10px] shadow-xl">
                      <div className="text-dim">{new Date(p.ts).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" })}</div>
                      <div className="num">токен {usd(p.token)}</div>
                      <div className="num text-muted">SOL {usd(p.sol)}</div>
                    </div>
                  );
                }}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}
      <div className="mt-1 text-center text-[9.5px] text-dim">капитал перетекает из SOL в токен при падении и обратно при росте</div>
    </Card>
  );
}

function PnlBreakdown({
  fees,
  il,
  pnl,
  capital,
  friction,
  realized,
  exitCost,
  poolRate,
  share,
  inRange,
}: {
  fees: number;
  il: number;
  pnl: number;
  capital: number;
  friction: number;
  realized: number;
  exitCost: number;
  poolRate?: number;
  share?: number;
  inRange?: number;
}) {
  const maxAbs = Math.max(Math.abs(fees), Math.abs(il), Math.abs(friction), Math.abs(realized), Math.abs(pnl), 1);
  const rows = [
    { label: "Комиссии пула", value: fees, color: "#35e0a1", icon: <Percent className="h-3 w-3" /> },
    { label: "Тело текущей сетки", value: il, color: il >= 0 ? "#7ee2b8" : "#ff5f56", icon: <BarChart3 className="h-3 w-3" /> },
    ...(Math.abs(realized) > 0.005
      ? [
          {
            label: "Зафиксировано при ребалансах",
            value: realized + friction,
            color: realized + friction >= 0 ? "#7ee2b8" : "#ff5f56",
            icon: <ArrowDown className="h-3 w-3" />,
          },
        ]
      : []),
    ...(friction > 0.005
      ? [{ label: "Издержки ребалансов", value: -friction, color: "#ff8f6b", icon: <RefreshCw className="h-3 w-3" /> }]
      : []),
    {
      label: "Итог позиции",
      value: pnl,
      color: pnl >= 0 ? "#35e0a1" : "#ff5f56",
      icon: pnl >= 0 ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />,
    },
  ];
  return (
    <Card>
      <div className="flex items-center gap-2">
        <Layers className="h-4 w-4 text-accent2" />
        <div className="text-[13px] font-medium">Из чего сложился результат</div>
      </div>
      <div className="mt-3 space-y-2.5">
        {rows.map((r, i) => (
          <div key={r.label} className={i === rows.length - 1 ? "border-t border-white/[0.06] pt-2.5" : ""}>
            <div className="flex items-center justify-between text-[11.5px]">
              <span className="flex items-center gap-1.5 text-muted">
                <span style={{ color: r.color }}>{r.icon}</span>
                {r.label}
              </span>
              <span className="num font-medium" style={{ color: r.color }}>
                {r.value >= 0 ? "+" : ""}
                {usd(r.value)}
              </span>
            </div>
            <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-white/[0.05]">
              <div
                className="h-full rounded-full transition-all duration-700"
                style={{ width: `${Math.min(100, (Math.abs(r.value) / maxAbs) * 100)}%`, background: r.color }}
              />
            </div>
          </div>
        ))}
      </div>
      {poolRate != null && poolRate > 0 && (
        <div className="mt-2.5 grid grid-cols-3 gap-1.5 rounded-xl border border-white/[0.05] bg-white/[0.02] p-2">
          <div>
            <div className="text-[8.5px] uppercase tracking-wider text-dim">темп пула</div>
            <div className="num text-[10.5px]">{usd(poolRate, 0)}/сут</div>
          </div>
          <div>
            <div className="text-[8.5px] uppercase tracking-wider text-dim">наша доля</div>
            <div className="num text-[10.5px]">{pctPlain((share ?? 0) * 100, 2)}</div>
          </div>
          <div>
            <div className="text-[8.5px] uppercase tracking-wider text-dim">объём в коридоре</div>
            <div className="num text-[10.5px]">{pctPlain((inRange ?? 1) * 100, 0)}</div>
          </div>
        </div>
      )}
      <div className="mt-3 space-y-1 border-t border-white/[0.05] pt-2 text-[10.5px] text-dim">
        <div className="flex items-center justify-between">
          <span>капитал в сделке</span>
          <span className="num">{usd(capital, 0)}</span>
        </div>
        <div className="flex items-center justify-between">
          <span>если закрыть сейчас (своп на выходе ≈{usd(exitCost, 2)})</span>
          <span className={`num ${pnl - exitCost >= 0 ? "text-mint" : "text-danger"}`}>{usd(pnl - exitCost)}</span>
        </div>
      </div>
    </Card>
  );
}

const compactNum = (v: number | null | undefined) => {
  if (v == null || !Number.isFinite(v) || v === 0) return "—";
  const abs = Math.abs(v);
  if (abs >= 1e9) return `${(v / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `${(v / 1e6).toFixed(2)}M`;
  if (abs >= 1e3) return `${(v / 1e3).toFixed(1)}K`;
  return `${Math.round(v)}`;
};

function StatRow({ label, value, tone }: { label: string; value: React.ReactNode; tone?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-white/[0.04] py-[3px] last:border-0">
      <span className="truncate text-[10px] uppercase tracking-wide text-dim">{label}</span>
      <span className={`num shrink-0 text-[11.5px] ${tone ?? "text-ink/90"}`}>{value}</span>
    </div>
  );
}

/** Блок «как в Meteora»: комиссии пула, токен и активность. Только реальные данные API. */
function PoolStatsBlock({ data }: { data: any }) {
  if (!data || data.error) return null;
  const p = data.pool ?? {};
  const f = data.fees ?? {};
  const t = data.token ?? {};
  const st = data.stats ?? {};
  const chg = (v: number | null) =>
    v == null ? <span className="text-dim">—</span> : <span className={v >= 0 ? "text-mint" : "text-danger"}>{pct(v)}</span>;
  const delta = p.priceDeltaPct == null ? null : Number(p.priceDeltaPct);

  return (
    <Card>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-[13px] font-medium">
          Параметры пула
          <Chip tone="neutral">Meteora DLMM</Chip>
        </div>
        <div className="num text-[10.5px] text-dim">
          bin step {pctPlain(p.binStepPct, 2)} · TVL {usdCompact(p.tvl)}
        </div>
      </div>

      <div className="mt-3 grid gap-x-7 gap-y-5 md:grid-cols-3">
        <div>
          <div className="mb-1.5 text-[9.5px] uppercase tracking-[0.12em] text-dim">Комиссии</div>
          <StatRow label="24h Fees" value={usdCompact(f.h24)} tone="text-mint" />
          <StatRow label="24h Fees / TVL" value={pctPlain(f.tvl24)} />
          <StatRow label="Bin Step" value={compactNum(p.binStep)} />
          <StatRow label="Base Fee" value={pctPlain(p.baseFeePct)} />
          <StatRow label="Dynamic Fee" value={pctPlain(p.dynamicFeePct, 4)} />
          <StatRow label="Total Trading Fee" value={pctPlain(p.totalFeePct, 4)} tone="text-accent2" />
          <StatRow label="Max Fee" value={p.maxFeePct ? pctPlain(p.maxFeePct) : "—"} />
          <StatRow label="Protocol Fee" value={pctPlain(p.protocolFeePct)} />
          <StatRow label="Fee token / Quote" value={`${p.feeToken} / ${p.quote}`} />
        </div>

        <div>
          <div className="mb-1.5 text-[9.5px] uppercase tracking-[0.12em] text-dim">Токен</div>
          <StatRow label="Возраст пула" value={hours(p.ageHours ?? 0)} />
          <StatRow label="Market Cap" value={usdCompact(t.marketCap)} />
          <StatRow label="FDV" value={usdCompact(t.fdv || t.marketCap)} />
          <StatRow label="Holders" value={t.holders ? t.holders.toLocaleString("ru-RU") : "—"} />
          <StatRow label="Total Supply" value={compactNum(t.totalSupply)} />
          <StatRow
            label="Freeze Authority"
            value={t.freezeDisabled ? "отключён" : "активен"}
            tone={t.freezeDisabled ? "text-mint" : "text-danger"}
          />
          <StatRow
            label="Изменение цены"
            value={
              <span className="flex gap-2">
                <span className="text-dim">5м</span>
                {chg(t.change5m == null ? null : Number(t.change5m))}
                <span className="text-dim">1ч</span>
                {chg(t.change1h == null ? null : Number(t.change1h))}
                <span className="text-dim">24ч</span>
                {chg(t.change24h == null ? null : Number(t.change24h))}
              </span>
            }
          />
        </div>

        <div>
          <div className="mb-1.5 text-[9.5px] uppercase tracking-[0.12em] text-dim">Активность</div>
          <StatRow label="Active TVL (±2%)" value={usdCompact(st.activeTvl)} />
          <StatRow label="Fees / Active TVL" value={pctPlain(st.feesActiveTvl, 0)} />
          <StatRow label="Volume 24h" value={usdCompact(st.vol24)} />
          <StatRow label="Volume / Active TVL" value={pctPlain(st.volActiveTvl, 0)} />
          <StatRow label="Volatility (ATR 5м)" value={pctPlain(st.volatility)} />
          <StatRow label="Цена пула (Meteora)" value={priceSmart(p.currentPrice)} tone="text-accent2" />
          <StatRow label="Цена графика (Gecko)" value={priceSmart(p.chartPrice)} />
          <StatRow
            label="Δ график / пул"
            value={delta == null ? "—" : `${delta >= 0 ? "+" : ""}${delta.toFixed(3)}%`}
            tone={delta == null ? "text-dim" : Math.abs(delta) < 0.15 ? "text-mint" : "text-danger"}
          />
        </div>
      </div>
    </Card>
  );
}

/** Вертикальная шкала сетки ±range с бинами и границами ребаланса. */
function GridLadder({
  entry,
  current,
  rangePct,
  bins,
  rebalances,
  maxRebalances,
  consecutiveLosses,
  consecutiveLossStop,
  avgRel,
  atrPct = 0,
  rangePctTarget = 0,
  rangeAdjusts = 0,
}: {
  entry: number;
  current: number;
  rangePct: number;
  bins: { priceRel: number; usd: number }[];
  avgRel?: number;
  rebalances: number;
  maxRebalances: number;
  consecutiveLosses: number;
  consecutiveLossStop: number;
  atrPct?: number;
  rangePctTarget?: number;
  rangeAdjusts?: number;
}) {
  const H = 268;
  const pad = 22;
  const upper = entry * (1 + rangePct);
  const lower = entry * (1 - rangePct);
  const top = upper * 1.004;
  const bottom = lower * 0.996;
  const span = Math.max(1e-12, top - bottom);
  const y = (p: number) => pad + ((top - p) / span) * (H - pad * 2);

  const maxUsd = Math.max(...bins.map((b) => b.usd), 1);
  const inRange = current <= upper && current >= lower;
  const toLower = (current / lower - 1) * 100;
  const toUpper = (upper / current - 1) * 100;

  const levels = [
    { p: upper, color: "#35e0a1", label: "ребаланс вверх" },
    { p: current, color: "#ffffff", label: "сейчас" },
    { p: entry, color: "#ffb347", label: "центр сетки" },
    { p: lower, color: "#ff5f56", label: "ребаланс вниз" },
  ];

  return (
    <Card className="h-full">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Target className="h-4 w-4 text-accent2" />
          <div className="text-[13px] font-medium">Сетка ±{pctPlain(rangePct * 100, 2)}</div>
        </div>
        <Chip tone={inRange ? "mint" : "danger"}>{inRange ? "в диапазоне" : "граница пробита"}</Chip>
      </div>

      <div className="mt-3 flex gap-3">
        {/* шкала */}
        <div className="relative shrink-0 overflow-hidden rounded-[14px] border border-white/[0.07] bg-[#0b0806]" style={{ width: 150, height: H }}>
          {/* рабочая зона */}
          <div
            className="absolute inset-x-0 bg-gradient-to-b from-mint/[0.06] via-white/[0.02] to-danger/[0.07]"
            style={{ top: y(upper), height: Math.max(4, y(lower) - y(upper)) }}
          />
          {/* бины: ширина = капитал в бине */}
          {bins.map((b, i) => {
            const price = entry * b.priceRel;
            const yy = y(price);
            if (yy < 4 || yy > H - 4) return null;
            const w = (b.usd / maxUsd) * 96;
            return (
              <div
                key={i}
                className="absolute left-2 h-[3px] rounded-full"
                style={{
                  top: yy,
                  width: Math.max(2, w),
                  background: b.priceRel <= 1 ? "rgba(255,154,61,0.55)" : "rgba(53,224,161,0.5)",
                }}
              />
            );
          })}
          {/* уровни */}
          {levels.map((l) => (
            <div key={l.label} className="absolute inset-x-0" style={{ top: y(l.p) }}>
              <div
                className="border-t"
                style={{
                  borderColor: l.color,
                  borderTopStyle: l.label === "сейчас" ? "dashed" : l.label === "центр сетки" ? "dotted" : "solid",
                  borderTopWidth: l.label === "сейчас" ? 1.5 : 1,
                  opacity: 0.85,
                }}
              />
              <div className="absolute right-1 -translate-y-1/2">
                <span className="rounded bg-[#0b0806]/90 px-1 text-[9px] font-medium" style={{ color: l.color }}>
                  {priceSmart(l.p)}
                </span>
              </div>
            </div>
          ))}
          {/* маркер цены */}
          <div
            className="absolute -left-[2px] h-1.5 w-1.5 rounded-full bg-white shadow-[0_0_8px_rgba(255,255,255,0.9)]"
            style={{ top: y(current) - 3 }}
          />
        </div>

        {/* цифры */}
        <div className="min-w-0 flex-1">
          <div className="space-y-1">
            {[
              ["Текущая цена", priceSmart(current), "text-ink"],
              ["Центр сетки", priceSmart(entry), "text-accent2"],
              ["Средняя входа", priceSmart(entry * (avgRel ?? 1)), "text-muted"],
              ["Верхняя граница", priceSmart(upper), "text-mint"],
              ["Нижняя граница", priceSmart(lower), "text-danger"],
            ].map(([l, v, c]) => (
              <div key={l} className="flex items-center justify-between gap-2 border-b border-white/[0.04] pb-1">
                <span className="truncate text-[10.5px] text-muted">{l}</span>
                <span className={`num shrink-0 text-[11px] ${c}`}>{v}</span>
              </div>
            ))}
          </div>

          <div className="mt-2 grid grid-cols-2 gap-1.5">
            <div className="surface-sm p-2">
              <div className="flex items-center gap-1 text-[8.5px] uppercase tracking-wider text-dim">
                <ArrowDown className="h-2.5 w-2.5" /> до нижней
              </div>
              <div className={`num text-[11px] ${toLower > 0 ? "text-accent2" : "text-danger"}`}>
                {toLower > 0 ? `↓ ${toLower.toFixed(2)}%` : "пробита"}
              </div>
            </div>
            <div className="surface-sm p-2">
              <div className="flex items-center gap-1 text-[8.5px] uppercase tracking-wider text-dim">
                <ArrowUp className="h-2.5 w-2.5" /> до верхней
              </div>
              <div className={`num text-[11px] ${toUpper > 0 ? "text-accent2" : "text-danger"}`}>
                {toUpper > 0 ? `↑ ${toUpper.toFixed(2)}%` : "пробита"}
              </div>
            </div>
            <div className="surface-sm p-2">
              <div className="flex items-center gap-1 text-[8.5px] uppercase tracking-wider text-dim">
                <RefreshCw className="h-2.5 w-2.5" /> ребалансы
              </div>
              <div className="num text-[11px] text-ink">
                {rebalances}/{maxRebalances} <span className="text-[9px] text-dim">за сутки</span>
              </div>
            </div>
            <div className="surface-sm p-2">
              <div className="flex items-center gap-1 text-[8.5px] uppercase tracking-wider text-dim">
                <ShieldAlert className="h-2.5 w-2.5" /> серия убытков
              </div>
              <div className={`num text-[11px] ${consecutiveLosses >= consecutiveLossStop - 1 ? "text-danger" : "text-ink"}`}>
                {consecutiveLosses}/{consecutiveLossStop}
              </div>
            </div>
            <div className="surface-sm col-span-2 p-2">
              <div className="text-[8.5px] uppercase tracking-wider text-dim">бинов в сетке</div>
              <div className="num text-[11px]">{bins.length} · капитал делится 50/50</div>
            </div>
            <div className="surface-sm col-span-2 p-2">
              <div className="text-[8.5px] uppercase tracking-wider text-dim">ATR → диапазон</div>
              <div className="num text-[11px] text-ink">
                {atrPct.toFixed(2)}% <span className="text-dim">→</span> ±
                {((rangePctTarget || rangePct) * 100).toFixed(2)}%
                <span className="ml-1 text-[9px] text-dim">
                  · сейчас ±{(rangePct * 100).toFixed(2)}% · правок {rangeAdjusts}
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </Card>
  );
}

const EVENT_STYLE: Record<string, { c: string; bg: string; b: string; label: string }> = {
  ENTER: { c: "text-mint", bg: "bg-mint/10", b: "border-mint/20", label: "Вход" },
  REBALANCE: { c: "text-accent2", bg: "bg-accent/10", b: "border-accent/20", label: "Ребаланс" },
  RANGE_ADJUST: { c: "text-accent2", bg: "bg-accent/10", b: "border-accent/20", label: "Правка диапазона" },
  EXIT_FILTERS: { c: "text-danger", bg: "bg-danger/10", b: "border-danger/20", label: "Выход: фильтры" },
  EXIT_STOP: { c: "text-danger", bg: "bg-danger/10", b: "border-danger/20", label: "Жёсткий стоп" },
  FILL: { c: "text-muted", bg: "bg-white/[0.03]", b: "border-white/[0.06]", label: "Бины заполнены" },
  CLAIM: { c: "text-accent2", bg: "bg-accent/10", b: "border-accent/20", label: "Комиссии собраны" },
  CONSECUTIVE_LOSS: { c: "text-danger", bg: "bg-danger/10", b: "border-danger/20", label: "Серия убытков — стоп" },
  MAX_REBALANCES: { c: "text-danger", bg: "bg-danger/10", b: "border-danger/20", label: "Лимит ребалансов" },
  EXIT_VOLATILITY: { c: "text-danger", bg: "bg-danger/10", b: "border-danger/20", label: "Выход: волатильность" },
  EXIT_FLOW: { c: "text-danger", bg: "bg-danger/10", b: "border-danger/20", label: "Выход: поток остыл" },
  EXIT_TIME: { c: "text-muted", bg: "bg-white/[0.03]", b: "border-white/[0.06]", label: "Выход по времени" },
  MANUAL: { c: "text-muted", bg: "bg-white/[0.03]", b: "border-white/[0.06]", label: "Ручное закрытие" },
};

export default function PositionDetail() {
  const params = useParams<{ id: string }>();
  const id = params?.id;
  const [tf, setTf] = useState("5m");
  const [detail, setDetail] = useState<any>(null);
  const [chart, setChart] = useState<any>(null);
  const [chartLoading, setChartLoading] = useState(false);
  const [layers, setLayers] = useState<ChartLayers>({ volume: true, liquidity: true, zones: true });
  const [valueMode, setValueMode] = useState<"mc" | "price">("mc");
  const [notFound, setNotFound] = useState(false);
  const [metrics, setMetrics] = useState<any>(null);
  const cache = useRef<Record<string, any>>({});

  useEffect(() => {
    if (!id) return;
    let alive = true;
    const load = () =>
      engineGet<any>(`/positions/${id}`)
        .then((d) => {
          if (!alive) return;
          setDetail(d);
          setNotFound(false);
        })
        .catch(() => alive && setNotFound(true));
    load();
    const t = setInterval(load, 4000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [id]);

  useEffect(() => {
    if (!id) return;
    let alive = true;
    const load = () =>
      engineGet<any>(`/positions/${id}/metrics`)
        .then((d) => alive && setMetrics(d))
        .catch(() => {});
    load();
    const t = setInterval(load, 15_000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [id]);

  useEffect(() => {
    if (!id) return;
    let alive = true;
    const cached = cache.current[tf];
    if (cached) setChart(cached);
    setChartLoading(!cached);
    engineGet<any>(`/positions/${id}/chart?tf=${tf}`)
      .then((d) => {
        if (!alive) return;
        cache.current[tf] = d;
        setChart(d);
        setChartLoading(false);
        const rest = ["1h", "1d"].filter((x) => x !== tf && !cache.current[x]);
        rest.forEach((x, i) =>
          setTimeout(() => {
            if (!alive || cache.current[x]) return;
            engineGet<any>(`/positions/${id}/chart?tf=${x}`)
              .then((dd) => {
                cache.current[x] = dd;
              })
              .catch(() => {});
          }, 700 * (i + 1)),
        );
      })
      .catch(() => alive && setChartLoading(false));
    return () => {
      alive = false;
    };
  }, [id, tf]);

  const live = detail?.live;
  const isOpen = detail?.status === "open";

  const view = useMemo(() => {
    if (!detail) return null;
    const capital = live?.capital ?? detail.capital ?? 0;
    const entryPrice = live?.entryPrice ?? detail.entry_price ?? 0;
    const rangePct = live?.rangePct ?? detail.range_pct ?? 0.025;
    const fees = (live?.feesAccrued ?? detail.fees_usd ?? 0) + (detail.claimed_usd ?? 0);
    const pnl = live ? live.pnl : (detail.pnl_usd ?? 0);
    const pnlPct = live ? live.pnlPctOfDeposit : (detail.pnl_pct ?? 0);
    const pnlPctOfCapital = live
      ? (live.pnlPctOfCapital ?? 0)
      : ((detail.pnl_usd ?? 0) / Math.max(1e-9, detail.initial_capital ?? detail.capital ?? 1)) * 100;
    // для открытой позиции движок отдаёт разложение; у закрытой всё уже реализовано
    const realizedPnl = live ? (live.realizedPnl ?? 0) : (detail.pnl_usd ?? 0);
    const unrealizedPnl = live ? (live.unrealizedPnl ?? 0) : 0;
    const solUsd = live?.solUsd ?? detail.allocation?.at?.(-1)?.sol ?? capital / 2;
    const tokenUsd = live?.tokenUsd ?? detail.allocation?.at?.(-1)?.token ?? capital / 2;
    const body = live ? live.bodyPnl : (detail.il_usd ?? 0);
    const friction = live?.frictionPaid ?? detail.friction_usd ?? 0;
    const realized = capital - (live?.initialCapital ?? detail.initial_capital ?? capital);
    const frictionPct = live?.frictionPct ?? 0.15;
    // на выходе свопаем в SOL только токеновую часть — она и платит friction
    const exitCost = live
      ? tokenUsd * (frictionPct / 100)
      : Math.max(0, (detail.exit_slip_pct ?? 0) / 100) * capital;
    return {
      capital,
      initialCapital: live?.initialCapital ?? detail.initial_capital ?? capital,
      entryPrice,
      rangePct,
      pnl,
      pnlPct,
      pnlPctOfCapital,
      realizedPnl,
      unrealizedPnl,
      fees,
      solUsd,
      tokenUsd,
      body,
      friction,
      realized,
      exitCost,
    };
  }, [detail, live]);

  if (notFound && !detail) {
    return (
      <div className="mx-auto max-w-[1500px]">
        <Card className="flex flex-col items-center gap-2 py-12 text-center">
          <div className="text-[14px] text-ink/90">Позиция #{id} не найдена</div>
          <div className="max-w-[320px] text-[12px] text-muted">
            Возможно, демо-контур сбрасывали — история этой позиции удалена.
          </div>
          <Link href="/positions" className="mt-2 text-[12px] text-accent2 hover:underline">
            ← Все позиции
          </Link>
        </Card>
      </div>
    );
  }

  if (!detail || !view) {
    return (
      <div className="mx-auto max-w-[1500px] space-y-3">
        <Skeleton className="h-[64px]" />
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-[86px]" />
          ))}
        </div>
        <Skeleton className="h-[440px]" />
      </div>
    );
  }

  const mcFactor = chart?.mcFactor && chart.mcFactor > 0 ? chart.mcFactor : 0;
  const useMc = valueMode === "mc" && mcFactor > 0;
  const factor = useMc ? mcFactor : 1;

  const current = live?.lastPrice ?? detail.last_price ?? view.entryPrice;
  const upper = view.entryPrice * (1 + view.rangePct);
  const lower = view.entryPrice * (1 - view.rangePct);

  const zAbs = {
    z1: { low: lower * factor, high: upper * factor },
    z2: { low: lower * factor, high: upper * factor },
  };
  const profileAbs = (chart?.volumeProfile ?? []).map((p: any) => ({
    price: (chart?.currentPrice ?? current) * (1 + p.priceRel) * factor,
    vol: p.vol,
  }));
  const candlesScaled = ((chart?.candles ?? []) as ChartCandle[]).map((c) => ({
    ...c,
    o: c.o * factor,
    h: c.h * factor,
    l: c.l * factor,
    c: c.c * factor,
  }));
  const binsScaled = (chart?.binLiquidity ?? []).map((b: any) => ({ price: b.price * factor, usd: b.usd }));
  const mcNow = (chart?.currentPrice ?? current) * mcFactor;

  const claim = async () => {
    try {
      await enginePost("/bot/claim", { id: detail.id });
      toast.success("Комиссии собраны");
    } catch {
      toast.error("Не удалось собрать комиссии");
    }
  };

  const close = async () => {
    try {
      await enginePost("/bot/close", { id: detail.id });
      toast.success("Позиция закрыта");
    } catch {
      toast.error("Не удалось закрыть позицию");
    }
  };

  const primaryActions = isOpen ? (
    <div className="flex items-center gap-2">
      <Button variant="mint" size="sm" onClick={claim}>
        <Sparkles className="h-3.5 w-3.5" /> Собрать комиссии
      </Button>
      <Button variant="ghost" size="sm" onClick={close}>
        Закрыть
      </Button>
    </div>
  ) : null;


  return (
    <div className="mx-auto max-w-[1500px] space-y-3.5">
      <FadeIn>
        <div className="flex flex-wrap items-center gap-3">
          <Link
            href="/positions"
            className="grid h-9 w-9 place-items-center rounded-full border border-white/[0.06] bg-white/[0.03] text-muted transition hover:text-ink"
          >
            <ArrowLeft className="h-4 w-4" />
          </Link>
          <TokenIcon mint={detail.token_mint} symbol={detail.token_symbol} size={40} rounded={13} href={meteoraPoolUrl(detail.pool)} />
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-[20px] font-semibold tracking-tight">{detail.pool_name}</h1>
              <Chip tone={isOpen ? "accent" : reasonTone[detail.exit_reason] ?? "neutral"}>
                {isOpen ? "в сделке" : reasonLabel[detail.exit_reason] ?? detail.exit_reason}
              </Chip>
              <Chip tone="neutral">#{detail.id}</Chip>
              <Chip tone="neutral">сетка ±{pctPlain(view.rangePct * 100, 2)}</Chip>
              {isOpen && live?.chainBinsCount && live.chainBinsCount !== live.binsCount ? (
                <Chip tone="accent">в цепочке {live.chainBinsCount} бинов</Chip>
              ) : null}
              {isOpen && live ? (
                live.source === "chain" ? (
                  <Chip tone="mint">цепочка · {live.chainAgeSec ?? 0} с</Chip>
                ) : (
                  <Chip tone="neutral">модель{live.chainError ? " · нет данных" : ""}</Chip>
                )
              ) : null}
            </div>
            <div className="num mt-0.5 text-[11px] text-dim">
              открыта {dateTime(detail.opened_at)}
              {isOpen
                ? ` · ${hours(live?.timeInTradeHours ?? 0)} · ${live?.inRange ? "в диапазоне" : "граница пробита"}` +
                  (live?.chainActiveBin != null ? ` · бин ${live.chainActiveBin}` : "")
                : detail.closed_at
                  ? ` · закрыта ${dateTime(detail.closed_at)}`
                  : ""}
            </div>
          </div>
          <div className="ml-auto hidden items-center gap-2 lg:flex">{primaryActions}</div>
        </div>
      </FadeIn>

      {/* ── мобильный верх: только главное, крупно ── */}
      <div className="space-y-2.5 lg:hidden">
        <Card className="p-4">
          <div className="text-[10px] uppercase tracking-[0.14em] text-dim">PnL позиции</div>
          <div
            className={`num mt-1 text-[36px] font-semibold leading-none ${
              view.pnl >= 0 ? "text-mint" : "text-danger"
            }`}
          >
            {usd(view.pnl)}
          </div>
          <div className="num mt-2 text-[11.5px] text-muted">
            {pct(view.pnlPctOfCapital)} капитала · {pct(view.pnlPct)} депозита
          </div>
          <div className="mt-3 grid grid-cols-2 gap-2 rounded-xl border border-white/[0.05] bg-white/[0.02] p-2.5">
            <div>
              <div className="text-[9px] uppercase tracking-wider text-dim">Реализовано</div>
              <div className={`num mt-0.5 text-[13px] ${view.realizedPnl >= 0 ? "text-mint" : "text-danger"}`}>
                {usd(view.realizedPnl)}
              </div>
            </div>
            <div>
              <div className="text-[9px] uppercase tracking-wider text-dim">Не реализовано</div>
              <div className={`num mt-0.5 text-[13px] ${view.unrealizedPnl >= 0 ? "text-mint" : "text-danger"}`}>
                {usd(view.unrealizedPnl)}
              </div>
            </div>
          </div>
          <div className="mt-3.5 grid grid-cols-2 gap-2 border-t border-white/[0.05] pt-3 sm:grid-cols-4">
            <div>
              <div className="text-[9px] uppercase tracking-wider text-dim">Цена</div>
              <div className="num mt-0.5 text-[13px] text-ink">{priceSmart(current)}</div>
            </div>
            <div>
              <div className="text-[9px] uppercase tracking-wider text-dim">Комиссии</div>
              <div className="num mt-0.5 text-[13px] text-mint">{usd(view.fees)}</div>
            </div>
            <div>
              <div className="text-[9px] uppercase tracking-wider text-dim">Объём 30м</div>
              <div className="num mt-0.5 text-[13px] text-accent2">{usdCompact(live?.vol30m ?? 0)}</div>
            </div>
            <div>
              <div className="text-[9px] uppercase tracking-wider text-dim">Ребалансы</div>
              <div className="num mt-0.5 text-[13px] text-ink">
                {live?.rebalances ?? detail.rebalances ?? 0}
                <span className="text-dim">/{live?.maxRebalances ?? 8}</span>
                <span className="ml-1 text-[9px] text-dim">· диапазон {live?.rangeAdjusts ?? 0}</span>
              </div>
            </div>
          </div>
        </Card>
        {primaryActions}
      </div>

      <Section title="Детали позиции" hint="PnL · комиссии · цена">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <FadeIn delay={0.02}>
          <MetricTile
            label="PnL позиции"
            value={<span className={view.pnl >= 0 ? "text-mint" : "text-danger"}>{usd(view.pnl)}</span>}
            sub={
              <>
                {pct(view.pnlPct)} депозита · реал. {usd(view.realizedPnl)}
                <br />
                не реализовано {usd(view.unrealizedPnl)} · от {usd(view.initialCapital, 0)}
              </>
            }
            icon={view.pnl >= 0 ? <TrendingUp className="h-3.5 w-3.5" /> : <TrendingDown className="h-3.5 w-3.5" />}
          />
        </FadeIn>
        <FadeIn delay={0.04}>
          <MetricTile
            label="Комиссии"
            value={<span className="text-mint">{usd(view.fees)}</span>}
            sub={
              isOpen
                ? `сейчас ${pctPlain(live?.liveDailyPct ?? 0, 2)}/сут · прогноз ${pctPlain(live?.predictedDailyPct ?? 0, 2)}`
                : detail.actual_fee_pct_daily
                  ? `факт ${pctPlain(detail.actual_fee_pct_daily, 2)}/сут`
                  : "—"
            }
            icon={<Percent className="h-3.5 w-3.5" />}
          />
        </FadeIn>
        <FadeIn delay={0.05}>
          <MetricTile
            label="Доходность пула"
            value={<span className="text-accent2">{pctPlain(live?.feeTvlPct ?? 0, 2)}<span className="text-[13px] text-dim">/сут</span></span>}
            sub={<>fee/TVL пула · диапазон покрывает {Math.round(live?.rangeCoverAtr ?? 0)} ATR</>}
            icon={<Gauge className="h-3.5 w-3.5" />}
          />
        </FadeIn>
        <FadeIn delay={0.06}>
          <MetricTile
            label="Цена / средняя входа"
            value={priceSmart(current)}
            sub={`центр ${priceSmart(view.entryPrice)} · средняя ${priceSmart(live?.pAvgPrice ?? view.entryPrice)}`}
            tone="accent"
            icon={<BarChart3 className="h-3.5 w-3.5" />}
          />
        </FadeIn>
        <FadeIn delay={0.08}>
          <MetricTile
            label="Ребалансы"
            value={
              <span>
                {live?.rebalances ?? detail.rebalances ?? 0}
                <span className="text-[13px] text-dim">/{live?.maxRebalances ?? 8}</span>
              </span>
            }
            sub={`серия убытков ${live?.consecutiveLosses ?? detail.consecutive_losses ?? 0}/${live?.consecutiveLossStop ?? 3} · правок диапазона ${live?.rangeAdjusts ?? detail.range_adjusts ?? 0}`}
            tone={(live?.consecutiveLosses ?? 0) >= 2 ? "danger" : "ink"}
            icon={<RefreshCw className="h-3.5 w-3.5" />}
          />
        </FadeIn>
      </div>

      </Section>

      <div className="grid grid-cols-1 gap-3.5 xl:grid-cols-[minmax(0,1.62fr)_minmax(0,1fr)]">
        <FadeIn delay={0.1}>
          <Card className="p-0">
            <div className="flex flex-wrap items-center justify-between gap-2 p-4 pb-0">
              <div className="min-w-0">
                <div className="flex items-center gap-2 text-[12.5px] font-medium">
                  График, сетка и ликвидность
                  {chartLoading && <span className="text-[10px] text-dim">обновляем…</span>}
                </div>
                <div className="num mt-0.5 flex flex-wrap items-center gap-2 text-[10.5px] text-dim">
                  <span>{chart?.poolName}</span>
                  {chart?.poolTvl ? <span>· пул {usdCompact(chart.poolTvl)}</span> : null}
                  {chart?.poolVol24 ? <span>· объём 24ч {usdCompact(chart.poolVol24)}</span> : null}
                  <span title="Объём последней 30-минутной свечи">· 30м {usdCompact(live?.vol30m ?? 0)}</span>
                  {mcFactor > 0 ? <span className="text-accent2">· кап {usdCompact(mcNow)}</span> : null}
                  {chart?.binLiquidity?.length ? <span>· бинов в обзоре {chart.binLiquidity.length}</span> : null}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Segmented
                  value={valueMode}
                  onChange={(v) => setValueMode(v as any)}
                  options={[
                    { value: "mc", label: "Кап" },
                    { value: "price", label: "Цена" },
                  ]}
                />
                <Segmented value={tf} onChange={setTf} options={TFS} />
              </div>
            </div>

            <div className="hidden flex-wrap items-center gap-1.5 px-4 pt-2.5 lg:flex">
              <LayerToggle
                active={layers.volume}
                onClick={() => setLayers((l) => ({ ...l, volume: !l.volume }))}
                label="Объём по цене"
                color="#ffb347"
              />
              <LayerToggle
                active={layers.liquidity}
                onClick={() => setLayers((l) => ({ ...l, liquidity: !l.liquidity }))}
                label="Ликвидность участников"
                color="#35e0a1"
              />
              <LayerToggle
                active={layers.zones}
                onClick={() => setLayers((l) => ({ ...l, zones: !l.zones }))}
                label="Моя сетка"
                color="#ff7a18"
              />
            </div>

            <div className="relative px-1 pt-1">
              {!candlesScaled.length && (
                <div className="absolute inset-0 z-10 grid place-items-center">
                  <div className="flex flex-col items-center gap-2 text-[11px] text-dim">
                    <div className="h-6 w-6 animate-spin rounded-full border-2 border-white/10 border-t-accent2" />
                    загружаем свечи…
                  </div>
                </div>
              )}
              <PriceChart
                candles={candlesScaled}
                profile={profileAbs}
                binLiquidity={binsScaled}
                zones={zAbs}
                entryPrice={view.entryPrice * factor}
                pAvgPrice={null}
                pExitPrice={null}
                layers={layers}
                usdMode={useMc}
                resetKey={`${tf}-${detail?.pool ?? ""}-${valueMode}`}
                height={430}
              />
            </div>
          </Card>
        </FadeIn>

        <Section title="Аллокация и результат" hint="SOL / токен · PnL">
        <div className="space-y-3.5">
          <FadeIn delay={0.12}>
            <AllocationCard
              solUsd={view.solUsd}
              tokenUsd={view.tokenUsd}
              history={detail.allocation ?? []}
              tokenSymbol={detail.token_symbol}
            />
          </FadeIn>
          <FadeIn delay={0.14}>
            <PnlBreakdown
              fees={view.fees}
              il={view.body}
              pnl={view.pnl}
              capital={view.capital}
              friction={view.friction}
              realized={view.realized}
              exitCost={view.exitCost}
              poolRate={isOpen ? live?.feeRatePoolDay : undefined}
              share={isOpen ? live?.feeShare : undefined}
              inRange={live?.inRangeShare}
            />
          </FadeIn>
        </div>
        </Section>
      </div>

      <Section title="Сетка и события" hint="бины · журнал">
      <div className="grid grid-cols-1 gap-3.5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
        <FadeIn delay={0.16}>
          <GridLadder
            entry={view.entryPrice}
            current={current}
            rangePct={view.rangePct}
            bins={(live?.bins ?? detail.bins ?? []).map((b: any) => ({ priceRel: b.priceRel, usd: b.usd }))}
            rebalances={live?.rebalances ?? detail.rebalances ?? 0}
            maxRebalances={live?.maxRebalances ?? 8}
            atrPct={live?.atrPct ?? 0}
            rangePctTarget={live?.rangePctTarget ?? 0}
            rangeAdjusts={live?.rangeAdjusts ?? detail.range_adjusts ?? 0}
            consecutiveLosses={live?.consecutiveLosses ?? detail.consecutive_losses ?? 0}
            consecutiveLossStop={live?.consecutiveLossStop ?? 3}
            avgRel={live?.avgEntryRel ?? 1}
          />
        </FadeIn>

        <FadeIn delay={0.18}>
          <Card className="h-full">
            <div className="flex items-center justify-between">
              <div className="text-[13px] font-medium">События</div>
              <Muted>{detail.events?.length ?? 0}</Muted>
            </div>
            <div className="mt-3 max-h-[300px] space-y-1.5 overflow-auto pr-1">
              {(detail.events ?? []).map((e: any, i: number) => {
                const s = EVENT_STYLE[e.type] ?? { c: "text-muted", bg: "bg-white/[0.03]", b: "border-white/[0.06]", label: e.type };
                return (
                  <div key={i} className="flex items-center gap-2.5 rounded-xl border border-transparent px-1 py-1.5 transition hover:border-white/[0.05]">
                    <div className={`grid h-7 w-7 shrink-0 place-items-center rounded-full border ${s.b} ${s.bg} ${s.c}`}>
                      {e.type === "ENTER" ? (
                        <Target className="h-3.5 w-3.5" />
                      ) : e.type === "REBALANCE" ? (
                        <RefreshCw className="h-3.5 w-3.5" />
                      ) : e.type === "CLAIM" ? (
                        <Sparkles className="h-3.5 w-3.5" />
                      ) : e.type?.startsWith("EXIT") || e.type === "CONSECUTIVE_LOSS" || e.type === "MAX_REBALANCES" ? (
                        <TrendingDown className="h-3.5 w-3.5" />
                      ) : (
                        <Droplets className="h-3.5 w-3.5" />
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className={`text-[12px] ${s.c}`}>{s.label}</div>
                      <div className="num text-[10px] text-dim">{dateTime(e.ts)}</div>
                    </div>
                    {e.payload?.claimed != null && <span className="num text-[11px] text-accent2">+{usd(e.payload.claimed)}</span>}
                    {e.payload?.frictionUsd != null && (
                      <span className="num text-[11px] text-danger">−{usd(e.payload.frictionUsd)}</span>
                    )}
                    {e.payload?.pnl != null && (
                      <span className={`num text-[11px] ${e.payload.pnl >= 0 ? "text-mint" : "text-danger"}`}>{usd(e.payload.pnl)}</span>
                    )}
                  </div>
                );
              })}
              {!detail.events?.length && <Muted>Событий нет</Muted>}
            </div>
          </Card>
        </FadeIn>
      </div>

      </Section>

      <Section title="Параметры пула" hint="комиссии · токен">
      <FadeIn delay={0.2}>
        <PoolStatsBlock data={metrics} />
      </FadeIn>
      </Section>
    </div>
  );
}
