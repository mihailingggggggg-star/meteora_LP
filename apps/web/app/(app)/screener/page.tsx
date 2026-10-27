"use client";

import { useEffect, useState } from "react";
import { Radar, RefreshCw, CheckCircle2, AlertTriangle, ArrowRight, Activity, Gauge, Layers3 } from "lucide-react";
import { motion } from "framer-motion";
import { Button, Card, Chip, FadeIn, Muted, Progress } from "@/components/ui/kit";
import { TokenIcon } from "@/components/ui/token-icon";
import { engineGet, enginePost, useEngineState } from "@/lib/api";
import { pctPlain, time, turnover, usd, usdCompact, meteoraPoolUrl } from "@/lib/format";
import { toast } from "sonner";

export default function ScreenerPage() {
  const [data, setData] = useState<any>(null);
  const [scanning, setScanning] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const { state } = useEngineState();
  const st = state?.settings ?? {};

  const load = () =>
    engineGet<any>("/candidates")
      .then(setData)
      .catch(() => {});

  useEffect(() => {
    load();
    const t = setInterval(load, 10000);
    return () => clearInterval(t);
  }, []);

  const rescan = async () => {
    setScanning(true);
    try {
      await enginePost("/bot/scan");
      toast.success("Скан запущен");
      setTimeout(load, 5000);
    } catch {
      toast.error("Не удалось запустить скан");
    } finally {
      setTimeout(() => setScanning(false), 3000);
    }
  };

  const enter = async (pool: string, name: string) => {
    setBusy(pool);
    try {
      const r = await enginePost<any>("/bot/enter", { pool });
      if (r?.ok) toast.success(`Вошли в ${name}`, { description: `капитал ${usd(r.plan?.capital ?? 0, 0)}` });
      else toast.error("Вход не выполнен", { description: String(r?.reason ?? "") });
    } catch (e: any) {
      toast.error("Ошибка входа", { description: String(e?.message ?? e) });
    } finally {
      setBusy(null);
    }
  };

  const candidates: any[] = data?.candidates ?? [];
  const freeSlots = state?.freeSlots ?? 0;

  const rules = [
    `V/TVL (сутки) ≥ ${st.minTurnover ?? 3}x`,
    `ATR(30м) ≤ ${st.maxAtrPct ?? 2}%`,
    `TVL пула ≥ ${usdCompact(st.minPoolTvl ?? 50_000)}`,
    "только пары с SOL",
    "freeze authority выключена",
    `возраст ≥ ${6} ч`,
    `объём за час ≥ ${usd(st.minVol1hUsd ?? 500, 0)}`,
    "капитал ≤ 20% ликвидности зоны",
    "нет падения −45% за сутки",
  ];

  return (
    <div className="mx-auto max-w-[1500px] space-y-4">
      <FadeIn>
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-[22px] font-semibold tracking-tight">Скринер пулов</h1>
            <p className="mt-0.5 text-[12px] text-muted">
              Оборот V/TVL — в какую монету входить, ATR — когда входить. Дальше сетка ±1.5×ATR и прогноз комиссий.
            </p>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-[11px] text-dim">
              последний скан: {data?.lastScanAt ? time(data.lastScanAt) : "—"}
            </span>
            <Chip tone={freeSlots > 0 ? "mint" : "neutral"}>
              слотов свободно {freeSlots}/{state?.maxPositions ?? 1}
            </Chip>
            <Button size="sm" onClick={rescan} disabled={scanning}>
              <RefreshCw className={`h-3.5 w-3.5 ${scanning ? "animate-spin" : ""}`} /> Сканировать
            </Button>
          </div>
        </div>
      </FadeIn>

      <FadeIn delay={0.04}>
        <Card className="p-4">
          <div className="flex items-center gap-2">
            <Radar className="h-4 w-4 text-accent2" />
            <div className="text-[12.5px] font-medium">Активные фильтры</div>
          </div>
          <div className="mt-2.5 flex flex-wrap gap-1.5">
            {rules.map((f) => (
              <span
                key={f}
                className="rounded-full border border-white/[0.06] bg-white/[0.03] px-2.5 py-1 text-[10.5px] text-muted"
              >
                {f}
              </span>
            ))}
          </div>
        </Card>
      </FadeIn>

      <div className="space-y-2.5">
        {candidates.map((c: any, i: number) => {
          const target = c.rDay >= (st.targetDailyPct ?? 2);
          const nearAtr = c.atrPct > (st.maxAtrPct ?? 2) * 0.8;
          return (
            <motion.div
              key={`${c.pool}-${i}`}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: Math.min(i * 0.04, 0.4) }}
            >
              <Card className="p-4">
                <div className="flex flex-wrap items-center gap-4">
                  <TokenIcon mint={c.tokenMint} symbol={c.tokenSymbol} size={42} rounded={13} href={meteoraPoolUrl(c.pool)} />
                  <div className="min-w-[170px] flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-[13px] font-medium">{c.poolName}</span>
                      {target ? (
                        <Chip tone="mint">
                          <CheckCircle2 className="h-3 w-3" /> выше цели
                        </Chip>
                      ) : (
                        <Chip tone="neutral">ниже цели</Chip>
                      )}
                      {nearAtr && (
                        <Chip tone="accent">
                          <AlertTriangle className="h-3 w-3" /> на грани ATR
                        </Chip>
                      )}
                    </div>
                    <div className="num mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-dim">
                      <span>TVL {usd(c.tvl, 0)}</span>
                      <span>· зона {usdCompact(c.tR)}</span>
                      <span>· актив {usdCompact(c.activeTvl)}</span>
                      <span>· 24ч {usdCompact(c.vol24)}</span>
                      <span>· час {usdCompact(c.vol1h)}</span>
                      <span>· коридор {pctPlain((c.inRangeShare ?? 1) * 100, 0)} объёма</span>
                    </div>
                  </div>

                  <div className="grid w-full grid-cols-2 gap-x-5 gap-y-2 sm:w-auto sm:grid-cols-3 lg:grid-cols-6">
                    <div>
                      <div className="flex items-center gap-1 text-[9.5px] uppercase tracking-wider text-dim">
                        <Activity className="h-2.5 w-2.5" /> оборот
                      </div>
                      <div className="num text-[13px] font-semibold text-ink">{turnover(c.turnover24)}</div>
                      <div className="num text-[9.5px] text-dim">час {turnover(c.turnover1h)}</div>
                    </div>
                    <div>
                      <div className="flex items-center gap-1 text-[9.5px] uppercase tracking-wider text-dim">
                        <Gauge className="h-2.5 w-2.5" /> ATR 30м
                      </div>
                      <div className={`num text-[13px] font-semibold ${nearAtr ? "text-accent2" : "text-ink"}`}>
                        {pctPlain(c.atrPct, 2)}
                      </div>
                      <div className="num text-[9.5px] text-dim">порог {pctPlain(st.maxAtrPct ?? 2, 1)}</div>
                    </div>
                    <div>
                      <div className="flex items-center gap-1 text-[9.5px] uppercase tracking-wider text-dim">
                        <Layers3 className="h-2.5 w-2.5" /> сетка
                      </div>
                      <div className="num text-[13px] font-semibold text-ink">±{pctPlain(c.rangePct, 2)}</div>
                      <div className="num text-[9.5px] text-dim">×{c.concentration} конц.</div>
                    </div>
                    <div>
                      <div className="text-[9.5px] uppercase tracking-wider text-dim">прогноз</div>
                      <div className={`num text-[13px] font-semibold ${target ? "text-mint" : "text-accent2"}`}>
                        {pctPlain(c.rDay, 2)}
                      </div>
                      <div className="num text-[9.5px] text-dim">{usd(c.expectedFees15h, 2)} / 15ч</div>
                    </div>
                    <div>
                      <div className="text-[9.5px] uppercase tracking-wider text-dim">нам в час</div>
                      <div className="num text-[13px] font-semibold text-mint">{usd(c.ourHourly ?? 0, 2)}</div>
                      <div className="num text-[9.5px] text-dim">
                        пул {usd(c.poolFees1h ?? 0, 0)}/ч · доля {pctPlain(c.ourSharePct ?? 0, 2)}
                      </div>
                    </div>
                    <div>
                      <div className="text-[9.5px] uppercase tracking-wider text-dim">просадка</div>
                      <div className="num text-[13px] font-semibold text-danger">−{pctPlain(c.worstLossPct ?? 0, 2)}</div>
                      <div className="num text-[9.5px] text-dim">до ребаланса</div>
                    </div>
                  </div>

                  <div className="w-full max-w-[132px]">
                    <div className="mb-1 flex justify-between text-[9.5px] text-dim">
                      <span>объём в зоне</span>
                      <span className="num">{pctPlain((c.inRangeShare ?? 0) * 100, 0)}</span>
                    </div>
                    <Progress value={(c.inRangeShare ?? 0) * 100} tone={target ? "mint" : "accent"} />
                  </div>

                  <Button
                    size="sm"
                    variant={freeSlots > 0 ? "accent" : "ghost"}
                    disabled={freeSlots <= 0 || busy === c.pool}
                    onClick={() => enter(c.pool, c.poolName)}
                    className="ml-auto"
                  >
                    {busy === c.pool ? "Входим…" : "Войти"} <ArrowRight className="h-3.5 w-3.5" />
                  </Button>
                </div>
                {c.notes?.length ? (
                  <div className="mt-2 text-[10px] text-dim">заметки: {c.notes.join(" · ")}</div>
                ) : null}
              </Card>
            </motion.div>
          );
        })}
        {!candidates.length && (
          <Card>
            <Muted>
              Кандидатов пока нет — движок ещё не завершил первый скан или ни один пул не проходит жёсткие фильтры
              (оборот V/TVL, ATR, TVL). Это нормально: лучше пропустить день, чем войти в шум.
            </Muted>
          </Card>
        )}
      </div>
    </div>
  );
}
