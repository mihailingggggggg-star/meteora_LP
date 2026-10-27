"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import {
  ArrowDownRight,
  ArrowUpRight,
  ExternalLink,
  Filter,
  Radio,
  Waves,
  Wallet,
} from "lucide-react";
import { Button, Card, Chip, FadeIn, Muted, Segmented, Skeleton } from "@/components/ui/kit";
import { TokenIcon } from "@/components/ui/token-icon";
import { engineGet } from "@/lib/api";
import { pctPlain, price, shortAddr, usd, usdCompact } from "@/lib/format";

type Label = "creator" | "sniper" | "insider" | "bundler" | "whale" | "influencer";

const LABELS: Record<Label, { text: string; color: string; hint: string }> = {
  creator: {
    text: "Создатель",
    color: "bg-[#ff7a18]/15 text-[#ffb347] border-[#ff7a18]/25",
    hint: "Адрес из Metaplex-метаданных токена (authority/создатель контракта)",
  },
  sniper: {
    text: "Снайпер",
    color: "bg-[#ff5f56]/15 text-[#ff8a84] border-[#ff5f56]/25",
    hint: "Первая покупка в течение 60 секунд после создания пула",
  },
  insider: {
    text: "Инсайдер",
    color: "bg-[#b18cff]/15 text-[#c9b2ff] border-[#b18cff]/25",
    hint: "Первая покупка в первые 10 минут после создания пула (не снайпер)",
  },
  bundler: {
    text: "Бандлер",
    color: "bg-[#ffb347]/15 text-[#ffc978] border-[#ffb347]/25",
    hint: "≥3 разных кошелька купили в одном слоте — похоже на bundle-транзакцию",
  },
  whale: {
    text: "Кит",
    color: "bg-[#35e0a1]/15 text-[#7ff0c4] border-[#35e0a1]/25",
    hint: "Размер сделки ≥ $400 (порог WHALE_USD в .env)",
  },
  influencer: {
    text: "Инфлюенсер",
    color: "bg-[#ff7ac2]/15 text-[#ffa8d6] border-[#ff7ac2]/25",
    hint: "Адрес есть в вашем списке data/influencers.json",
  },
};

const LABEL_ORDER: Label[] = ["creator", "sniper", "insider", "bundler", "whale", "influencer"];

function Labels({ labels }: { labels: string[] }) {
  if (!labels.length) return null;
  return (
    <div className="flex flex-wrap items-center gap-1">
      {LABEL_ORDER.filter((l) => labels.includes(l)).map((l) => {
        const cfg = LABELS[l];
        return (
          <span
            key={l}
            title={cfg.hint}
            className={`cursor-help rounded-full border px-1.5 py-[2px] text-[9.5px] font-medium leading-none ${cfg.color}`}
          >
            {cfg.text}
          </span>
        );
      })}
    </div>
  );
}

export default function SwapsPage() {
  const [pools, setPools] = useState<any[]>([]);
  const [pool, setPool] = useState<string>("");
  const [side, setSide] = useState<"all" | "buy" | "sell">("all");
  const [label, setLabel] = useState<string>("");
  const [minUsd, setMinUsd] = useState<number>(0);
  const [data, setData] = useState<any>(null);
  const [connected, setConnected] = useState(true);

  useEffect(() => {
    engineGet<any>("/swaps/pools")
      .then((d) => {
        setPools(d.pools ?? []);
        setPool((prev) => prev || d.pools?.[0]?.address || "");
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!pool) return;
    let alive = true;
    const load = async () => {
      try {
        const d = await engineGet<any>(`/swaps?pool=${pool}&limit=200${side !== "all" ? `&side=${side}` : ""}${label ? `&label=${label}` : ""}`);
        if (alive) {
          setData(d);
          setConnected(!!d?.stream?.connected);
        }
      } catch {
        if (alive) setConnected(false);
      }
    };
    load();
    const t = setInterval(load, 3000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [pool, side, label]);

  const rows = useMemo(
    () => (data?.swaps ?? []).filter((s: any) => s.valueUsd >= minUsd),
    [data, minUsd],
  );
  const current = pools.find((p) => p.address === pool);
  const stats = data?.stats ?? {};

  return (
    <div className="mx-auto max-w-[1500px] space-y-3.5">
      <FadeIn>
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-[22px] font-semibold tracking-tight">Свапы</h1>
            <p className="mt-0.5 text-[12px] text-muted">
              Каждая сделка пула с разметкой кошельков: снайперы, инсайдеры, бандлы, киты.
            </p>
          </div>
          <div className="flex items-center gap-2 text-[11px]">
            <span className={`flex items-center gap-1.5 ${connected ? "text-mint" : "text-accent2"}`}>
              <span className={`h-1.5 w-1.5 rounded-full ${connected ? "bg-mint pulse-dot" : "bg-accent pulse-dot"}`} />
              {connected ? "websocket · реальное время" : "поллинг (WS переподключается)"}
            </span>
          </div>
        </div>
      </FadeIn>

      <FadeIn delay={0.03}>
        <Card className="flex flex-wrap items-center gap-2 p-3.5">
          <div className="flex min-w-0 flex-1 items-center gap-2">
            <Waves className="h-4 w-4 shrink-0 text-accent2" />
            {pool ? (
              <div className="flex min-w-0 items-center gap-2">
                <TokenIcon mint={undefined} symbol={current?.symbol} size={26} rounded={8} />
                <select
                  value={pool}
                  onChange={(e) => setPool(e.target.value)}
                  className="min-w-0 max-w-[260px] truncate rounded-lg border border-white/[0.08] bg-white/[0.03] px-2 py-1.5 text-[12px] text-ink focus:border-accent/50 focus:outline-none"
                >
                  {pools.map((p) => (
                    <option key={p.address} value={p.address}>
                      {p.name} {p.active ? "· в сделке" : ""}
                    </option>
                  ))}
                </select>
                <Link href={`/positions`} className="hidden text-[11px] text-dim hover:text-ink sm:block">
                  {shortAddr(pool, 4)}
                </Link>
              </div>
            ) : (
              <Muted>Нет пула для наблюдения — откройте позицию</Muted>
            )}
          </div>

          <Segmented
            value={side}
            onChange={(v) => setSide(v as any)}
            options={[
              { value: "all", label: "Все" },
              { value: "buy", label: "Покупки" },
              { value: "sell", label: "Продажи" },
            ]}
          />
          <div className="flex items-center gap-1.5 rounded-full border border-white/[0.06] bg-white/[0.03] px-2.5 py-1.5">
            <Filter className="h-3 w-3 text-dim" />
            <input
              type="number"
              value={minUsd || ""}
              placeholder="от $"
              onChange={(e) => setMinUsd(Number(e.target.value) || 0)}
              className="w-[62px] bg-transparent text-[11.5px] text-ink placeholder:text-dim focus:outline-none"
            />
          </div>
        </Card>
      </FadeIn>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[
          { label: "Покупки", value: usdCompact(stats.buyVolume ?? 0), sub: `${stats.buys ?? 0} сделок`, tone: "text-mint" },
          { label: "Продажи", value: usdCompact(stats.sellVolume ?? 0), sub: `${stats.sells ?? 0} сделок`, tone: "text-danger" },
          { label: "Кошельки", value: stats.wallets ?? 0, sub: "уникальных", tone: "text-ink" },
          { label: "Киты", value: stats.whales ?? 0, sub: "крупных сделок", tone: "text-accent2" },
        ].map((s, i) => (
          <FadeIn key={s.label} delay={0.04 + i * 0.02}>
            <Card className="p-4">
              <div className="text-[10.5px] uppercase tracking-[0.14em] text-dim">{s.label}</div>
              <div className={`num mt-1 text-[20px] font-semibold ${s.tone}`}>{s.value}</div>
              <div className="mt-0.5 text-[10.5px] text-muted">{s.sub}</div>
            </Card>
          </FadeIn>
        ))}
      </div>

      <FadeIn delay={0.12}>
        <Card className="p-0">
          <div className="flex flex-wrap items-center gap-1.5 border-b border-white/[0.05] p-3">
            <span className="mr-1 text-[11px] text-dim">Метки:</span>
            {LABEL_ORDER.map((l) => (
              <button
                key={l}
                title={LABELS[l].hint}
                onClick={() => setLabel(label === l ? "" : l)}
                className={`rounded-full border px-2 py-[3px] text-[10px] transition ${
                  label === l ? LABELS[l].color : "border-white/[0.06] bg-white/[0.02] text-dim hover:text-muted"
                }`}
              >
                {LABELS[l].text}
              </button>
            ))}
            {label && (
              <button onClick={() => setLabel("")} className="ml-1 text-[10px] text-dim hover:text-ink">
                сбросить
              </button>
            )}
            <span className="ml-auto flex items-center gap-1 text-[10px] text-dim">
              <Radio className="h-3 w-3" /> WS + обновление 3 с
            </span>
          </div>

          <div className="hidden grid-cols-[80px_70px_110px_1fr_140px_90px_28px] gap-2 border-b border-white/[0.05] px-4 py-2 text-[10px] uppercase tracking-wider text-dim lg:grid">
            <span>Время</span>
            <span>Тип</span>
            <span className="text-right">Сумма</span>
            <span className="pl-2">Кошелёк</span>
            <span>Метки</span>
            <span className="text-right">Цена</span>
            <span />
          </div>

          <div className="max-h-[62vh] overflow-auto">
            {!data ? (
              <div className="space-y-2 p-3">
                {[0, 1, 2, 3, 4].map((i) => (
                  <Skeleton key={i} className="h-[46px]" />
                ))}
              </div>
            ) : rows.length === 0 ? (
              <div className="p-6">
                <Muted>
                  Сделок пока нет. Движок подписан на пул и разбирает новые транзакции — первые строки появятся
                  в течение нескольких секунд после первого свопа.
                </Muted>
              </div>
            ) : (
              rows.map((s: any, i: number) => {
                const buy = s.side === "buy";
                return (
                  <motion.div
                    key={s.sig}
                    initial={{ opacity: 0, y: 4 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: Math.min(i * 0.012, 0.25) }}
                    className="grid grid-cols-2 items-center gap-2 border-b border-white/[0.03] px-4 py-2.5 transition hover:bg-white/[0.02] lg:grid-cols-[80px_70px_110px_1fr_140px_90px_28px]"
                  >
                    <span className="num text-[11px] text-dim">
                      {new Date(s.ts * 1000).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
                    </span>
                    <span
                      className={`inline-flex w-[58px] items-center justify-center gap-0.5 rounded-full border px-1.5 py-[2px] text-[10px] font-medium ${
                        buy
                          ? "border-mint/25 bg-mint/10 text-mint"
                          : "border-danger/25 bg-danger/10 text-danger"
                      }`}
                    >
                      {buy ? <ArrowDownRight className="h-3 w-3" /> : <ArrowUpRight className="h-3 w-3" />}
                      {buy ? "buy" : "sell"}
                    </span>
                    <span className={`num text-[12.5px] font-semibold lg:text-right ${buy ? "text-mint" : "text-danger"}`}>
                      {usd(s.valueUsd, 2)}
                    </span>
                    <span className="num flex items-center gap-1.5 text-[11px] text-muted lg:pl-2">
                      <Wallet className="h-3 w-3 text-dim" />
                      {shortAddr(s.wallet, 4)}
                    </span>
                    <div className="col-span-2 lg:col-span-1">
                      <Labels labels={s.labels} />
                    </div>
                    <span className="num text-[11px] text-muted lg:text-right">{price(s.priceUsd)}</span>
                    <a
                      href={`https://solscan.io/tx/${s.sig}`}
                      target="_blank"
                      rel="noreferrer"
                      className="hidden justify-end text-dim transition hover:text-ink lg:flex"
                      title="Открыть в Solscan"
                    >
                      <ExternalLink className="h-3.5 w-3.5" />
                    </a>
                  </motion.div>
                );
              })
            )}
          </div>
        </Card>
      </FadeIn>

      <FadeIn delay={0.16}>
        <Card className="p-3.5">
          <div className="text-[11px] text-dim">
            Как читать метки: это <span className="text-muted">эвристики по данным цепи</span>, а не гарантия.
            «Снайпер» и «Инсайдер» определяются по времени первой покупки относительно создания пула,
            «Бандлер» — по нескольким кошелькам в одном слоте, «Кит» — по размеру сделки, «Создатель» — по
            authority токена из метаданных, «Инфлюенсер» — только по вашему списку{" "}
            <span className="num text-muted">data/influencers.json</span>.
          </div>
        </Card>
      </FadeIn>
    </div>
  );
}
