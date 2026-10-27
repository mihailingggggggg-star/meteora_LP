"use client";

import { useEffect, useState } from "react";
import { Save, ShieldAlert, Wallet, Server, Target, Gauge, Radar, Split, Repeat } from "lucide-react";
import { Button, Card, Chip, FadeIn, Muted } from "@/components/ui/kit";
import { ConnectWallet } from "@/components/wallet/connect-wallet";
import { enginePost, useEngineState } from "@/lib/api";
import { pctPlain, usd } from "@/lib/format";
import { toast } from "sonner";

function Field({
  label,
  hint,
  value,
  min,
  max,
  step,
  suffix,
  onChange,
}: {
  label: string;
  hint?: string;
  value: number;
  min: number;
  max: number;
  step: number;
  suffix?: string;
  onChange: (v: number) => void;
}) {
  return (
    <div className="border-b border-white/[0.05] py-3 last:border-0">
      <div className="flex items-center justify-between gap-2">
        <div className="text-[12.5px] text-ink/90">{label}</div>
        <div className="num shrink-0 text-[12.5px] font-semibold text-accent2">
          {value}
          {suffix}
        </div>
      </div>
      {hint ? <div className="mt-0.5 text-[10.5px] leading-snug text-dim">{hint}</div> : null}
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="mt-2 h-1 w-full appearance-none rounded-full bg-white/[0.08] accent-[#ff7a18]"
      />
    </div>
  );
}

function Section({ icon, title, children }: { icon: React.ReactNode; title: string; children: React.ReactNode }) {
  return (
    <div className="mt-3">
      <div className="flex items-center gap-2 border-b border-white/[0.06] pb-1.5">
        <span className="text-accent2">{icon}</span>
        <span className="text-[11px] font-medium uppercase tracking-[0.12em] text-dim">{title}</span>
      </div>
      {children}
    </div>
  );
}

export default function SettingsPage() {
  const { state } = useEngineState();
  const [form, setForm] = useState<any>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (state?.settings && !form) setForm(state.settings);
  }, [state, form]);

  const set = (patch: Record<string, number>) => setForm({ ...form, ...patch });

  const save = async () => {
    setSaving(true);
    try {
      await enginePost("/settings", form);
      toast.success("Настройки сохранены", { description: "Применятся со следующего скана" });
    } catch {
      toast.error("Не удалось сохранить");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="mx-auto max-w-[1180px] space-y-4">
      <FadeIn>
        <div>
          <h1 className="text-[22px] font-semibold tracking-tight">Настройки</h1>
          <p className="mt-0.5 text-[12px] text-muted">
            Все параметры новой стратегии: отбор пулов, вход, ребалансы и защита капитала.
          </p>
        </div>
      </FadeIn>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <FadeIn delay={0.03}>
          <Card>
            <div className="flex items-center gap-2">
              <Gauge className="h-4 w-4 text-accent2" />
              <div className="text-[13px] font-medium">Стратегия и риск</div>
              <Chip tone="accent" className="ml-auto">
                сетка ±{(form?.maxRangePct ?? 5) / 2}% · 50/50
              </Chip>
            </div>

            {form ? (
              <div className="mt-1">
                <Section icon={<Radar className="h-3.5 w-3.5" />} title="Фаза 1 · отбор пула">
                  <Field
                    label="Оборот V/TVL (сутки)"
                    hint="сколько раз TVL обернулся за сутки — «в какую монету входить»"
                    value={form.minTurnover}
                    min={1}
                    max={20}
                    step={0.5}
                    suffix="x"
                    onChange={(v) => set({ minTurnover: v })}
                  />
                  <Field
                    label="Волатильность ATR(30м,14)"
                    hint="жёсткий стоп-кран: выше порога пул не рассматривается"
                    value={form.maxAtrPct}
                    min={0.5}
                    max={5}
                    step={0.1}
                    suffix="%"
                    onChange={(v) => set({ maxAtrPct: v })}
                  />
                  <Field
                    label="Минимальный TVL пула"
                    hint="защита от дикого проскальзывания при свопах"
                    value={form.minPoolTvl}
                    min={10_000}
                    max={500_000}
                    step={5_000}
                    suffix=" $"
                    onChange={(v) => set({ minPoolTvl: v })}
                  />
                  <Field
                    label="Минимальный объём за час"
                    hint="«когда входить»: пул должен быть живым прямо сейчас"
                    value={form.minVol1h}
                    min={100}
                    max={20_000}
                    step={100}
                    suffix=" $"
                    onChange={(v) => set({ minVol1h: v })}
                  />
                  <Field
                    label="Минимальный возраст пула"
                    hint="молодые пулы отсекаются — там ещё снайперы"
                    value={form.minAgeHours}
                    min={1}
                    max={72}
                    step={1}
                    suffix=" ч"
                    onChange={(v) => set({ minAgeHours: v })}
                  />
                </Section>

                <Section icon={<Split className="h-3.5 w-3.5" />} title="Фаза 2 · вход">
                  <div className="flex items-center justify-between gap-2 border-b border-white/[0.05] py-3">
                    <div>
                      <div className="text-[12.5px] text-ink/90">Распределение капитала по бинам</div>
                      <div className="mt-0.5 text-[10.5px] leading-snug text-dim">
                        spot — колокол у цены (как в Meteora), curve — тяжелее к краям, uniform — ровно
                      </div>
                    </div>
                    <select
                      value={form.distribution ?? "spot"}
                      onChange={(e) => setForm({ ...form, distribution: e.target.value })}
                      className="shrink-0 rounded-lg border border-white/[0.08] bg-white/[0.04] px-2 py-1.5 text-[11.5px] text-ink focus:border-accent/50 focus:outline-none"
                    >
                      <option value="spot">spot</option>
                      <option value="curve">curve</option>
                      <option value="uniform">uniform</option>
                    </select>
                  </div>
                  <Field
                    label="Бюджет на позицию"
                    hint="доля депозита; сплит внутри всегда 50/50 SOL/токен"
                    value={form.budgetPct}
                    min={10}
                    max={100}
                    step={5}
                    suffix="%"
                    onChange={(v) => set({ budgetPct: v })}
                  />
                  <Field
                    label="Множитель ATR для сетки"
                    hint="полуширина = ATR × множитель (1.5 = ±1.5×ATR)"
                    value={form.rangeAtrMult}
                    min={0.5}
                    max={3}
                    step={0.1}
                    suffix="×"
                    onChange={(v) => set({ rangeAtrMult: v })}
                  />
                  <Field
                    label="Максимальный диапазон"
                    hint="потолок полуширины сетки в процентах"
                    value={form.maxRangePct}
                    min={1}
                    max={10}
                    step={0.5}
                    suffix="%"
                    onChange={(v) => set({ maxRangePct: v })}
                  />
                </Section>

                <Section icon={<Repeat className="h-3.5 w-3.5" />} title="Фаза 4 · ребаланс">
                  <Field
                    label="Максимум ребалансов в сутки"
                    hint="после лимита бот выходит и ищет другой пул"
                    value={form.maxRebalancesPerDay}
                    min={2}
                    max={16}
                    step={1}
                    suffix=""
                    onChange={(v) => set({ maxRebalancesPerDay: v })}
                  />
                  <Field
                    label="Издержки свопа (friction)"
                    hint="газ + проскальзывание при обратном свопе 50%"
                    value={form.frictionPct}
                    min={0.05}
                    max={1}
                    step={0.05}
                    suffix="%"
                    onChange={(v) => set({ frictionPct: v })}
                  />
                  <Field
                    label="Стоп после серии убыточных ребалансов"
                    hint="признак тренда, а не флэта — сбрасываем в SOL"
                    value={form.consecutiveLossStop}
                    min={2}
                    max={6}
                    step={1}
                    suffix=""
                    onChange={(v) => set({ consecutiveLossStop: v })}
                  />
                  <Field
                    label="Максимальное время в сделке"
                    hint="после этого — ротация в другой пул"
                    value={form.maxHoldHours}
                    min={4}
                    max={72}
                    step={1}
                    suffix=" ч"
                    onChange={(v) => set({ maxHoldHours: v })}
                  />
                </Section>

                <Section icon={<ShieldAlert className="h-3.5 w-3.5" />} title="Фаза 5 · защита капитала">
                  <Field
                    label="Максимальный убыток в сделке"
                    hint="ограничивает капитал позиции через риск на диапазон"
                    value={form.maxLossPerTradePct}
                    min={1}
                    max={10}
                    step={0.5}
                    suffix="% депозита"
                    onChange={(v) => set({ maxLossPerTradePct: v })}
                  />
                  <Field
                    label="Дневной лимит убытка"
                    hint="если за сутки потеряли больше — новые входы останавливаются до завтра"
                    value={form.maxDailyLossPct}
                    min={2}
                    max={20}
                    step={0.5}
                    suffix="% депозита"
                    onChange={(v) => set({ maxDailyLossPct: v })}
                  />
                  <Field
                    label="Досрочный выход по ATR"
                    hint="если волатильность разгоняется выше — выходим"
                    value={form.earlyExitAtrPct}
                    min={2}
                    max={8}
                    step={0.1}
                    suffix="%"
                    onChange={(v) => set({ earlyExitAtrPct: v })}
                  />
                  <Field
                    label="Досрочный выход по обороту"
                    hint="если V/TVL падает ниже — пул остыл"
                    value={form.earlyExitTurnover}
                    min={0.2}
                    max={3}
                    step={0.1}
                    suffix="x"
                    onChange={(v) => set({ earlyExitTurnover: v })}
                  />
                  <Field
                    label="Фиксация прибыли на вехе"
                    hint="доля прибыли, которая откладывается при росте депозита"
                    value={form.profitTakePct}
                    min={0}
                    max={100}
                    step={5}
                    suffix="%"
                    onChange={(v) => set({ profitTakePct: v })}
                  />
                  <Field
                    label="Цель доходности"
                    hint="ориентир «выше цели» в скринере и цель дня на дашборде"
                    value={form.targetDailyPct}
                    min={0.5}
                    max={5}
                    step={0.1}
                    suffix="% / день"
                    onChange={(v) => set({ targetDailyPct: v })}
                  />
                  <Field
                    label="Интервал сканирования"
                    hint="как часто искать пулы (секунды)"
                    value={form.scanIntervalSeconds}
                    min={20}
                    max={300}
                    step={5}
                    suffix=" сек"
                    onChange={(v) => set({ scanIntervalSeconds: v })}
                  />
                  <Field
                    label="Позиций одновременно (до $10k)"
                    hint="в новой логике по умолчанию 1; при депозите $10k+ включается диверсификация"
                    value={form.maxPositions}
                    min={1}
                    max={6}
                    step={1}
                    suffix=""
                    onChange={(v) => set({ maxPositions: v })}
                  />
                </Section>

                <Button className="mt-3 w-full" onClick={save} disabled={saving}>
                  <Save className="h-4 w-4" /> {saving ? "Сохраняем…" : "Сохранить"}
                </Button>
              </div>
            ) : (
              <Muted>Загрузка…</Muted>
            )}
          </Card>
        </FadeIn>

        <div className="space-y-4">
          <FadeIn delay={0.06}>
            <Card>
              <div className="flex items-center gap-2">
                <Target className="h-4 w-4 text-mint" />
                <div className="text-[13px] font-medium">Контур</div>
              </div>
              <div className="mt-3 space-y-2.5 text-[12px]">
                <div className="flex items-center justify-between">
                  <span className="text-muted">Режим</span>
                  <Chip tone={state?.mode === "live" ? "mint" : "accent"}>{state?.mode ?? "demo"}</Chip>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-muted">Депозит</span>
                  <span className="num">{usd(state?.deposit ?? 0, 0)}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-muted">Слоты</span>
                  <span className="num">
                    {(state?.positions ?? []).length}/{state?.maxPositions ?? 1}
                    {state?.deposit >= (state?.diversifyFromUsd ?? 10_000) ? " · диверсификация" : ""}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-muted">Бот</span>
                  <span className={state?.running ? "text-mint" : "text-danger"}>
                    {state?.halted ? "остановлен (лимит)" : state?.running ? "работает" : "пауза"}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-muted">Время в сделке</span>
                  <span className="num">{state?.settings?.maxHoldHours ?? 24} ч макс.</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-muted">Сбор комиссий</span>
                  <span className="num">
                    каждые {state?.settings?.claimIntervalHours ?? 2} ч / {pctPlain(state?.settings?.claimThresholdPct ?? 0.5, 1)} капитала
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-muted">Отложено на холодный кошелёк</span>
                  <span className="num text-accent2">{usd(state?.bankedTotal ?? 0)}</span>
                </div>
              </div>
              <div className="mt-4 flex gap-2">
                <Button
                  variant="ghost"
                  size="sm"
                  className="flex-1"
                  onClick={async () => {
                    await enginePost("/bot/stop");
                    toast.success("Бот на паузе");
                  }}
                >
                  Пауза
                </Button>
                <Button
                  variant="mint"
                  size="sm"
                  className="flex-1"
                  onClick={async () => {
                    await enginePost("/bot/start");
                    toast.success("Бот запущен");
                  }}
                >
                  Запустить
                </Button>
              </div>
            </Card>
          </FadeIn>

          <FadeIn delay={0.09}>
            <Card>
              <div className="flex items-center gap-2">
                <Wallet className="h-4 w-4 text-accent2" />
                <div className="text-[13px] font-medium">Кошелёк</div>
              </div>
              <p className="mt-1.5 text-[11.5px] leading-relaxed text-muted">
                Подключение как в Meteora: нажмите «Привязать кошелёк» — откроется окно Phantom, вы
                подтверждаете подключение и подпись. Адрес привязывается к аккаунту, вывод средств
                требует подписи.
              </p>
              <div className="mt-3">
                <ConnectWallet />
              </div>
              <div className="mt-3 flex items-start gap-2 rounded-xl border border-accent/20 bg-accent/[0.07] px-3 py-2">
                <ShieldAlert className="mt-0.5 h-3.5 w-3.5 shrink-0 text-accent2" />
                <div className="text-[10.5px] leading-relaxed text-muted">
                  Боевой контур подписывает сделки отдельным торговым кошельком (ключ только на сервере).
                  Phantom нужен для входа, подтверждений и вывода.
                </div>
              </div>
            </Card>
          </FadeIn>

          <FadeIn delay={0.12}>
            <Card>
              <div className="flex items-center gap-2">
                <Server className="h-4 w-4 text-muted" />
                <div className="text-[13px] font-medium">Инфраструктура</div>
              </div>
              <div className="mt-3 space-y-2 text-[11.5px]">
                <div className="flex items-center justify-between">
                  <span className="text-muted">RPC</span>
                  <span className="text-mint">Helius mainnet</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-muted">Данные</span>
                  <span className="text-ink/80">Meteora Data API · GeckoTerminal</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-muted">Ребаланс / выход</span>
                  <span className="text-ink/80">своп через Jupiter</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-muted">Публичный адрес</span>
                  <span className="text-ink/80">localhost:3000</span>
                </div>
              </div>
              <Muted className="mt-3">
                Демо сбрасывается кнопкой ниже — история и журнал очищаются, депозит снова{" "}
                {usd(state?.deposit ?? 500, 0)}.
              </Muted>
              <Button
                variant="outline"
                size="sm"
                className="mt-3 w-full"
                onClick={async () => {
                  await enginePost("/bot/reset");
                  toast.success("Демо-контур сброшен");
                }}
              >
                Сбросить демо-контур
              </Button>
            </Card>
          </FadeIn>
        </div>
      </div>
    </div>
  );
}
