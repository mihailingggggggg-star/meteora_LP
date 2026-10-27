> ## Documentation Index
> Fetch the complete documentation index at: https://docs.meteora.ag/llms.txt
> Use this file to discover all available pages before exploring further.

# What is DLMM?

> Learn how Meteora's DLMM uses price bins, concentrated liquidity, dynamic fees, position accounts, pool function modes, and launch-ready pool design to power efficient Solana markets.

## Overview

DLMM stands for **Dynamic Liquidity Market Maker**. It is Meteora's high-performance concentrated liquidity product for teams and LPs who want more control over where liquidity sits, how fees are captured, and how a pool reacts when the market gets volatile.

Instead of spreading liquidity across every possible price like a traditional AMM, DLMM organizes liquidity into **discrete price bins**. Each bin represents one price point for a token pair. When traders swap inside the active bin, they trade at that bin's fixed price, which creates a smooth zero-slippage experience within the bin. When demand consumes the liquidity in one bin, the market moves to the next bin.

The result is a liquidity engine that can feel simple to traders while giving LPs and token teams a sharper set of tools: concentrated liquidity, single-sided deposits, dynamic fees, resizable positions, Token 2022 support, and pool modes for either liquidity mining or limit-order liquidity.

> **Capital Efficiency**
>
> Concentrate liquidity around the prices where trading is most likely to happen, so each dollar of liquidity can support more volume than a full-range pool.

> **Zero-Slippage Bins**
>
> Trades inside a bin execute at that bin's fixed price. Price only moves when liquidity in the active bin is consumed and the pool shifts to the next bin.

> **Dynamic Fees**
>
> Fees can rise when volatility increases and cool down when markets are calmer, helping LPs price risk more intelligently.

> **Flexible Liquidity Shapes**
>
> LPs can choose Spot, Curve, and Bid-Ask shapes to match their market view, from stable pairs to volatile launches.

> **Pool Function Modes**
>
> DLMM pools can be configured for liquidity mining rewards or for limit-order liquidity. The program treats these as distinct pool-level modes.

> **Launch Pool Ready**
>
> DLMM can be used for launch markets where teams need configurable liquidity ranges, activation controls, and volatility-aware fees.

> [!NOTE]
>
> Unlike DAMM pools, DLMM liquidity is not connected to Meteora's Dynamic Vaults for lending yield. DLMM liquidity is used for trading, fee capture, and pool-level incentives where available.

> [!NOTE]
>
> DLMM runs on the mainnet program `LBUZKhRxPF3XUpBCjp4YzTKgLccjZhTSDM9YuVaPwxo`.

## Why DLMM Exists

Liquidity is most valuable where trades actually happen. In many AMMs, a large amount of liquidity sits far away from the current price and rarely earns fees. DLMM solves this by letting LPs place liquidity across specific price bins instead of passively covering the entire curve.

For LPs, this means a position can be designed around a thesis: tight and efficient for stable pairs, wider for volatile assets, or one-sided for gradually entering or exiting a token. For token teams, this means liquidity can be designed around expected price discovery, fee capture, and market depth.

## How DLMM Works

The `lb_clmm` program represents each DLMM market as an `LbPair`. The pair stores the token mints, vaults, active bin ID, bin step, fee parameters, reward information, oracle account, pool status, pool creator, and Token Program flags.

The market itself is built from many bins placed side by side.

![DLMM market liquidity aggregated across price bins](https://mintcdn.com/meteora/FuYCvEvL3a7_z_Mt/core-products/dlmm/assets/market-aggregation.png?fit=max\&auto=format\&n=FuYCvEvL3a7_z_Mt\&q=85\&s=6755f1a4e336fed2ca94e596cd8d7915)

There is only one **active bin** at a time. That active bin is where the current market price sits and where swaps are happening now. Bins below the active bin hold one side of the pair, and bins above it hold the other side. As swaps consume one token from the active bin, the pool moves left or right through the bin ladder.

Each pool also has a **bin step**, which defines the price gap between neighboring bins. The program supports bin steps up to `400` basis points. Smaller bin steps create tighter price movement and are often useful for stable or highly liquid pairs. Larger bin steps create wider jumps and can be useful for volatile assets where price can move quickly.

Bins are grouped into bin arrays of `70` bins. Positions also start from a `70` bin default layout, while dynamic `PositionV2` accounts can allocate additional per-bin data up to `1,400` bins when a strategy needs a wider range.

## Liquidity Shapes

When LPs add liquidity, they choose how that liquidity is distributed across bins. This is one of DLMM's biggest product advantages because the same pool can support different strategies at the same time.

> **Spot**
>
> A balanced distribution across the selected range. It is straightforward, flexible, and useful when you want broad exposure without over-concentrating in one area.

> **Curve**
>
> A concentrated distribution around the middle of the range. It is designed for higher efficiency when you expect trading to stay near the current price.

> **Bid-Ask**
>
> A distribution that places more liquidity near the edges of the range. It is useful for capturing volatility or creating DCA-style buy and sell strategies.

## Dynamic Fees

DLMM fees are designed to adapt to market conditions. Every swap pays a base fee, and pools can also charge a variable fee that responds to volatility.

When swaps cross more bins or happen in quick succession, DLMM treats the market as more volatile. The variable fee can increase during those periods, which helps LPs capture more value when they are taking more risk. When activity slows down, the volatility measurement decays and fees can normalize.

This is especially important during launches, where demand and volatility are often highest. When a pool's variable fee parameters are configured, DLMM can raise fees during volatile periods and cool them down as activity stabilizes.

## Pool Function Modes

DLMM currently exposes two higher-level function modes:

| Mode | What It Enables | Program Behavior |
| - | - | - |
| Liquidity Mining | Pools can initialize reward mints, fund rewards, and distribute rewards to eligible active liquidity. | The pool supports reward accounting and does not support limit-order placement. |
| Limit Order | Users can place bid-side or ask-side order liquidity into selected bins. | The pool supports limit-order liquidity and does not support liquidity mining rewards. |

For older or undetermined pool configurations, the program decides whether liquidity mining is active by checking whether reward information has been initialized. If liquidity mining is not active, the pool supports limit-order behavior.

## Who DLMM Is For

> **Liquidity providers**
>
> DLMM is for LPs who want more control over capital placement, fee capture, and strategy design. You can concentrate liquidity, provide single-sided liquidity, rebalance as the market moves, and claim fees from the bins where your liquidity is active.

> **Token teams**
>
> DLMM is for teams launching or growing token markets. It gives you a flexible liquidity layer for bootstrapping depth, supporting aggregator routing, and capturing fees during high-volume market periods.

> **Traders and aggregators**
>
> DLMM is for traders who need deep liquidity and efficient routing. Bins can deliver zero-slippage execution at a fixed price until the active bin is consumed, while the full market is composed from many bins.

## What To Read Next

> **[DLMM Dynamic Positions](https://docs.meteora.ag/core-products/dlmm/dynamic-positions.md)**
>
> Learn how position accounts track ownership, bin ranges, liquidity shares, fees, rewards, and resizable ranges.

> **[DLMM Limit Order](https://docs.meteora.ag/core-products/dlmm/limit-order.md)**
>
> Learn how limit-order mode lets selected bins behave like on-chain buy or sell orders.

> **[DLMM Collect Fee Mode](https://docs.meteora.ag/core-products/dlmm/collect-fee-mode.md)**
>
> See how pools choose whether fees are collected from the input token or in token Y.

> **[DLMM Liquidity Mining](https://docs.meteora.ag/core-products/dlmm/liquidity-mining.md)**
>
> Learn how reward-enabled pools distribute incentives to active liquidity.

> **[DLMM Token 2022 Support](https://docs.meteora.ag/core-products/dlmm/token-2022-support.md)**
>
> Review which Token 2022 extensions work permissionlessly and which require a token badge.

> **[Strategies and Use Cases](https://docs.meteora.ag/core-products/dlmm/strategies-and-use-cases.md)**
>
> Explore common LP strategies such as Curve, Bid-Ask, Spot-Concentrated, and Spot-Wide.

> **[DLMM Formulas](https://docs.meteora.ag/core-products/dlmm/formulas.md)**
>
> Understand the product math behind bin prices, liquidity, and dynamic fees without going deep into code.

> [!WARNING]
>
> DLMM can be more capital-efficient than traditional AMMs, but it also requires more active position management. If the active price moves outside your selected range, that position stops earning trading fees until the price returns or you rebalance.


This documentation is built and hosted on [Mintlify](https://mintlify.com), a developer documentation platform.