# METEORA TERMINAL

Терминал LP-торговли в пулах **Meteora DLMM** (Solana): двусторонняя сетка ±(1.5×ATR), сплит 50/50,
ребалансы при пробое границ, ATR-фильтр и лимит ребалансов, демо- и боевой контур, веб + PWA.

> Актуальная логика бота — **`docs/10-STRATEGY-V2.md`** (сетка ±2.5%, 50/50, ATR ≤ 2%, V/TVL ≥ 3,
> ребаланс при пробое, максимум 4–8 ребалансов/сутки, стоп после 3 убыточных, диверсификация с $10k,
> фиксация прибыли). Всё, что было под старую логику (BidAsk-зоны, ratio 400–1300%), удалено.

## Запуск

```bash
cd ~/Desktop/meteora-terminal
npm install      # первый раз
npm run dev      # движок :8787 + интерфейс :3000
```

Или двойной клик по **`Запуск.command`** (macOS).

### Если «легло» / нужен стабильный режим

```bash
./scripts/serve.sh status    # что живо
./scripts/serve.sh start     # поднять движок + веб (прод-сборка, стабильнее dev)
./scripts/serve.sh restart   # перезапустить оба
./scripts/serve.sh watch     # сторож: поднимает упавший процесс каждые 15 с
```

`serve.sh start` работает на прод-сборке `next start` (меньше памяти, не падает от правок файлов).
Правки в код → `npm run build`, затем `./scripts/serve.sh restart`.
Обновлять данные движка не нужно — он живёт отдельным процессом на `:8787`.

- Интерфейс: **http://localhost:3000**
- Логин и пароль — из `ADMIN_EMAIL` / `ADMIN_PASSWORD` в `.env` (на сервере пароль генерируется при установке)
- Публичная ссылка для телефона на время тестов: `npm run tunnel` (cloudflared)
- Постоянная ссылка на VPS: `sudo bash deploy/install.sh` → `https://lp.<IP>.sslip.io` (см. `deploy/DEPLOY.md`)

## Что уже работает

| Блок | Состояние |
|---|---|
| Скринер пулов (Meteora Data API) | ✅ V/TVL ≥ 3x, ATR(30м) ≤ 2%, TVL ≥ $50k, объём/час ≥ $500, холдеры ≥ 300, возраст ≥ 6ч |
| Модель прогноза комиссий | ✅ от фактических `fees.24h` пула × доля объёма в коридоре × наша доля ликвидности |
| Сетка 50/50 и стоимость позиции | ✅ модель DLMM: ask-бины держат токен, bid-бины SOL (совпадает с v3/Meteora) |
| Ребаланс при пробое ±range | ✅ своп 50% обратно, friction 0.15%, лимит 8/сутки, стоп после 3 убыточных |
| Чтение ликвидности по бинам с цепи | ✅ `@meteora-ag/dlmm` + Helius RPC (fallback — оценка) |
| Профиль объёма (вертикальный объём) | ✅ свой расчёт по свечам, рисуется справа от графика |
| Ликвидность участников по бинам + TVL пула | ✅ поверх графика, переключатель слоёв |
| Иконки токенов | ✅ GeckoTerminal → DexScreener, кэш 24 ч (`/api/icon`) |
| Распределение капитала SOL ↔ токен | ✅ донат + история во времени |
| Аудит реализма демо | ✅ `docs/06-DEMO-REALISM-AUDIT.md` |
| График в **маркет-капе** (переключатель Кап/Цена) | ✅ уровни и сетки масштабируются вместе |
| Вкладка **Свапы** с разметкой кошельков | ✅ создатель / снайпер / инсайдер / бандлер / кит / инфлюенсер |
| Демо-контур $500 | ✅ реальные комиссии/слиппедж/издержки, реальные данные |
| Цикл сделки: вход → клейм → ребаланс → стоп/ротация | ✅ |
| Диверсификация (1 слот до $10k, до 5 после) | ✅ |
| Фиксация прибыли на вехах (20%) | ✅ |
| Журнал (md + jsonl) | ✅ `journal/` |
| Вход по паролю + привязка Phantom (SIWS) | ✅ |
| PWA (иконка, standalone, офлайн-оболочка) | ✅ |
| Аналитика с окнами и календарём | ✅ |
| Свечи: Meteora Data API (основной) + Gecko (fallback) | ✅ кэш по ТФ, дедупликация, предзагрузка |
| Боевой контур (реальные транзакции) | ✅ код готов: `apps/engine/src/executor.ts` (вход/выход/клейм в DLMM), идемпотентность `onchain_ops`, сверка с цепочкой, kill-switch, алерты в TG. Включается только при `BOT_MODE=live` + `LIVE_EXECUTION=true` + ключе кошелька — см. `docs/12-LIVE-MODE.md` |
| Безопасность | ✅ Next 14.2.35 (CVE-2025-29927), rate-limit логина, fail-closed AUTH_SECRET, CSP, токен локального API, бэкапы, systemd-hardening — `docs/11-SECURITY-LIVE-AUDIT.md` |

## Структура

```
apps/web        Next.js 14 + Tailwind 4 + shadcn-подход + lightweight-charts + recharts
apps/engine     Node + @meteora-ag/dlmm: скринер, модель, исполнение (demo), API :8787
docs/           исследование, стратегия, архитектура, ключи
journal/        журнал действий бота (md + events.jsonl)
data/           SQLite (node:sqlite)
```

## Основные настройки (`.env`)

`DEMO_DEPOSIT_USD`, `MIN_TURNOVER`, `MAX_ATR_PCT`, `MIN_POOL_TVL_USD`, `MIN_VOL_1H_USD`, `MIN_HOLDERS`,
`MIN_POOL_AGE_HOURS`, `POSITION_BUDGET_PCT`, `RANGE_ATR_MULT`, `MAX_RANGE_PCT`, `FRICTION_PCT`,
`MAX_REBALANCES_PER_DAY`, `CONSECUTIVE_LOSS_STOP`, `MAX_HOLD_HOURS`, `PROFIT_TAKE_PCT`,
`MAX_POSITIONS`, `DIVERSIFY_FROM_USD`, `SCAN_INTERVAL_SECONDS`, `HELIUS_API_KEY`.

Боевой контур: `LIVE_EXECUTION`, `LIVE_MAX_POSITION_USD`, `LIVE_MAX_POSITIONS`, `LIVE_SLIPPAGE_PCT`,
`LIVE_PRIORITY_FEE_MICROLAMPORTS`, `LIVE_MIN_SOL_RESERVE`, `LIVE_RECONCILE_MINUTES`,
`TRADING_WALLET_SECRET_BASE58`, `TRADING_WALLET_PUBKEY`, `WALLET_ENCRYPTION_KEY`, `TG_BOT_TOKEN`, `TG_CHAT_ID`; безопасность: `AUTH_SECRET`, `ENGINE_TOKEN`.

Меняются также из интерфейса: **Настройки → Стратегия и риск**.
