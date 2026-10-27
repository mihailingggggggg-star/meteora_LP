> ## Documentation Index
> Fetch the complete documentation index at: https://docs.meteora.ag/llms.txt
> Use this file to discover all available pages before exploring further.

# DLMM Strategies and Use Cases

> Choose DLMM liquidity shapes for stable pairs, volatile assets, DCA strategies, launch liquidity, and different capital-efficiency goals.

DLMM gives LPs control over **where** liquidity is placed and **how** it is distributed across price bins. This turns liquidity provision into a strategy decision: you can optimize for capital efficiency, wider market coverage, volatility capture, or gradual buying and selling.

At the program level, DLMM supports the `Spot`, `Curve`, and `BidAsk` strategy families in one-sided, balanced, and imbalanced variants. The named examples below, such as Spot-Concentrated or Spot-Wide, are product and UI presets built from those underlying strategy families and bin ranges.

The right strategy depends on your market view. A narrow position can earn more when price stays in range, but it can also go inactive faster. A wider position can survive more price movement, but each dollar of liquidity is spread across more bins.

> [!WARNING]
>
> DLMM strategies can improve capital efficiency, but they do not remove impermanent loss or out-of-range risk. Monitor positions and rebalance when market conditions change.

## Liquidity Shapes

> **Spot**
>
> A uniform distribution across your selected bins. It is the most straightforward shape and works well when you want balanced exposure across a range.

> **Curve**
>
> A concentrated distribution around the middle of your range. It is designed for higher fee capture when price stays near the current market.

> **Bid-Ask**
>
> An inverse Curve distribution with more liquidity near the edges. It is useful for volatile markets and DCA-style entry or exit strategies.

## Strategy Comparison

<table>
  <thead>
    <tr>
      <th>Strategy</th>
      <th>Best For</th>
      <th>Strength</th>
      <th>Watch Out For</th>
    </tr>
  </thead>

  <tbody>
    <tr>
      <td>
        Curve

        ![Curve](https://mintcdn.com/meteora/FuYCvEvL3a7_z_Mt/core-products/dlmm/assets/curve.png?fit=max\&auto=format\&n=FuYCvEvL3a7_z_Mt\&q=85\&s=7fdd4d957cb5230a1d12c8582f41ca80)
      </td>

      <td>Stable pairs, pegged assets, and calm markets where price is expected to stay near the current range.</td>
      <td>High capital efficiency because more liquidity sits near the active price.</td>
      <td>Higher out-of-range risk if price moves away from the center. Rebalance more often when volatility rises.</td>
    </tr>

    <tr>
      <td>
        Bid-Ask

        ![Bid-Ask](https://mintcdn.com/meteora/FuYCvEvL3a7_z_Mt/core-products/dlmm/assets/bid-ask.png?fit=max\&auto=format\&n=FuYCvEvL3a7_z_Mt\&q=85\&s=dbb08674ed80c63e48f2606bf940487d)
      </td>

      <td>Volatile markets, DCA entries, DCA exits, and strategies that expect price to move away from the current level.</td>
      <td>Places liquidity where larger price swings may happen, helping users buy lower or sell higher across bins.</td>
      <td>More advanced than Spot. It may sit away from the active price until the market moves into the edge bins.</td>
    </tr>

    <tr>
      <td>
        Spot-ConcentratedLiquidity equally deposited between 1-3 bins

        ![Spot-Concentrated](https://mintcdn.com/meteora/FuYCvEvL3a7_z_Mt/core-products/dlmm/assets/spot-concentrated.png?fit=max\&auto=format\&n=FuYCvEvL3a7_z_Mt\&q=85\&s=b34388eb06628350ed9d1e92ae13e261)
      </td>

      <td>Very tight stablecoin or pegged-pair strategies.</td>
      <td>Maximum capital concentration around the active price.</td>
      <td>Highest out-of-range risk. This strategy needs close monitoring, especially on volatile pairs.</td>
    </tr>

    <tr>
      <td>
        Spot-SpreadLiquidity equally deposited between 20-30 bins

        ![Spot-Spread](https://mintcdn.com/meteora/FuYCvEvL3a7_z_Mt/core-products/dlmm/assets/spot-spread.png?fit=max\&auto=format\&n=FuYCvEvL3a7_z_Mt\&q=85\&s=b3fe2abd4f09cb516b742c6eb7edd26f)
      </td>

      <td>Markets with moderate daily movement where you still want meaningful capital efficiency.</td>
      <td>Balances fee capture with more breathing room than a very tight range.</td>
      <td>Can still go out of range during strong trends. Review the position frequently.</td>
    </tr>

    <tr>
      <td>
        Spot-WideLiquidity equally deposited across around 50 bins

        ![Spot-Wide](https://mintcdn.com/meteora/FuYCvEvL3a7_z_Mt/core-products/dlmm/assets/spot-wide.png?fit=max\&auto=format\&n=FuYCvEvL3a7_z_Mt\&q=85\&s=7d5952c5256c50730dae09bb7e6ccc10)
      </td>

      <td>LPs who want a more resilient range and do not want to rebalance as often.</td>
      <td>More durable coverage across price movement.</td>
      <td>Lower fee capture per dollar than tighter strategies because liquidity is spread across more bins.</td>
    </tr>
  </tbody>
</table>

## Choosing Your Bin Step

Each bin represents a single price point, and the difference between two neighboring bins is the **bin step**. You can think of bin step like tick size: a smaller bin step creates tighter price intervals, while a larger bin step creates wider jumps between bins.

For example, if SOL is $20 and the bin step is 25 basis points, the next bins would be approximately $20.05, then \$20.10, and so on.

> **Smaller Bin Step**
>
> Creates a tighter price ladder and can capture more continuous trading activity. This is generally better suited for stable pairs and highly liquid markets.

> **Larger Bin Step**
>
> Lets a position cover a wider market range with fewer bins. This is often better suited for volatile pairs where price can move quickly.

> [!NOTE]
>
> For wider range design, see [DLMM Dynamic Positions](https://docs.meteora.ag/core-products/dlmm/dynamic-positions.md).

## How Bin Step Affects Fees

The base fee is the minimum trading fee charged by a pool. In DLMM, the bin step is one of the inputs used to determine that base fee.

* Lower base fees may attract more volume.
* Higher base fees earn more per unit of volume.
* Smaller bin steps are usually paired with tighter, more active markets.
* Larger bin steps are usually paired with wider, more volatile markets.

DLMM also supports dynamic fees, so the total fee can increase when volatility rises. This means LPs and pool creators should think about both the baseline fee and the expected volatility profile of the pair.

## Common Use Cases

> **Stable pairs**
>
> Use a smaller bin step and a Curve or Spot-Concentrated strategy when you expect price to stay close to the peg. This maximizes capital efficiency but needs monitoring if the peg weakens.

> **Volatile pairs**
>
> Use a larger bin step or wider Spot range to reduce the chance of going out of range immediately. Bid-Ask can be useful if you want to capture movement toward the edges.

> **DCA into a token**
>
> Deposit quote token single-sided and use Bid-Ask or selected bins below the current price. As price moves down, your quote token can gradually convert into the base token.

> **DCA out of a token**
>
> Deposit base token single-sided and place liquidity above the current price. As price moves up, your base token can gradually convert into quote token.

> **Token launches**
>
> Use DLMM to bootstrap liquidity with a shape that matches expected launch volatility. Wider ranges can support price discovery, while dynamic fees help capture more value when trading demand is high.


This documentation is built and hosted on [Mintlify](https://mintlify.com), a developer documentation platform.