"use client";

import { useEffect, useState } from "react";
import { RefreshCw, FileText } from "lucide-react";
import { Button, Card, FadeIn, Muted } from "@/components/ui/kit";
import { engineGet } from "@/lib/api";

/** Локальная дата (журнал движка пишется по локальному времени, не по UTC). */
const localDate = (d = new Date()) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

const COLORS: Record<string, string> = {
  ENTER: "text-mint",
  REBALANCE: "text-accent2",
  FILL: "text-muted",
  CONSECUTIVE_LOSS: "text-danger",
  MAX_REBALANCES: "text-danger",
  EXIT_VOLATILITY: "text-danger",
  EXIT_FLOW: "text-danger",
  SUMMARY: "text-ink/70",
  SKIP: "text-dim",
  WS: "text-dim",
  DUPLICATE: "text-dim",
  MANUAL: "text-muted",
  STOP: "text-danger",
  EXIT_UP: "text-accent2",
  EXIT_TIME: "text-accent2",
  CLAIM: "text-mint",
  WARN: "text-accent2",
  ERROR: "text-danger",
  HALT: "text-danger",
  SCAN: "text-muted",
  SCORE: "text-ink/80",
  REJECT: "text-dim",
  BOOT: "text-muted",
  MOVE: "text-accent2",
};

export default function JournalPage() {
  const [date, setDate] = useState(() => localDate());
  const [lines, setLines] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  const load = async () => {
    setBusy(true);
    try {
      const d = await engineGet<any>(`/journal?date=${date}`);
      setLines(d.lines ?? []);
    } catch {
      setLines([]);
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    load();
    const t = setInterval(load, 6000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [date]);

  return (
    <div className="mx-auto max-w-[1500px] space-y-4">
      <FadeIn>
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-[22px] font-semibold tracking-tight">Журнал бота</h1>
            <p className="mt-0.5 text-[12px] text-muted">
              Каждое действие записано в markdown + jsonl. Этот файл можно отдать ИИ для анализа и улучшений.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="rounded-lg border border-white/[0.08] bg-white/[0.03] px-2.5 py-1.5 text-[12px] text-ink focus:border-accent/50 focus:outline-none"
            />
            <Button size="sm" variant="ghost" onClick={load}>
              <RefreshCw className={`h-3.5 w-3.5 ${busy ? "animate-spin" : ""}`} /> Обновить
            </Button>
          </div>
        </div>
      </FadeIn>

      <FadeIn delay={0.05}>
        <Card className="p-0">
          <div className="flex items-center gap-2 border-b border-white/[0.05] px-4 py-3">
            <FileText className="h-4 w-4 text-muted" />
            <span className="num text-[11.5px] text-muted">journal/{date}.md</span>
            <span className="ml-auto text-[10.5px] text-dim">{lines.length} строк</span>
          </div>
          <div className="max-h-[68vh] overflow-auto p-4">
            {lines.length ? (
              <pre className="num m-0 whitespace-pre-wrap break-words font-mono text-[11.5px] leading-relaxed">
                {lines.map((l, i) => {
                  const type = l.match(/\]\s+([A-Z_]+)/)?.[1] ?? "";
                  return (
                    <div key={i} className={COLORS[type] ?? "text-muted"}>
                      {l}
                    </div>
                  );
                })}
              </pre>
            ) : (
              <Muted>За эту дату записей нет. Журнал появится, как только движок начнёт работу.</Muted>
            )}
          </div>
        </Card>
      </FadeIn>
    </div>
  );
}
