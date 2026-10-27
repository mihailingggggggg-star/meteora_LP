"use client";

import { useEffect, useMemo, useState } from "react";
import { CalendarDays, ChartPie, RefreshCw, TrendingDown, TrendingUp } from "lucide-react";
import { Card, Chip, FadeIn, Muted, Segmented, Stat } from "@/components/ui/kit";
import { EquityChart } from "@/components/charts/equity-chart";
import { PnlBars } from "@/components/charts/pnl-bars";
import { engineGet, type RangeKey } from "@/lib/api";
import { dateShort, hours, pct, pctPlain, reasonLabel, reasonTone, usd } from "@/lib/format";

const RANGES: { value: RangeKey; label: string }[] = [
  { value: "today", label: "Сегодня" },
  { value: "yesterday", label: "Вчера" },
  { value: "7d", label: "7 дней" },
  { value: "30d", label: "30 дней" },
  { value: "custom", label: "Календарь" },
];

export default function AnalyticsPage() {
  const [range, setRange] = useState<RangeKey>("7d");
  const [from, setFrom] = useState(() => new Date(Date.now() - 6 * 86400000).toISOString().slice(0, 10));
  const [to, setTo] = useState(() => new Date().toISOString().slice(0, 10));
  const [data, setData] = useState<any>(null);

  const query = useMemo(() => {
    if (range === "custom") {
      return `range=custom&from=${new Date(from).getTime()}&to=${new Date(to).getTime() + 86_400_000}`;
    }
    return `range=${range}`;
  }, [range, from, to]);

  useEffect(() => {
    let alive = true;
    engineGet<any>(`/analytics?${query}`)
      .then((d) => alive && setData(d))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [query]);

  const losses = (data?.positions ?? []).filter((p: any) => (p.pnl ?? 0) < 0).slice(0, 6);
  const best = (data?.positions ?? []).filter((p: any) => (p.pnl ?? 0) > 0).slice(0, 6);

  return (
    <div className="mx-auto max-w-[1500px] space-y-4">
      <FadeIn>
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-[22px] font-semibold tracking-tight">Аналитика</h1>
            <p className="mt-0.5 text-[12px] text-muted">
              PnL, комиссии, лучшие пары и минусовые сделки за выбранный период.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Segmented<RangeKey> value={range} onChange={setRange} options={RANGES} />
          </div>
        </div>
      </FadeIn>

      {range === "custom" && (
        <FadeIn>
          <Card className="flex flex-wrap items-center gap-3 p-4">
            <CalendarDays className="h-4 w-4 text-muted" />
            <label className="flex items-center gap-2 text-[11px] text-muted">
              с
              <input
                type="date"
                value={from}
                onChange={(e) => setFrom(e.target.value)}
                className="rounded-lg border border-white/[0.08] bg-white/[0.03] px-2 py-1.5 text-[12px] text-ink focus:border-accent/50 focus:outline-none"
              />
            </label>
            <label className="flex items-center gap-2 text-[11px] text-muted">
              по
              <input
                type="date"
                value={to}
                onChange={(e) => setTo(e.target.value)}
                className="rounded-lg border border-white/[0.08] bg-white/[0.03] px-2 py-1.5 text-[12px] text-ink focus:border-accent/50 focus:outline-none"
              />
            </label>
            <span className="text-[11px] text-dim">диапазон применяется автоматически</span>
          </Card>
        </FadeIn>
      )}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <FadeIn delay={0.02}>
          <Card className="p-4">
            <Stat
              label="PnL за период"
              value={<span className={(data?.pnl ?? 0) >= 0 ? "text-mint" : "text-danger"}>{usd(data?.pnl ?? 0)}</span>}
              sub={pct(data?.pnlPct ?? 0)}
            />
          </Card>
        </FadeIn>
        <FadeIn delay={0.04}>
          <Card className="p-4">
            <Stat label="Комиссии" value={<span className="text-mint">{usd(data?.fees ?? 0)}</span>} sub="чистыми после протокола" />
          </Card>
        </FadeIn>
        <FadeIn delay={0.06}>
          <Card className="p-4">
            <Stat label="Сделок" value={data?.trades ?? 0} sub={`winrate ${pctPlain(data?.winRate ?? 0, 0)}`} />
          </Card>
        </FadeIn>
        <FadeIn delay={0.08}>
          <Card className="p-4">
            <Stat label="Средний день" value={usd(data?.avgDaily ?? 0)} sub="по выбранному окну" />
          </Card>
        </FadeIn>
        <FadeIn delay={0.1}>
          <Card className="p-4">
            <Stat
              label="Ребалансы"
              value={data?.rebalances ?? 0}
              sub={`издержки ${usd(data?.friction ?? 0)}`}
            />
          </Card>
        </FadeIn>
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        <FadeIn delay={0.12}>
          <Card className="p-0">
            <div className="flex items-center justify-between p-5 pb-1">
              <div>
                <div className="text-[13px] font-medium">Кривая капитала</div>
                <Muted>депозит + собранные комиссии</Muted>
              </div>
              <Chip tone={(data?.pnl ?? 0) >= 0 ? "mint" : "danger"}>{pct(data?.pnlPct ?? 0)}</Chip>
            </div>
            <div className="px-1 pb-2">
              <EquityChart data={data?.equitySeries ?? []} height={260} />
            </div>
          </Card>
        </FadeIn>

        <FadeIn delay={0.14}>
          <Card className="h-full">
            <div className="text-[13px] font-medium">Результат по дням</div>
            <div className="mt-2">
              <PnlBars data={data?.daily ?? []} height={210} />
            </div>
            <div className="mt-3 grid grid-cols-2 gap-3">
              <div className="surface-sm p-3">
                <div className="text-[10px] uppercase tracking-wider text-dim">Прибыльных</div>
                <div className="num mt-1 text-[16px] font-semibold text-mint">{data?.wins ?? 0}</div>
              </div>
              <div className="surface-sm p-3">
                <div className="text-[10px] uppercase tracking-wider text-dim">Минусовых</div>
                <div className="num mt-1 text-[16px] font-semibold text-danger">{data?.losses ?? 0}</div>
                <div className="num text-[10px] text-dim">{usd(data?.lossPnl ?? 0)}</div>
              </div>
            </div>
          </Card>
        </FadeIn>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <FadeIn delay={0.16}>
          <Card className="h-full">
            <div className="flex items-center gap-2">
              <ChartPie className="h-4 w-4 text-accent2" />
              <div className="text-[13px] font-medium">Почему закрывались</div>
            </div>
            <div className="mt-3 space-y-2">
              {(data?.byReason ?? []).map((r: any) => (
                <div key={r.reason} className="flex items-center justify-between gap-2 border-b border-white/[0.04] pb-1.5">
                  <span className="flex min-w-0 items-center gap-1.5">
                    <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${r.pnl >= 0 ? "bg-mint" : "bg-danger"}`} />
                    <span className="truncate text-[12px] text-ink/90">{reasonLabel[r.reason] ?? r.reason}</span>
                    <span className="num text-[10px] text-dim">{r.n}</span>
                  </span>
                  <span className={`num shrink-0 text-[12px] ${r.pnl >= 0 ? "text-mint" : "text-danger"}`}>{usd(r.pnl)}</span>
                </div>
              ))}
              {!data?.byReason?.length && <Muted>Нет закрытых сделок за период</Muted>}
            </div>
            <div className="mt-3 flex items-center justify-between text-[10.5px] text-dim">
              <span>среднее время в сделке</span>
              <span className="num">{hours(data?.avgHoldHours ?? 0)}</span>
            </div>
          </Card>
        </FadeIn>

        <FadeIn delay={0.18}>
          <Card className="h-full">
            <div className="flex items-center gap-2">
              <TrendingUp className="h-4 w-4 text-mint" />
              <div className="text-[13px] font-medium">Лучшие сделки</div>
            </div>
            <div className="mt-3 space-y-2">
              {best.map((p: any) => (
                <div key={p.id} className="flex items-center justify-between border-b border-white/[0.04] pb-1.5">
                  <div className="min-w-0">
                    <div className="truncate text-[12px] text-ink/90">{p.poolName}</div>
                    <div className="num text-[10px] text-dim">{dateShort(p.closedAt)}</div>
                  </div>
                  <span className="num text-[12px] text-mint">{usd(p.pnl)}</span>
                </div>
              ))}
              {!best.length && <Muted>Нет прибыльных сделок</Muted>}
            </div>
          </Card>
        </FadeIn>

        <FadeIn delay={0.2}>
          <Card className="h-full">
            <div className="flex items-center gap-2">
              <TrendingDown className="h-4 w-4 text-danger" />
              <div className="text-[13px] font-medium">Минусовые сделки</div>
            </div>
            <div className="mt-3 space-y-2">
              {losses.map((p: any) => (
                <div key={p.id} className="flex items-center justify-between border-b border-white/[0.04] pb-1.5">
                  <div className="min-w-0">
                    <div className="truncate text-[12px] text-ink/90">{p.poolName}</div>
                    <div className="text-[10px] text-dim">
                      {reasonLabel[p.reason] ?? p.reason ?? "—"} · {p.rebalances ?? 0} реб.
                    </div>
                  </div>
                  <span className="num text-[12px] text-danger">{usd(p.pnl)}</span>
                </div>
              ))}
              {!losses.length && <Muted>Минусовых сделок нет — так держать</Muted>}
            </div>
          </Card>
        </FadeIn>
      </div>
    </div>
  );
}
