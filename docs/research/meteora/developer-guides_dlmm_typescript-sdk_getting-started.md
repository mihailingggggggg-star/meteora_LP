> ## Documentation Index
> Fetch the complete documentation index at: https://docs.meteora.ag/llms.txt
> Use this file to discover all available pages before exploring further.

# DLMM TS SDK Getting Started

> Learn how to install @meteora-ag/dlmm, create a DLMM pool client, choose a cluster, quote swaps, and test the SDK.

This guide shows how to install and initialize the official DLMM TypeScript SDK, `@meteora-ag/dlmm`.

Before you begin, here are some important resources:

> **[TypeScript SDK](https://github.com/MeteoraAg/dlmm-sdk/tree/main/ts-client)**
>
> Meteora DLMM TypeScript SDK

> **[DLMM NPM Package](https://www.npmjs.com/package/@meteora-ag/dlmm)**
>
> Meteora DLMM NPM Package

## Installation

To use the SDK in your project, install it using your preferred package manager:

**npm**

```bash theme={"system"}
npm install @meteora-ag/dlmm @solana/web3.js
```

**pnpm**

```bash theme={"system"}
pnpm install @meteora-ag/dlmm @solana/web3.js
```

**yarn**

```bash theme={"system"}
yarn add @meteora-ag/dlmm @solana/web3.js
```

## Initialization

Once installed, initialize a pool client with a Solana connection and a DLMM pool address:

```typescript theme={"system"}
import DLMM from "@meteora-ag/dlmm";
import { Connection, PublicKey } from "@solana/web3.js";
import BN from "bn.js";

const connection = new Connection(process.env.RPC_URL!, "confirmed");

const poolAddress = new PublicKey("ARwi1S4DaiTG5DX7S4M4ZsrXqpMD1MrTmbu9ue2tpmEq");
const dlmmPool = await DLMM.create(connection, poolAddress, {
  cluster: "mainnet-beta",
});
```

You can find pool addresses with the Data API:

```bash theme={"system"}
curl "https://dlmm.datapi.meteora.ag/pools?page=1&page_size=20"
```

To initialize several pools efficiently:

```typescript theme={"system"}
const pools = await DLMM.createMultiple(connection, [
  poolAddress,
  ...otherPoolAddresses,
]);
```

## Cluster And Program ID

The SDK defaults to the public DLMM program ID:

```typescript theme={"system"}
LBUZKhRxPF3XUpBCjp4YzTKgLccjZhTSDM9YuVaPwxo
```

Pass `opt` when using devnet or a custom program ID:

```typescript theme={"system"}
const dlmmPool = await DLMM.create(connection, poolAddress, {
  cluster: "devnet",
})
```

## Reference

> **[SDK Examples](https://docs.meteora.ag/developer-guides/dlmm/typescript-sdk/examples.md)**
>
> Explore full transaction flows, including pool initialization, swaps, liquidity, and more.

> **[SDK Reference](https://docs.meteora.ag/developer-guides/dlmm/typescript-sdk/reference.md)**
>
> Learn about all SDK functions: pool creation, liquidity, swaps, rewards, limit orders, and Token-2022 helpers.

## Testing The SDK

If you have cloned the SDK repository, start with package-level checks:

```bash theme={"system"}
cd ts-client
pnpm install
pnpm run build
pnpm run unit-test
```

For `commons`, CLI, scripts, and broader repository testing notes, see the [DLMM overview](https://docs.meteora.ag/developer-guides/dlmm.md#repository-map).

## Faucets

> **[Devnet Faucet](https://faucet.solana.com/)**
>
> When working on devnet, you might need test tokens. Here is a helpful faucet.


This documentation is built and hosted on [Mintlify](https://mintlify.com), a developer documentation platform.