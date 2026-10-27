"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import {
  ArrowUpRight,
  ArrowDownRight,
  Download,
  Zap,
  Layers,
  ScanLine,
  ExternalLink,
  Gauge,
  ShieldAlert,
  PiggyBank,
  Repeat,
  ArrowLeftRight,
  Split,
} from "lucide-react";
import { Button, Card, Chip, FadeIn, IconButton, Muted, Progress, Segmented, Stat } from "@/components/ui/kit";
import { EquityChart } from "@/components/charts/equity-chart";
import { PnlBars } from "@/components/charts/pnl-bars";
import { EmptySlot, PositionCard } from "@/components/positions/position-card";
import { engineGet, enginePost, useEngineState, type RangeKey } from "@/lib/api";
import { pct, pctPlain, time, usd } from "@/lib/format";
import { toast } from "sonner";

const RANGES: { value: RangeKey; label: string }[] = [
  { value: "today", label: "1 день" },
  { value: "7d", label: "7 дней" },
  { value: "30d", label: "30 дней" },
  { value: "custom", label: "Всё" },
];

function RuleRow({ icon, label, value }: { icon: React.ReactNode; label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-2 border-b border-white/[0.04] py-[5px] last:border-0">
      <span className="flex items-center gap-1.5 text-[11px] text-muted">
        <span className="text-dim">{icon}</span>
        {label}
      </span>
      <span className="num shrink-0 text-[11.5px] text-ink">{value}</span>
    </div>
  );
}

export default function DashboardPage() {
  const { state, connected } = useEngineState();
  const [range, setRange] = useState<RangeKey>("7d");
  const [analytics, setAnalytics] = useState<any>(null);

  useEffect(() => {
    let alive = true;
    engineGet<any>(`/analytics?range=${range === "custom" ? "30d" : range}`)
      .then((d) => alive && setAnalytics(d))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [range]);

  const equity = state?.equity ?? 500;
  const deposit = state?.deposit ?? 500;
  const pnlToday = state?.pnlToday ?? 0;
  const pnlTodayPct = (pnlToday / deposit) * 100;
  const target = state?.target ?? 2;
  const positions: any[] = state?.positions ?? [];
  const slots = state?.maxPositions ?? 1;
  const free = Math.max(0, slots - positions.length);
  const st = state?.settings ?? {};
  const banked = state?.bankedTotal ?? state?.banked ?? 0;

  const equitySeries = useMemo(() => {
    const s = analytics?.equitySeries ?? [];
    if (s.length > 1) return s;
    return [
      { ts: Date.now() - 86_400_000, equity: deposit },
      { ts: Date.now(), equity },
    ];
  }, [analytics, deposit, equity]);

  const rangeDelta = useMemo(() => {
    if (equitySeries.length < 2) return 0;
    const first = equitySeries[0].equity;
    const last = equitySeries[equitySeries.length - 1].equity;
    return ((last - first) / (first || 1)) * 100;
  }, [equitySeries]);

  const act = async (path: string, okMsg: string, body?: unknown) => {
    try {
      await enginePost(`/bot/${path}`, body);
      toast.success(okMsg);
    } catch (e: any) {
      toast.error("Не удалось выполнить", { description: String(e?.message ?? e) });
    }
  };

  return (
    <div className="mx-auto max-w-[1500px]">
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1.62fr)_minmax(0,1fr)]">
        {/* ─────────── левая колонка */}
        <div className="space-y-4">
          <FadeIn>
            <Card className="p-0">
              <div className="p-5 pb-2 lg:p-6 lg:pb-2">
                <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-start sm:justify-between">
                  <div>
                    <Muted className="mb-1">Общий баланс</Muted>
                    <div className="flex flex-wrap items-end gap-3">
                      <motion.div
                        key={Math.round(equity * 100)}
                        initial={{ opacity: 0.6, y: 4 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ duration: 0.35 }}
                        className="num text-[34px] font-semibold leading-none tracking-[-0.03em] lg:text-[40px]"
                      >
                        {usd(equity)}
                      </motion.div>
                      <span
                        className={`num mb-1 inline-flex items-center gap-0.5 text-[13px] font-medium ${
                          pnlTodayPct >= 0 ? "text-mint" : "text-danger"
                        }`}
                      >
                        {pnlTodayPct >= 0 ? <ArrowUpRight className="h-3.5 w-3.5" /> : <ArrowDownRight className="h-3.5 w-3.5" />}
                        {pct(pnlTodayPct)}
                      </span>
                    </div>
                    <div className="mt-1.5 flex flex-wrap items-center gap-2 text-[11px] text-dim">
                      <span>депозит {usd(deposit, 0)}</span>
                      <span className="h-1 w-1 rounded-full bg-dim/50" />
                      <span>цель +{target}% / день</span>
                      <span className="h-1 w-1 rounded-full bg-dim/50" />
                      <span>
                        слоты {positions.length}/{slots}
                      </span>
                      {state?.mode === "demo" && <Chip tone="accent">демо</Chip>}
                    </div>
                  </div>
                  <Segmented<RangeKey> value={range} options={RANGES} onChange={setRange} />
                </div>
              </div>

              <div className="px-1">
                <EquityChart data={equitySeries} height={210} />
              </div>

              <div className="flex flex-wrap items-center justify-between gap-3 border-t border-white/[0.05] px-5 py-3.5 lg:px-6">
                <div className="flex items-center gap-4 text-[11px] text-muted">
                  <span className="flex items-center gap-1.5">
                    <span className="h-2 w-2 rounded-full bg-[#ff9a3d]" /> Баланс
                  </span>
                  <span className="flex items-center gap-1.5">
                    <span className="h-2 w-2 rounded-full bg-mint" /> Комиссии
                  </span>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-[11px] text-dim">Средний дневной PnL</span>
                  <span className={`num text-[12.5px] font-semibold ${(analytics?.avgDaily ?? 0) >= 0 ? "text-mint" : "text-danger"}`}>
                    {usd(analytics?.avgDaily ?? 0)}
                  </span>
                  <span className={`num text-[11.5px] ${rangeDelta >= 0 ? "text-mint/80" : "text-danger/80"}`}>
                    {pct(rangeDelta)}
                  </span>
                </div>
              </div>
            </Card>
          </FadeIn>

          {/* ── позиции / слоты */}
          <FadeIn delay={0.05}>
            <div className="mb-2 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Layers className="h-4 w-4 text-accent2" />
                <span className="text-[13px] font-medium">Позиции в работе</span>
                <Chip tone={positions.length ? "accent" : "neutral"}>
                  {positions.length}/{slots}
                </Chip>
              </div>
              <div className="flex items-center gap-2">
                <Link href="/positions" className="text-[11px] text-muted hover:text-ink">
                  Все позиции
                </Link>
                <Button size="sm" variant="ghost" onClick={() => act("scan", "Сканируем пулы")}>
                  <ScanLine className="h-3.5 w-3.5" /> Скан
                </Button>
              </div>
            </div>
            <div className="space-y-2.5">
              {positions.map((p, i) => (
                <PositionCard key={p.id} p={p} index={i} onClose={(id) => act("close", "Позиция закрыта", { id })} />
              ))}
              {Array.from({ length: free }).map((_, i) => (
                <EmptySlot
                  key={`empty-${i}`}
                  hint={
                    state?.scanning
                      ? "идёт сканирование пулов…"
                      : deposit >= (state?.diversifyFromUsd ?? 10_000)
                        ? "диверсификация включена — бот распределит капитал по 4–6 пулам"
                        : "бот войдёт, когда найдёт пул: V/TVL ≥ «оборот», ATR ≤ «волатильность»"
                  }
                />
              ))}
            </div>
          </FadeIn>

          <FadeIn delay={0.1}>
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <Card className="p-4">
                <Stat label="В позициях" value={usd(state?.inPositions ?? 0, 0)} sub="капитал в сетках" />
              </Card>
              <Card className="p-4">
                <Stat label="Комиссии" value={usd(state?.totalFees ?? 0)} sub="собрано за всё время" valueClass="text-mint" />
              </Card>
              <Card className="p-4">
                <Stat label="Свободно" value={usd(state?.cash ?? 0, 0)} sub="SOL на балансе" />
              </Card>
              <Card className="p-4">
                <Stat label="Отложено" value={usd(banked, 0)} sub="фиксация прибыли" valueClass="text-accent2" />
              </Card>
            </div>
          </FadeIn>

          <FadeIn delay={0.14}>
            <Card className="flex h-[228px] flex-col">
              <div className="flex items-start justify-between">
                <div>
                  <div className="text-[13px] font-medium">Результат по дням</div>
                  <div className="mt-1 flex items-baseline gap-2">
                    <span className="num text-[19px] font-semibold">{usd(analytics?.pnl ?? 0)}</span>
                    <span className={`num text-[11.5px] ${(analytics?.pnl ?? 0) >= 0 ? "text-mint" : "text-danger"}`}>
                      {pct(analytics?.pnlPct ?? 0)}
                    </span>
                  </div>
                </div>
                <Chip tone="neutral">{(analytics?.trades ?? 0)} сделок</Chip>
              </div>
              <div className="mt-auto">
                <PnlBars data={analytics?.daily ?? []} height={135} />
              </div>
            </Card>
          </FadeIn>
        </div>

        {/* ─────────── правая колонка */}
        <div className="space-y-4">
          <FadeIn delay={0.04}>
            <div className="accent-gradient grain relative flex flex-col overflow-hidden rounded-[26px] p-5 text-[#241000]">
              <div className="relative z-10">
                <div className="text-[12px] font-semibold uppercase tracking-[0.16em] opacity-70">Цель дня</div>
                <div className="num mt-2 text-[34px] font-bold leading-none">{pctPlain(pnlTodayPct, 2)}</div>
                <div className="mt-1 text-[12px] font-medium opacity-80">из {target}% к депозиту · только комиссии</div>

                <div className="mt-4 h-1.5 w-full overflow-hidden rounded-full bg-[#3a1a05]/40">
                  <div
                    className="h-full rounded-full bg-[#1d0d02]"
                    style={{ width: `${Math.min(100, Math.max(0, (Math.max(0, pnlTodayPct) / target) * 100))}%` }}
                  />
                </div>

                <div className="mt-4 space-y-1.5 text-[11.5px] font-medium opacity-85">
                  <div className="flex justify-between">
                    <span>Сделок закрыто сегодня</span>
                    <span className="num">{state?.tradesToday ?? 0}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Свободных слотов</span>
                    <span className="num">{free}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Волатильность ATR</span>
                    <span className="num">
                      {positions[0] ? `${pctPlain(positions[0].atrPct ?? 0, 2)} / ${pctPlain(st.maxAtrPct ?? 2, 1)}` : "—"}
                    </span>
                  </div>
                </div>
              </div>
              <div className="relative z-10 mt-4">
                <Button variant="light" size="md" className="w-full" onClick={() => act("scan", "Сканируем пулы")}>
                  <Zap className="h-4 w-4" /> Сканировать пулы
                </Button>
              </div>
              <div className="pointer-events-none absolute -right-10 -top-10 h-40 w-40 rounded-full bg-white/20 blur-2xl" />
            </div>
          </FadeIn>

          <FadeIn delay={0.08}>
            <Card>
              <div className="flex items-center gap-2">
                <Gauge className="h-4 w-4 text-accent2" />
                <div className="text-[13px] font-medium">Правила стратегии</div>
                <Link href="/settings" className="ml-auto text-[11px] text-muted hover:text-ink">
                  Настроить
                </Link>
              </div>
              <div className="mt-2.5">
                <RuleRow
                  icon={<ArrowLeftRight className="h-3 w-3" />}
                  label="Оборот V/TVL (сутки)"
                  value={`≥ ${st.minTurnover ?? 3}x`}
                />
                <RuleRow
                  icon={<Gauge className="h-3 w-3" />}
                  label="Волатильность ATR(30м)"
                  value={`≤ ${st.maxAtrPct ?? 2}%`}
                />
                <RuleRow
                  icon={<Split className="h-3 w-3" />}
                  label="Сетка и сплит"
                  value={
                    positions.length
                      ? `±${((positions[0].rangePct ?? 0) * 100).toFixed(2)}% · 50/50`
                      : `±${st.rangeAtrMult ?? 1.5}×ATR · 50/50`
                  }
                />
                <RuleRow
                  icon={<Repeat className="h-3 w-3" />}
                  label="Ребаланс при пробое"
                  value={`≤ ${st.maxRebalancesPerDay ?? 8}/сут`}
                />
                <RuleRow
                  icon={<ShieldAlert className="h-3 w-3" />}
                  label="Стоп серии убытков"
                  value={`${st.consecutiveLossStop ?? 3} подряд`}
                />
                <RuleRow
                  icon={<PiggyBank className="h-3 w-3" />}
                  label="Фиксация прибыли"
                  value={`${st.profitTakePct ?? 20}% на вехе`}
                />
              </div>
              <div className="mt-2 flex items-center gap-2 text-[10.5px] text-dim">
                <Chip tone={connected ? "mint" : "danger"}>{connected ? "поток активен" : "нет связи"}</Chip>
                <span>скан каждые {st.scanIntervalSeconds ?? 45} с</span>
              </div>
            </Card>
          </FadeIn>

          <FadeIn delay={0.12}>
            <Card>
              <div className="flex items-center justify-between">
                <div className="text-[13px] font-medium">Последние действия</div>
                <a
                  href="/api/engine/journal/download"
                  className="flex items-center gap-1 text-[11px] text-muted transition hover:text-ink"
                  onClick={async (e) => {
                    e.preventDefault();
                    try {
                      const res = await fetch("/api/engine/journal/download", { cache: "no-store" });
                      const text = await res.text();
                      const url = URL.createObjectURL(new Blob([text], { type: "text/markdown;charset=utf-8" }));
                      const a = document.createElement("a");
                      a.href = url;
                      a.download = `meteora-journal-${new Date().toISOString().slice(0, 10)}.md`;
                      a.click();
                      URL.revokeObjectURL(url);
                    } catch {
                      toast.error("Не удалось скачать журнал");
                    }
                  }}
                >
                  <Download className="h-3 w-3" /> Скачать журнал
                </a>
              </div>
              <div className="mt-3 space-y-1">
                {(state?.logs ?? []).slice(0, 8).map((l: any, i: number) => {
                  const tone =
                    l.type === "ENTER"
                      ? "text-mint"
                      : l.type === "REBALANCE"
                        ? "text-accent2"
                        : l.type === "STOP" || l.type === "ERROR" || l.type === "CONSECUTIVE_LOSS" || l.type === "MAX_REBALANCES"
                          ? "text-danger"
                          : "text-muted";
                  return (
                    <motion.div
                      key={`${l.ts}-${i}`}
                      initial={{ opacity: 0, x: -6 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: i * 0.03 }}
                      className="flex items-start gap-2.5 rounded-xl px-1 py-1.5"
                    >
                      <div className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-full border border-white/[0.06] bg-white/[0.03]">
                        <Layers className={`h-3.5 w-3.5 ${tone}`} />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-[12px] text-ink/90">{l.text}</div>
                        <div className="text-[10px] text-dim">
                          {l.type} · {time(l.ts)}
                        </div>
                      </div>
                    </motion.div>
                  );
                })}
                {!state?.logs?.length && <Muted>События появятся после первого скана</Muted>}
              </div>
            </Card>
          </FadeIn>

          <FadeIn delay={0.16}>
            <Card className="flex items-center justify-between">
              <div>
                <div className="text-[12px] text-muted">Статус потока</div>
                <div className="mt-1 flex items-center gap-2 text-[12.5px]">
                  <span className={`h-2 w-2 rounded-full ${connected ? "bg-mint pulse-dot" : "bg-danger"}`} />
                  {connected ? "данные в реальном времени" : "нет связи с движком"}
                </div>
              </div>
              <Link href="/swaps">
                <IconButton>
                  <ExternalLink className="h-4 w-4" />
                </IconButton>
              </Link>
            </Card>
          </FadeIn>
        </div>
      </div>
    </div>
  );
}
