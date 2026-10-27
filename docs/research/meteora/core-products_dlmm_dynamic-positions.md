> ## Documentation Index
> Fetch the complete documentation index at: https://docs.meteora.ag/llms.txt
> Use this file to discover all available pages before exploring further.

# DLMM Dynamic Positions

> Learn how DLMM Dynamic Positions track LP ownership, bin ranges, liquidity shares, fees, rewards, operators, and resizable ranges up to 1,400 bins.

DLMM Dynamic Positions are the accounts that track a liquidity provider's ownership in a DLMM pool. When you add liquidity, you are not receiving a fungible LP token or a position NFT. You are creating or updating a dedicated position account that records where your liquidity sits, how much of each bin you own, and what fees or rewards are available to claim.

At the program level, this is represented by `PositionV2`. `PositionV2` starts with the default 70-bin layout and can allocate additional per-bin data when the position grows. The maximum supported position length is **1,400 bins**.

## What A Dynamic Position Stores

A Dynamic Position belongs to one pool and one owner. It stores the range of bins covered by the position, plus accounting for liquidity, fees, and liquidity mining rewards inside that range.

> **Pool and Owner**
>
> The position records the DLMM pool it belongs to and the wallet that owns it.

> **Bin Range**
>
> Lower and upper bin IDs define where the position can place liquidity.

> **Liquidity Shares**
>
> Per-bin shares determine the LP's proportional claim on fees and eligible rewards.

> **Fees and Rewards**
>
> The position tracks pending fees, liquidity mining rewards, and cumulative claimed totals.

## Position Range

Every Dynamic Position covers a continuous bin range.

```text theme={"system"}
lower bin ID                       upper bin ID
     [ bin ][ bin ][ bin ][ bin ][ bin ]
                 active bin
```

When the active bin is inside your position range and your liquidity is in bins used by swaps, the position can earn trading fees. If liquidity mining is enabled for the pool, eligible active liquidity can also earn rewards.

When price moves outside your range, the position remains open, but that position is no longer contributing active liquidity until price returns or you rebalance.

## Fees, Rewards, and Claims

Trading fees accrue to positions based on the bins where the position has liquidity and where swaps happen. A position tracks pending fees for both token X and token Y.

Liquidity mining rewards accrue through the position on reward-enabled pools when its liquidity is active, and v2 swap processing can allocate elapsed rewards across crossed bins with liquidity. Fees and rewards do not auto-compound into liquidity; they remain claimable until you claim them.

> [!NOTE]
>
> DLMM Collect Fee Mode affects which token fees are collected in at the pool level. See [DLMM Collect Fee Mode](https://docs.meteora.ag/core-products/dlmm/collect-fee-mode.md) for the fee-token behavior.

## Ownership and Operators

The position owner controls the position. The program also supports an **operator** field, which can allow another address to manage position actions such as modifying liquidity.

Some positions can have a separate **fee owner**, which controls where claimed fees should be sent. DLMM also includes permission bits that can allow specific operations, such as fee claiming, to become permissionless for a position.

> [!WARNING]
>
> Only delegate operator permissions to addresses you trust. Operators can perform position-management actions authorized by the program.

## Adding, Removing, and Closing

Adding liquidity increases the position's liquidity shares in selected bins. Removing liquidity reduces those shares and returns the corresponding token amounts from the pool.

Before liquidity is changed, the program updates fee and reward accounting so the position's claimable amounts remain accurate.

Positions can also include a `lock_release_point`. If liquidity is still locked, the program prevents liquidity removal until the lock has released. A position can only be closed once all liquidity, fees, and rewards have been cleared.

## Why Dynamic Positions Matter

> **Wider Strategy Ranges**
>
> LPs can cover more price bins in a single position, which is useful for volatile markets or long-running strategies.

> **Dynamic Account Space**
>
> The program allocates extra position data only when the position needs to grow beyond the default range.

> **Range Resizing**
>
> A position can expand or shrink its bin range instead of always closing and recreating a new account.

> **Rebalance Support**
>
> Rebalance flows can combine range updates with liquidity changes for more efficient position management.

## Resizing The Range

Dynamic Positions can be resized without closing the position first. This is useful when the market moves, volatility changes, or an LP wants to refine the position around a new price range.

| Action | Product Meaning |
| - | - |
| Increase length | Add bins to the lower side or upper side of the range. New allocation beyond the default 70-bin layout is capped at `91` added bins per resize instruction. |
| Decrease length | Remove empty bins from the lower side or upper side of the range. |
| Rebalance liquidity | Combine claim, remove, resize, and add-liquidity actions into a single position-management flow. |

> [!NOTE]
>
> In practice, this helps LPs move from a narrow high-efficiency strategy to a wider defensive range, or from a wide range back into a tighter strategy when the market stabilizes.

## Shrink Modes

Rebalance flows can choose how aggressively to shrink the existing range.

| Shrink Mode | Product Meaning |
| - | - |
| `ShrinkBoth` | Remove empty bins from both sides when possible. |
| `NoShrinkLeft` | Keep the lower side and shrink only from the upper side. |
| `NoShrinkRight` | Keep the upper side and shrink only from the lower side. |
| `NoShrinkBoth` | Keep both sides and avoid shrinking. |

## When To Use Dynamic Positions

> **Stable pair LP**
>
> Start with a tight range around the peg for high capital efficiency. If the pair begins moving outside the expected band, expand the position range to keep liquidity active across more bins.

> **Volatile pair LP**
>
> Use a wider position from the beginning so the position can stay relevant through larger price swings. Resize later if volatility cools down.

> **Launch liquidity**
>
> Cover a broader launch range while concentrating meaningful liquidity near the expected trading zone. As price discovery settles, rebalance around the new market level.

> **DCA strategy**
>
> Use a wider set of bins to gradually buy or sell through price movement, then shrink empty bins once part of the strategy is complete.

## Dynamic Positions vs Default Position Range

| Feature | Default Range | Dynamic Position Range |
| - | - | - |
| Bin coverage | 70 bins | Up to 1,400 bins |
| Account data | Default position size | Extra per-bin data allocated as needed |
| Resize allocation | No extra allocation needed | Additional allocation is limited to 91 new bins per resize instruction |
| Best fit | Tight active strategies | Wide, evolving, or launch-oriented strategies |
| Management style | Simpler range | More flexible range updates |

## What LPs Should Watch

Dynamic Positions give LPs more range flexibility, but they do not make a strategy automatically better. A wider range can keep liquidity relevant across more prices, but capital spread over many bins may earn less per bin than a tighter range.

> [!WARNING]
>
> Dynamic Positions increase flexibility, not guaranteed returns. LPs should still monitor price movement, token composition, and impermanent loss risk.


This documentation is built and hosted on [Mintlify](https://mintlify.com), a developer documentation platform.