# 04 · Архитектура

## 1. Стек (только готовые, проверенные проекты)

**Монорепо (pnpm workspaces):**

```
apps/
  web/       Next.js 15 (App Router) + TypeScript — интерфейс, PWA, прокси к движку
  engine/    Node 22 + TypeScript (Fastify + WebSocket) — скринер, стратегия, исполнение, аналитика
packages/
  shared/    типы, формулы (P_avg, worstLoss, R_day), клиенты Meteora/Gecko/DexScreener/Jupiter
```

| Слой | Выбор | GitHub |
|---|---|---|
| UI-компоненты | **shadcn/ui** (Radix + Tailwind) | `shadcn-ui/ui` |
| KPI-карточки, продвинутые графики дашборда | **Tremor** (готовые Area/Bar/Donut/KPI) | `tremorlabs/tremor` |
| График свечей + сетки + профиль объёма | **TradingView Lightweight Charts** (Apache-2.0) | `tradingview/lightweight-charts` |
| Простые графики | **Recharts** (через shadcn `Chart`) | `recharts/recharts` |
| Таблицы (позиции, скринер) | **TanStack Table** + shadcn `DataTable` | `TanStack/table` |
| Мобильные bottom-sheet | **Vaul** (через shadcn `Drawer`) | `emilkowalski/vaul` |
| Тосты | **Sonner** | `emilkowalski/sonner` |
| Тёмная тема | **next-themes** | `pacocoursey/next-themes` |
| Иконки | **Lucide** | `lucide-icons/lucide` |
| Формы/валидация | **react-hook-form + zod** | `react-hook-form/react-hook-form` |
| Данные на клиенте | **TanStack Query** | `TanStack/query` |
| PWA | **@ducanh2912/next-pwa** | `shadowwalker/next-pwa` → форк `@ducanh2912` |
| Кошелёк | **@solana/wallet-adapter** + Phantom (injected) | `anza-xyz/wallet-adapter` |
| DLMM | **@meteora-ag/dlmm** (1.9.14) + **@solana/web3.js** | `MeteoraAg/dlmm-sdk` |
| Подпись/SIWS | **tweetnacl + bs58** | `dchest/tweetnacl-js` |
| Пароли/сессии | **argon2 + jose (JWT)** | — |
| БД | **SQLite + Drizzle ORM** (`better-sqlite3`) | `drizzle-team/drizzle-orm` |
| Логи | **pino** + pino-pretty | `pinojs/pino` |

Дизайн — **строго по вашим референсам** (жду скриншоты ПК + мобилки). Из компонентов собираем, свои «дизайны» не выдумываем.
Пока референсов нет — беру shadcn/ui + Tremor в тёмной теме (это нейтральная база, легко перекрасить).

## 2. Процессы и сеть

```
┌────────────── Cloudflare (named tunnel, lp.<домен>) ──────────────┐
│  Cloudflare Access: email OTP / allowlist (внешний пароль)        │
└───────────────────────────┬───────────────────────────────────────┘
                            ▼
              apps/web  Next.js  :3000  (слушает 127.0.0.1)
                 │  /api/*  → прокси с проверкой cookie-сессии
                 ▼
              apps/engine  Fastify :8787  (слушает 127.0.0.1, наружу НЕ смотрит)
                 ├── screener (каждые 60 с)  ← Meteora Data API, GeckoTerminal, DexScreener
                 ├── strategy (решение по модели)
                 ├── executor (demo | live)
                 ├── pricing (WebSocket/RPC поток цен, ≤250 мс)
                 ├── analytics (агрегации, кэш)
                 └── journal (md + jsonl)
```

Движок никогда не публикуется сам: снаружи виден только Next.js. Ключи и приватный ключ кошелька живут в процессе `engine`.

## 3. Демо и боевой контур — один код, два адаптера

```ts
interface ExecutionAdapter {
  openPosition(p: PositionPlan): Promise<PositionId>;   // 2 зоны, BidAsk, one-sided SOL
  claimFees(id: PositionId): Promise<ClaimResult>;
  closeZone(id: PositionId, zone: 1 | 2): Promise<void>;
  emergencyExit(id: PositionId): Promise<ExitResult>;   // продажа токена в SOL
  getState(id: PositionId): Promise<OnChainPositionState>;
}
```

- `LiveAdapter` — реальные транзакции `@meteora-ag/dlmm` + Jupiter для выхода.
- `PaperAdapter` — **та же математика, реальные данные**: реальные бины и их ликвидность с цепи, реальные комиссии, реальный объём, реальная котировка Jupiter для «продажи», реальные priority fee и слиппедж. Отличие только одно: транзакция не отправляется, а состояние позиции пересчитывается по той же логике бинов (сколько SOL→токен на каждом бине при движении цены).
- Демо-депозит: **$500** (настраиваемо). Демо пишет всё в ту же БД и журнал, но в отдельные таблицы/скоуп `mode='demo'`, чтобы аналитика не смешивалась (и была отдельная вкладка «Демо / Боевой»).
- Переключение demo→live требует подтверждения Phantom-подписью.

## 4. Схема БД (SQLite, Drizzle)

```
accounts(id, email, pass_hash, totp_secret, created_at, status)
sessions(id, account_id, token_hash, ip, ua, created_at, expires_at, revoked)
wallet_links(id, account_id, address, chain, siws_message, signature, verified_at, is_primary)
settings(key, value_json, updated_at)
pools_cache(address, name, bin_step, base_fee_pct, protocol_fee_pct, dynamic_fee_pct,
            tvl, vol_24h, vol_1h, created_at_pool, token_x, token_y, meta_json, fetched_at)
candidates(id, pool, score, r_day, r_15h, t_r, c_calc, reason_json, created_at)
positions(id, mode, pool, status, capital, entry_price, exit_price, p_avg,
          zones_json, opened_at, closed_at, fees_usd, il_usd, pnl_usd, pnl_pct, exit_reason)
position_events(id, position_id, ts, type, payload_json)     -- каждый шаг: add/claim/close/stop/reenter
fills(id, position_id, ts, bin_id, side, token_amount, sol_amount, price, fee_usd)
swaps(id, position_id, ts, venue, in_mint, out_mint, amount, slippage_bps, sig, latency_ms)
equity_snapshots(ts, mode, equity_usd, cash_usd, in_positions_usd, fees_cum_usd)
daily_metrics(date, mode, pnl_usd, pnl_pct, fees_usd, il_usd, trades, wins, losses,
              best_pool, worst_pool, deposit_end)
audit_log(id, ts, actor, action, ip, payload_json)
```

## 5. API движка (всё через прокси web)

```
GET  /api/status                 режим, здоровье, балансы, активная позиция
GET  /api/candidates             скринер + score (для экрана «возможности»)
POST /api/bot/start|stop|pause   управление
POST /api/position/:id/close     ручное закрытие (подтверждение SIWS)
GET  /api/positions?mode=&status=&from=&to=&page=
GET  /api/positions/:id          карточка: сетки, события, метрики
GET  /api/positions/:id/chart?tf=1m|5m|15m|1h|4h|1d   OHLCV + volume profile + наши бины
GET  /api/analytics?range=today|yesterday|7d|30d|custom&from=&to=
GET  /api/journal?from=&to=      живой журнал
WS   /ws                         цена, состояние позиции, комиссии, события — push
```

## 6. Экраны

1. **Дашборд** — депозит, PnL сегодня (USD/%), статус бота, активная позиция (in-range %, собранные комиссии, прогноз vs факт), кнопка стоп.
2. **Позиции** — открытые/закрытые, фильтры; карточка позиции: свечной график в реальном времени, **обе сетки нанесены поверх**, **вертикальный объём справа**, все таймфреймы (1m/5m/15m/1h/4h/1d), метрики: средняя цена, комиссии, IL, PnL, время в сделке, события.
3. **Аналитика** — переключатель Сегодня / Вчера / 7 дней / 30 дней / **календарь свой диапазон**; KPI: PnL в сутки и %, лучшие монеты, минусовые сделки и их PnL, лучшие пары по прибыли, прогноз депозита на конец месяца (по тренду), график эквити, распределение по дням.
4. **Скринер** — таблица пулов с фильтрами из ТЗ и расчётным score, «почему отклонён» по каждому.
5. **Свапы** — поток сделок пула: сумма, сторона, кошелёк, метки (создатель/снайпер/инсайдер/бандлер/кит/инфлюенсер), ссылка в Solscan, фильтры по стороне/метке/размеру.
6. **Настройки** — demo/live, депозит, риск (−5% предел), целевая доходность (2%/15ч), фильтры, интервалы, кошелёк, безопасность (пароль/TOTP/Face ID), экспорт данных.

## 7. Журнал для ИИ

`journal/YYYY-MM-DD.md` — человекочитаемый поток решений (почему вошли, почему вышли, что показала модель).
`journal/events.jsonl` — машинный поток того же (каждое событие: `ts, mode, position, type, payload`).

Формат md-строки (стабильный, чтобы ИИ мог парсить и диффить):

```
[14:03:12] SCAN   найдено 42 пула → 5 кандидатов
[14:03:12] SCORE  TOKEN/SOL  score=2.31%/15h  T_r=$18.4k  T_r+C=$22.8k  f=1.00%  r=0.47  u=0.8
[14:03:12] REJECT MEME2/SOL  R_15h=1.1% < 2.0%  (volume 24h упал на 38% за 6ч)
[14:03:13] ENTER  position#17  C=$320 (risk-cap $486)  P_avg=...  P_exit=...  worst=-4.4% ($-14.1)
[14:05:00] FILL   bin -3  0.42 SOL → 1 284 TOKEN @ ...
[15:00:01] CLAIM  fees=$0.83 (→ SOL)
[17:41:09] STOP   price 0.00312 ≤ P_exit 0.00312 → emergency exit, 14 tx-latency 2.1s, slip 0.42%
```

Раз в сутки движок пишет `journal/YYYY-MM-DD-summary.md`: что сработало, где модель ошиблась (прогноз vs факт), гипотезы на завтра. Это то, что вы потом скармливаете ИИ для улучшений.

## 8. PWA (мобильное приложение)

- `manifest.webmanifest`: `display: standalone`, `theme_color`, `background_color`, иконки **192/512 + maskable 512** (сгенерирую из вашего лого/референса), `apple-touch-icon 180`.
- Установка: iOS Safari «Поделиться → На экран «Домой»», Android Chrome «Установить приложение».
- Service worker: кэш оболочки, офлайн-заглушка, push-уведомления (Web Push, VAPID — бесплатно) о стопах/входах.
- Мобильный UX: bottom-tab-bar, bottom-sheets вместо модалок, крупные цифры, `safe-area-inset`, 60 fps графики, без горизонтального скролла.

## 9. Постоянная ссылка (Cloudflare / sslip.io)

- В системе уже есть `cloudflared 2026.6.1` ✅ → **named tunnel** (`cloudflared tunnel create meteora-terminal`), `config.yml` ingress `lp.<домен>` → `http://127.0.0.1:3000`, запуск как `launchd`-сервис (автостарт при загрузке Mac).
- Ссылка **постоянная**, не меняется при рестартах (в отличие от quick tunnel, который вы использовали раньше).
- **Cloudflare Access** (Zero Trust, free ≤50 users) — политика «только ваш email» + OTP, перед интерфейсом. Дополнительно к паролю приложения.
- **Принятое решение (после разбора проекта «Прометей автотрейд»):** постоянный адрес делаем через
  **Caddy + sslip.io** — домен не нужен, сертификат Let's Encrypt выдаётся на `lp.<IP>.sslip.io`
  автоматически и продлевается сам. Cloudflare остаётся запасным вариантом (quick tunnel для тестов
  с телефона до VPS). Инструкция: `deploy/README.md`.

## 10. Надёжность бота

- Heartbeat в журнал каждую минуту; если процесс упал — `launchd`/PM2 поднимает, движок восстанавливает позицию **из цепи** (`getPositionsByUserAndLbPair`), а не из своей БД (БД — для истории).
- Circuit breaker: дневной лимит убытка (−5% от депозита) → полная остановка и алерт; серия из N стопов → пауза и смена пула.
- Двойной RPC (основной + резервный), ретраи с идемпотентностью по `position_id + nonce`.
- Telegram-алерты (вход, стоп, ошибки RPC) — опционально, нужен bot token.
