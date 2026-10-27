> ## Documentation Index
> Fetch the complete documentation index at: https://docs.meteora.ag/llms.txt
> Use this file to discover all available pages before exploring further.

# DLMM Collect Fee Mode

> Compare DLMM's InputOnly and OnlyY fee collection modes and how each affects LP fees, limit orders, quote-token economics, and launch design.

DLMM Collect Fee Mode determines which token is used to collect trading fees during swaps. It is a pool-level setting that shapes how fees accrue to LPs and limit-order participants.

This matters because fee currency is part of the product design of a pool. Some pools should let LPs earn fees in whichever token traders bring into the swap. Other pools, especially launch or quote-driven markets, may prefer fees to accumulate in a single quote-style token.

## Modes

DLMM currently supports two collect fee modes:

| Mode | Value | What It Means | Best Fit |
| - | -: | - | - |
| `InputOnly` | `0` | Fees are collected from the token entering the swap. | General-purpose pools where LPs are comfortable earning fees in both sides depending on swap direction. |
| `OnlyY` | `1` | Fees are collected in token Y, even when token Y is the output token. | Pools that want a more predictable fee token, often when token Y is the quote asset. |

> [!NOTE]
>
> Existing pools have their own configured mode. Pool creators should choose the mode that best matches the pool's economic design before launch.

## InputOnly

`InputOnly` collects fees from the input token of the swap.

If a trader swaps token X for token Y, the fee is collected in token X. If a trader swaps token Y for token X, the fee is collected in token Y.

> **Balanced Fee Exposure**
>
> LPs can earn fees in both assets over time, depending on market flow.

> **General Pool Design**
>
> Useful for pools where both assets are meaningful to LPs and neither side needs to be the exclusive fee token.

## OnlyY

`OnlyY` collects fees in token Y.

If token Y is SOL, USDC, or another quote asset, this mode can make fee accrual easier to understand because fees are concentrated in the quote side of the pair.

When a trader swaps token Y for token X, the fee is taken from the input token because token Y is entering the pool. When a trader swaps token X for token Y, the fee is still denominated in token Y, so it is accounted from the output side of that bin-level swap.

> **Predictable Fee Token**
>
> LPs and order participants can reason about fees accumulating in token Y rather than both assets.

> **Launch-Friendly**
>
> Useful when a new token is paired against a familiar quote token and the pool wants fee collection to emphasize that quote side.

## How Fees Flow During A Swap

```text theme={"system"}
Trader swap
  -> DLMM calculates base fee + variable fee
  -> Collect Fee Mode decides the fee token
  -> Fees are distributed to eligible liquidity in crossed bins
  -> Protocol and other configured shares are accounted for
```

DLMM calculates fees per bin, which means the bins that participate in the swap are the bins that earn fees. Collect Fee Mode then determines the token denomination for those fees.

## Why Pool Creators Should Care

Choosing a collect fee mode is a product decision, not just a configuration detail.

> **I want a general trading pool**
>
> `InputOnly` is often the more balanced default because fees follow trade direction and can accrue in both assets over time.

> **I want fees in the quote asset**
>
> `OnlyY` can be a better fit when token Y is the quote asset and LPs or token teams want fees to accumulate there.

> **I am launching a new token**
>
> Consider whether fee predictability matters more than balanced token exposure. Launch pools often care about simple accounting and quote-token fee capture.

## Interaction With Limit Orders

Limit orders can also participate in fee flow when swap activity fills order liquidity, but only on pools whose function mode supports limit orders. Collect Fee Mode affects which token those fees are tracked in.

For `InputOnly`, limit-order fees follow the token entering the swap. For `OnlyY`, fees are collected in token Y. This can be important for users who place limit orders to DCA into or out of a token and want to understand which token their fee earnings may use.

> [!WARNING]
>
> Collect Fee Mode does not remove market risk. LPs and limit-order users can still end up with a different token composition after swaps move through their bins.


This documentation is built and hosted on [Mintlify](https://mintlify.com), a developer documentation platform.