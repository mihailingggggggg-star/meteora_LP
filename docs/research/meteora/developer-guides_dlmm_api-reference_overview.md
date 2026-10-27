> ## Documentation Index
> Fetch the complete documentation index at: https://docs.meteora.ag/llms.txt
> Use this file to discover all available pages before exploring further.

# DLMM Data API Overview

> Learn how the DLMM Data API exposes indexed pools, portfolios, positions, stats, limit orders, wallets, and query filters.

> [!TIP]
>
> **All DLMM APIs have a rate limit of 30 requests per second (30 RPS).** Explore the production spec at the [Prod Swagger UI](https://dlmm.datapi.meteora.ag/swagger-ui/) or the development spec at the [Dev Swagger UI](https://dlmm.dev.metdev.io/swagger-ui/).

## Base URLs

| Environment | Base URL | Swagger UI |
| - | - | - |
| Production | `https://dlmm.datapi.meteora.ag` | [Open](https://dlmm.datapi.meteora.ag/swagger-ui/) |
| Development | `https://dlmm.dev.metdev.io` | [Open](https://dlmm.dev.metdev.io/swagger-ui/) |

The checked-in OpenAPI file uses the same endpoint schema for both environments. Use the server dropdown in the API playground to switch between production and development.

## Pools

> **[Pools](https://docs.meteora.ag/api-reference/dlmm/pools/pools.md)**
>
> Returns a paginated list of pools using `GET` `/pools`

> **[Groups](https://docs.meteora.ag/api-reference/dlmm/pools/groups.md)**
>
> Returns a paginated list of pool groups using `GET` `/pools/groups`

> **[Group](https://docs.meteora.ag/api-reference/dlmm/pools/group.md)**
>
> Returns pools that belong to a specific pool group using `GET` `/pools/groups/{lexical_order_mints}`

> **[Pool](https://docs.meteora.ag/api-reference/dlmm/pools/pool.md)**
>
> Returns metadata and current state for a single pool using `GET` `/pools/{address}`

> **[OHLCV](https://docs.meteora.ag/api-reference/dlmm/pools/ohlcv.md)**
>
> Returns OHLCV candles for a single pool over a time range using `GET` `/pools/{address}/ohlcv`

> **[Historical Volume](https://docs.meteora.ag/api-reference/dlmm/pools/historical-volume.md)**
>
> Returns historical volume for a pool aggregated into time buckets using `GET` `/pools/{address}/volume/history`

## Portfolio

> **[Closed Portfolio](https://docs.meteora.ag/api-reference/dlmm/portfolio/get-user-portfolio-with-all-pools-containing-closed-positions.md)**
>
> Returns user portfolio data with pools containing closed positions using `GET` `/portfolio`

> **[Open Portfolio](https://docs.meteora.ag/api-reference/dlmm/portfolio/get-user-portfolio-with-all-pools-containing-open-positions.md)**
>
> Returns user portfolio data with pools containing open positions using `GET` `/portfolio/open`

> **[Portfolio Total](https://docs.meteora.ag/api-reference/dlmm/portfolio/get-total-portfolio-pnl-across-all-pools.md)**
>
> Returns total portfolio PnL across pools using `GET` `/portfolio/total`

## Positions

> **[Historical Events](https://docs.meteora.ag/api-reference/dlmm/positions/get-the-historical-events-for-a-position.md)**
>
> Returns add, remove, claim fee, and claim reward events using `GET` `/positions/{address}/historical`

> **[Position PnL](https://docs.meteora.ag/api-reference/dlmm/positions/get-position-pnl-data-open-and-closed-positions-with-on-the-fly-calculation.md)**
>
> Returns position PnL for open and closed positions using `GET` `/positions/{pool_address}/pnl`

## Stats

> **[Protocol Overview](https://docs.meteora.ag/api-reference/dlmm/stats/protocol-overview.md)**
>
> Returns aggregated protocol-level metrics across all pools using `GET` `/stats/protocol_metrics`

## Limit Orders

> **[Open Limit Order Pools](https://docs.meteora.ag/api-reference/dlmm/limit-orders/get-open-limit-order-pools.md)**
>
> Returns open limit order pools for a wallet using `GET` `/wallets/{wallet}/limit_orders/open/pools`

> **[Open Limit Orders For Pool](https://docs.meteora.ag/api-reference/dlmm/limit-orders/get-open-limit-orders-for-pool.md)**
>
> Returns open limit orders for a wallet and pool using `GET` `/wallets/{wallet}/limit_orders/open/pools/{pool_address}`

> **[Closed Limit Order Pools](https://docs.meteora.ag/api-reference/dlmm/limit-orders/get-closed-limit-order-pools.md)**
>
> Returns closed limit order pools for a wallet using `GET` `/wallets/{wallet}/limit_orders/closed/pools`

> **[Closed Limit Orders For Pool](https://docs.meteora.ag/api-reference/dlmm/limit-orders/get-closed-limit-orders-for-pool.md)**
>
> Returns closed limit orders for a wallet and pool using `GET` `/wallets/{wallet}/limit_orders/closed/pools/{pool_address}`

> **[Limit Order Summary](https://docs.meteora.ag/api-reference/dlmm/limit-orders/get-limit-order-summary.md)**
>
> Returns wallet limit order summary using `GET` `/wallets/{wallet}/limit_orders/summary`

> **[Bonus Claimed For Pool](https://docs.meteora.ag/api-reference/dlmm/limit-orders/get-bonus-claimed-for-pool.md)**
>
> Returns bonus claimed data using `GET` `/wallets/{wallet}/limit_orders/pools/{pool_address}/bonus_claimed`

## Wallets

> **[Wallet Pool Total Claims](https://docs.meteora.ag/api-reference/dlmm/wallets/get-wallet-pool-total-claims.md)**
>
> Returns accumulated fee/reward claims for a wallet and pool using `GET` `/wallets/{wallet}/pools/{pool_address}/total_claims`

## Query Syntax

List endpoints use common query parameters:

| Parameter | Use |
| - | - |
| `page` | 1-based page number. |
| `page_size` | Page size. Pool lists support up to `1000`; group lists support up to `100`. |
| `query` | Search by name, tokens, or address. |
| `sort_by` | Format: `<field>:<direction>` or `<metric>_<window>:<direction>`. |
| `filter_by` | Format: `<field><op><value> [&& <field><op><value> ...]`. |

Supported time windows include `5m`, `30m`, `1h`, `2h`, `4h`, `12h`, and `24h`.


This documentation is built and hosted on [Mintlify](https://mintlify.com), a developer documentation platform.