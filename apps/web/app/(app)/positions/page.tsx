"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowUpRight, ArrowDownRight, ChevronRight, Layers } from "lucide-react";
import { motion } from "framer-motion";
import { Card, Chip, Empty, FadeIn, Segmented, Skeleton } from "@/components/ui/kit";
import { TokenIcon } from "@/components/ui/token-icon";
import { EmptySlot, PositionCard } from "@/components/positions/position-card";
import { engineGet, enginePost, useEngineState } from "@/lib/api";
import { dateTime, hours, pct, pctPlain, priceSmart, reasonLabel, reasonTone, usd } from "@/lib/format";
import { toast } from "sonner";

type Filter = "open" | "closed" | "all";

export default function PositionsPage() {
  const [filter, setFilter] = useState<Filter>("all");
  const [rows, setRows] = useState<any[] | null>(null);
  const { state } = useEngineState();

  const load = () => {
    engineGet<any>(`/positions?status=${filter}&limit=80`)
      .then((d) => setRows(d.positions))
      .catch(() => setRows([]));
  };

  useEffect(() => {
    let alive = true;
    const run = () =>
      engineGet<any>(`/positions?status=${filter}&limit=80`)
        .then((d) => alive && setRows(d.positions))
        .catch(() => alive && setRows([]));
    run();
    const t = setInterval(run, 5000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [filter]);

  const close = async (id: number) => {
    try {
      await enginePost("/bot/close", { id });
      toast.success(`Позиция #${id} закрыта`);
      load();
    } catch {
      toast.error("Не удалось закрыть позицию");
    }
  };

  const open = (rows ?? []).filter((r) => r.status === "open");
  const closed = (rows ?? []).filter((r) => r.status !== "open");
  const livePositions: any[] = state?.positions ?? [];
  const slots = state?.maxPositions ?? 1;

  return (
    <div className="mx-auto max-w-[1500px] space-y-5">
      <FadeIn>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-[22px] font-semibold tracking-tight">Позиции</h1>
            <p className="mt-0.5 text-[12px] text-muted">
              Сетка ±range, сплит 50/50, ребалансы при пробое границ. Стоп — после серии убыточных ребалансов.
            </p>
          </div>
          <Segmented
            value={filter}
            onChange={(v) => setFilter(v as Filter)}
            options={[
              { value: "all", label: "Все" },
              { value: "open", label: "Открытые" },
              { value: "closed", label: "Закрытые" },
            ]}
          />
        </div>
      </FadeIn>

      {!rows ? (
        <div className="space-y-2">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-[120px]" />
          ))}
        </div>
      ) : (
        <>
          {/* ── открытые: карточки новой логики */}
          {filter !== "closed" && (
            <div className="space-y-2.5">
              <div className="flex items-center gap-2">
                <Layers className="h-4 w-4 text-accent2" />
                <span className="text-[13px] font-medium">В работе</span>
                <Chip tone={livePositions.length ? "accent" : "neutral"}>
                  {livePositions.length}/{slots}
                </Chip>
              </div>
              {livePositions.map((p, i) => (
                <PositionCard key={p.id} p={p} index={i} onClose={close} />
              ))}
              {Array.from({ length: Math.max(0, slots - livePositions.length) }).map((_, i) => (
                <EmptySlot key={`slot-${i}`} />
              ))}
              {!livePositions.length && (
                <Card>
                  <Empty
                    title="Свободные слоты"
                    hint="Бот сканирует рынок и войдёт, когда найдёт пул с оборотом V/TVL ≥ 3 и ATR ≤ 2%."
                    action={
                      <Link href="/screener" className="mt-2 text-[12px] text-accent2 hover:underline">
                        Посмотреть кандидатов →
                      </Link>
                    }
                  />
                </Card>
              )}
            </div>
          )}

          {/* ── закрытые */}
          {filter !== "open" && (
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <span className="text-[13px] font-medium">История</span>
                <Chip tone="neutral">{closed.length}</Chip>
              </div>
              {closed.map((p, i) => {
                const up = (p.pnl ?? 0) >= 0;
                return (
                  <motion.div
                    key={p.id}
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: Math.min(i * 0.02, 0.3) }}
                  >
                    <Link href={`/positions/${p.id}`}>
                      <Card className="group flex flex-wrap items-center gap-4 p-4 transition-colors hover:border-white/[0.12]">
                        <TokenIcon mint={p.tokenMint} symbol={p.tokenSymbol} size={42} rounded={13} />
                        <div className="min-w-[150px] flex-1">
                          <div className="flex items-center gap-2">
                            <span className="text-[13.5px] font-medium">{p.poolName}</span>
                            <Chip tone={reasonTone[p.exitReason] ?? "neutral"}>
                              {reasonLabel[p.exitReason] ?? p.exitReason ?? "закрыта"}
                            </Chip>
                          </div>
                          <div className="num mt-0.5 text-[11px] text-dim">
                            #{p.id} · капитал {usd(p.capital, 0)} · сетка ±{pctPlain((p.rangePct ?? 0) * 100, 2)} ·{" "}
                            {p.rebalances ?? 0} ребалансов
                          </div>
                        </div>

                        <div className="hidden min-w-[80px] md:block">
                          <div className="text-[10px] uppercase tracking-wider text-dim">Комиссии</div>
                          <div className="num text-[12.5px] text-mint">{(p.fees ?? 0) + (p.claimed ?? 0) ? usd((p.fees ?? 0) + (p.claimed ?? 0)) : "—"}</div>
                        </div>
                        <div className="hidden min-w-[90px] lg:block">
                          <div className="text-[10px] uppercase tracking-wider text-dim">Цена входа</div>
                          <div className="num text-[12px]">{priceSmart(p.entryPrice)}</div>
                        </div>
                        <div className="hidden min-w-[80px] lg:block">
                          <div className="text-[10px] uppercase tracking-wider text-dim">В сделке</div>
                          <div className="num text-[12.5px]">{hours(p.timeInTradeHours)}</div>
                        </div>
                        <div className="hidden min-w-[110px] xl:block">
                          <div className="text-[10px] uppercase tracking-wider text-dim">Закрыта</div>
                          <div className="num text-[11px] text-muted">{dateTime(p.closedAt)}</div>
                        </div>

                        <div className="ml-auto flex items-center gap-3">
                          <div className="text-right">
                            <div className={`num flex items-center justify-end gap-0.5 text-[14px] font-semibold ${up ? "text-mint" : "text-danger"}`}>
                              {up ? <ArrowUpRight className="h-3.5 w-3.5" /> : <ArrowDownRight className="h-3.5 w-3.5" />}
                              {usd(p.pnl ?? 0)}
                            </div>
                            <div className={`num text-[11px] ${up ? "text-mint/70" : "text-danger/70"}`}>
                              {pct(p.pnlPct ?? 0)} депозита
                            </div>
                          </div>
                          <ChevronRight className="h-4 w-4 text-dim transition-transform group-hover:translate-x-0.5" />
                        </div>
                      </Card>
                    </Link>
                  </motion.div>
                );
              })}
              {filter === "closed" && !closed.length && (
                <Card>
                  <Empty title="Пока нет закрытых сделок" hint="История появится после первого закрытия позиции." />
                </Card>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
