> ## Documentation Index
> Fetch the complete documentation index at: https://docs.meteora.ag/llms.txt
> Use this file to discover all available pages before exploring further.

# DLMM Developer Guide

> Learn how to build DLMM integrations with the lb_clmm program, TypeScript SDK, Rust guides, Data API, commands, and release notes.

DLMM is Meteora's high-performance concentrated liquidity product on Solana. To learn more about DLMM such as LP strategy concepts, and economic explanations, you can read the following documentations.

> **[Learn more about DLMM](https://docs.meteora.ag/core-products/dlmm/what-is-dlmm)**
>
> Overview of DLMM, strategies, dynamic positions, limit orders, rewards, and fee concepts.

> **[DLMM Formulas](https://docs.meteora.ag/core-products/dlmm/formulas.md)**
>
> Formulas and definitions for price, liquidity, fee, and impermanent loss concepts.

## Integration

> **[Program Accounts](https://docs.meteora.ag/developer-guides/dlmm/program/accounts.md)**
>
> Account model for pools, bin arrays, positions, limit orders, oracles, presets, and operators.

> **[Program Instructions](https://docs.meteora.ag/developer-guides/dlmm/program/instructions.md)**
>
> Instruction families for pool creation, liquidity, swaps, rewards, limit orders, and admin flows.

> **[Program Events](https://docs.meteora.ag/developer-guides/dlmm/program/events.md)**
>
> Event-CPI payloads for pools, positions, liquidity, swaps, fees, rewards, rebalance, and limit order flows.

> **[Program Errors](https://docs.meteora.ag/developer-guides/dlmm/program/errors.md)**
>
> Anchor custom error codes, enum names, messages, and instruction error mapping.

> **[TypeScript SDK](https://docs.meteora.ag/developer-guides/dlmm/typescript-sdk/getting-started.md)**
>
> TypeScript SDK for interacting with all instructions on DLMM.

> **[Rust Integration](https://docs.meteora.ag/developer-guides/dlmm/rust-integration/library.md)**
>
> Rust integration with DLMM through CPI and the commons library.

> **[DLMM APIs](https://docs.meteora.ag/developer-guides/dlmm/api-reference/overview.md)**
>
> Indexed read-only pool, portfolio, wallet, position, OHLCV, stats, and limit order data.

## Program IDs

The `lb_clmm` program ID is the same on mainnet and devnet:

| Network | Program ID |
| - | - |
| Mainnet Beta | `LBUZKhRxPF3XUpBCjp4YzTKgLccjZhTSDM9YuVaPwxo` |
| Devnet | `LBUZKhRxPF3XUpBCjp4YzTKgLccjZhTSDM9YuVaPwxo` |

> **[DLMM IDL](https://github.com/MeteoraAg/dlmm-sdk/blob/main/idls/dlmm.json)**
>
> Anchor IDL for the deployed `lb_clmm` program.

> **[DLMM SDK](https://github.com/MeteoraAg/dlmm-sdk)**
>
> SDK for interacting with all instructions on DLMM.

> [!NOTE]
>
> The `lb_clmm` on-chain program source is not open sourced. Public developer integration should rely on the published IDL, the official TypeScript SDK, on-chain account data, and the DLMM Data API. If you have any questions, please reach out to us on [Discord](https://discord.gg/meteora).

## Commands

| Task | Command |
| - | - |
| Build SDK | `cd ts-client && pnpm install && pnpm run build` |
| Run SDK unit tests | `cd ts-client && pnpm run unit-test` |
| Run commons quote tests | `cargo t -p commons --test '*'` |
| Inspect CLI commands | `cargo build && target/debug/cli --help` |

Some end-to-end SDK tests may depend on local validator fixtures or program builds that are not part of the public `lb_clmm` source release. Prefer devnet scripts and transaction simulation for public integration testing.

## Stay Updated

> **[DLMM Changelog](https://docs.meteora.ag/developer-guides/dlmm/changelog.md)**
>
> Program, SDK, CLI, and commons changes for integration planning.


This documentation is built and hosted on [Mintlify](https://mintlify.com), a developer documentation platform.