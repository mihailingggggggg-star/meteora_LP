# 01 · Meteora DLMM — исследование (проверено на живых запросах 26.10.2026)

Источники: `docs.meteora.ag` (llms.txt / llms-full.txt), `github.com/MeteoraAg/dlmm-sdk`, npm `@meteora-ag/dlmm`, живой Data API.
Скачанные первоисточники лежат в `docs/research/meteora/`.

---

## 1. Что такое DLMM в двух абзацах (важно для стратегии)

Пул DLMM — «лестница» ценовых бинов. Шаг между бинами задаётся `bin_step` в базисных пунктах:
`P_i = (1 + bin_step/10000)^i`. Внутри бина цена фиксированная (constant-sum), поэтому нулевой price impact *внутри* бина;
цена двигается только когда вычерпан активный бин и своп переходит в следующий.

Каждый бин — отдельный «мини-рынок». Наша доля комиссий в бине = наша ликвидность в бине / вся ликвидность в бине.
Из этого следует главное: **доходность зависит не от нашего капитала, а от концентрации**:

```
дневная доходность на наш капитал ≈ (объём, прошедший через наш диапазон за день) × ставка_комиссии / (вся ликвидность в этом диапазоне)
```

Чем уже диапазон вокруг зоны, где реально идёт объём, тем выше доходность — и тем выше риск выхода из диапазона.

## 2. Комиссии (критично для прогноза +2%/день)

```
total fee rate = min(base fee + variable (dynamic) fee, MAX_FEE_RATE = 10%)
base fee rate  = bin_step / 10^(base_fee_power_factor)
variable fee   = (variable_fee_control × (volatility_accumulator × bin_step)^2) / 1e9-ish (см. formulas.md)
```

Практический вывод: **ставка комиссии жёстко связана с шагом бина**. Хотим 1% комиссии — нужен крупный bin_step.
Из живого API `pool_config` отдаёт `bin_step`, `base_fee_pct`, `max_fee_pct`, `protocol_fee_pct`, плюс отдельно `dynamic_fee_pct`.

Из протокольной комиссии (`protocol_fee_pct`, обычно 5–20%) мы тоже платим — считаем в модели как «чистая ставка = fee × (1 − protocol_fee/100)».

## 3. Стратегии ликвидности (готовые в SDK/программе)

| Стратегия | Форма | Куда применять |
|---|---|---|
| `Spot` | равномерно по диапазону | стабильные пары, широкий диапазон |
| `Curve` | больше в центре | узкий диапазон, «здесь и сейчас» |
| `BidAsk` | **инверсная кривая: больше ликвидности у краёв** | **наш случай** — DCA-вход вниз / DCA-выход вверх |

Документация прямо описывает наш сценарий: *«DCA into a token: deposit quote token single-sided with Bid-Ask or selected bins below current price. As price moves down, quote converts into base»*.
Это ровно «вход только за SOL, сетка вниз» — подтверждено официально.

Варианты: one-sided / balanced / imbalanced. Нам нужен **one-sided (только SOL/quote)** либо imbalanced с малым весом вверх.

## 4. TypeScript SDK `@meteora-ag/dlmm`

Актуальная версия: **1.9.14** (`latest`), монорепо `MeteoraAg/dlmm-sdk`, пакет из `ts-client`.

```ts
import DLMM from "@meteora-ag/dlmm";
import { Connection, PublicKey } from "@solana/web3.js";

const pool = await DLMM.create(connection, new PublicKey(poolAddress), { cluster: "mainnet-beta" });
```

Методы, которые нам нужны (подтверждены по `reference.md` и `examples.md`):

**Чтение состояния**
- `pool.refetchStates()` — обновить состояние перед каждым решением
- `pool.getActiveBin()` — активный бин, текущая цена (`binId`, `price`, `binXAmount`, `binYAmount`)
- `pool.getBinArrays()` / `pool.getBinsBetweenLowerAndUpperBound(lower, upper)` / `pool.getBinsAroundActiveBin(...)` — ликвидность по бинам (для расчёта нашей доли и вертикального объёма)
- `pool.getPositionsByUserAndLbPair(user)` / `DLMM.getAllLbPairPositionsByUser(connection, user)` — наши позиции
- `pool.getFeeInfo()` / `pool.getDynamicFee()` / `pool.getBaseFee()` — ставка комиссии сейчас
- `DLMM.getBinIdFromPrice(price, binStep, min)` — цена ↔ binId
- `pool.getLbPairLockInfo()` — информация о блокировках пула
- `pool.getBinArrayForSwap(...)`, `swapQuote()`, `swapQuoteExactOut()` — котировки свопа прямо в пуле

**Запись (наши действия)**
- `pool.initializePositionAndAddLiquidityByStrategy({ positionPubKey, user, totalXAmount, totalYAmount, strategy: { minBinId, maxBinId, strategyType: StrategyType.BidAsk } })`
- `pool.addLiquidityByStrategy({...})` — довнести в существующую
- `pool.removeLiquidity({ user, position, fromBinId, toBinId, bps, shouldClaimAndClose })` — снять частично/полностью
- `pool.closePosition({ owner, position })` — закрыть позицию (нужно `shouldClaimAndClose`/сбор комиссий)
- `pool.claimSwapFee({ owner, position })` / `pool.claimAllRewardsByPosition(...)`
- Хелперы расчёта: `calculateBidAskDistribution`, `toAmountsBothSideByStrategy`, `getAmountInBinsBidSide` — используем для точного прогноза того, сколько SOL уйдёт в токен на каждом бине.

Транзакции собираются как `Transaction`/`VersionedTransaction`, подписываются `Keypair` (серверный торговый кошелёк) и отправляются через RPC с `ComputeBudget` + priority fee.

## 5. Data API (бесплатный, без ключа) — на нём строим скринер

База: **`https://dlmm.datapi.meteora.ag`** (старый `dlmm-api.meteora.ag` больше не отвечает — 404, проверил).

```
GET /pools?page_size=100&sort_by=tvl:desc&filter_by=...
GET /pools/{address}
GET /pools/{address}/ohlcv?timeframe=5m&start_time=&end_time=
GET /pools/{address}/historical-volume?...
GET /positions/{pool}/{user}/pnl      # PnL открытых/закрытых позиций
GET /portfolio/...                    # агрегаты по кошельку
GET /stats/...                        # метрики протокола
```

Поля `GET /pools` (проверено на живом ответе):
`address`, `name`, `token_x`/`token_y` (`address, symbol, decimals, holders, is_verified, freeze_authority_disabled, price, market_cap`),
`tvl`, `current_price`, `created_at` (ms), `pool_config { bin_step, base_fee_pct, max_fee_pct, protocol_fee_pct, collect_fee_mode }`,
`dynamic_fee_pct`, `apr`, `apy`, `volume {30m,1h,2h,4h,12h,24h}`, `fees {...}`, `protocol_fees {...}`,
`fee_tvl_ratio {…}`, `cumulative_metrics {volume, fees}`, `is_blacklisted`, `launchpad`, `tags`, `has_farm`.

Этого достаточно, чтобы реализовать **все** фильтры из ТЗ:
- `tvl >= 70_000` (см. трактовку «залоченной ликвидности» в `05-KEYS-AND-ACCESS.md`, вопрос №7)
- `tvl / volume.24h` в диапазоне `4.0 … 13.0` (= ваши 400–1300%)
- возраст: `now - created_at >= 24h`
- безопасность: `is_blacklisted = false`, `freeze_authority_disabled = true`, число холдеров, `launchpad`
- выбор лучшего: считаем прогноз доходности (см. `03-STRATEGY-MATH-MODEL.md`) по каждому кандидату и берём максимум

Пример живого ответа (первый пул по TVL): `YZY-USDC`, `bin_step 100`, `base_fee_pct 1.0`, `protocol_fee_pct 5`, `tvl $37.6M`, `volume.24h $903`, `fee_tvl_ratio.24h 0.0000216`.

## 6. Данные для графиков и «вертикального объёма»

Бесплатно, без ключей (проверено):

| Источник | Что даёт | Ограничения |
|---|---|---|
| **GeckoTerminal API v2** (`api.geckoterminal.com/api/v2`) | OHLCV по пулу (`/networks/solana/pools/{addr}/ohlcv/{minute|hour|day}?aggregate=N`), сделки (`/trades`), метрики пула | ~30 запросов/мин без ключа, есть `x-api-key` (бесплатный) для выше лимита |
| **DexScreener API** (`api.dexscreener.com`) | пары, цена, объёмы, ликвидность, профили токенов | мягкие лимиты 300/мин |
| **Meteora Data API** | комиссии, TVL, исторический объём по пулу | — |
| **Jupiter `lite-api.jup.ag/swap/v1`** | котировки/свопы для **аварийного выхода** и проверки honeypot (round-trip) | без ключа, есть лимиты |

**Вертикальный объём (volume profile)** считаем сами: берём сделки/свечи за окно → раскладываем объём по ценовым уровням (гистограмма по цене, а не по времени) → рисуем справа от графика. Это и есть «зоны объёма» для выбора границ сеток. Готового бесплатного API «volume profile» для DEX нет — только собственный расчёт (это плюс: можем строить по бинам DLMM, что точнее).

Графики: библиотека **TradingView Lightweight Charts** (Apache-2.0, `tradingview/lightweight-charts`) — бесплатная, полноценные свечи, кастомные серии для сетки и профиля объёма. Данные TV не нужны.

## 7. Выход из позиции «максимально быстро» (стоп)

Два пути, оба реализуем:
1. **Jupiter** (`/swap/v1/quote` → `/swap/v1/swap`, с priority fee и Jito-бандлом при желании) — лучший маршрут по всем пулам, для мем-токенов почти всегда выгоднее.
2. **Своп в самом пуле DLMM** (`pool.swapQuote` + `pool.swap`) — если Jupiter не находит маршрут (новый токен).

Оптимизация задержки:
- держим «прогретый» WebSocket/RPC и заранее посчитанный маршрут,
- предподписанную транзакцию собрать нельзя (меняется состояние), но можно заранее подготовить инструкции и блокхаш,
- два RPC (основной + резервный), priority fee из свежих данных,
- триггер стопа проверяем по потоку цен (WebSocket) с частотой ≤250 мс, а не опросом раз в минуту,
- жёсткий fallback: если своп не прошёл за N секунд — market-свап с повышенным слиппеджем, потом ручной алерт.

## 8. Ограничения/риски, которые надо принять осознанно

- **Демо и боевой — один код.** Разница только в адаптере исполнения.
- **Комиссии — не гарантия.** Прогноз считается по историческому объёму; объём может упасть после входа. Модель обязана считать «пессимистичный» сценарий (объём −50%).
- **Impermanent loss / выход из диапазона**: при пробитии нижней сетки у нас 100% в токене, и мы продаём его — это и есть стоп ≤ −5% депозита.
- **Смарт-контрактный риск Meteora** и риск самого токена (rug/honeypot) — обязательный фильтр + лимит на сделку.
- **RPC и priority fee** — при перегрузке сети выход может стоить дороже; в модели заложен буфер.
