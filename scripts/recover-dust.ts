/**
 * Чистка «пыли»: продаёт все токены на кошельке обратно в SOL.
 *
 * Зачем: при сбое входа старый код покупал токеновую половину и падал уже после
 * покупки — токены оставались на кошельке мёртвым грузом (и обесценивались).
 * Теперь вход сам продаёт купленное при откате, а этот скрипт нужен разово —
 * вычистить то, что осталось от прошлых версий.
 *
 * Запуск:
 *   npx tsx scripts/recover-dust.ts --dry     # только показать
 *   npx tsx scripts/recover-dust.ts           # продать всё
 */
import { Connection, PublicKey } from "@solana/web3.js";
import { env } from "../apps/engine/src/env.js";
import { loadWallet, sellTokenToSol } from "../apps/engine/src/executor.js";

const TOKEN_PROGRAM = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
const TOKEN_2022_PROGRAM = "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb";
const DRY = process.argv.includes("--dry");

async function main() {
  const w = loadWallet();
  if (!w) {
    console.error("кошелёк не загружен");
    process.exit(1);
  }
  console.log("кошелёк:", w.publicKey.toBase58(), DRY ? "(dry)" : "");

  const conn = new Connection(env.rpcUrl, "confirmed");
  const holdings: { mint: string; raw: bigint; ui: number; decimals: number }[] = [];
  for (const pid of [TOKEN_PROGRAM, TOKEN_2022_PROGRAM]) {
    try {
      const res = await conn.getParsedTokenAccountsByOwner(w.publicKey, { programId: new PublicKey(pid) });
      for (const acc of res.value) {
        const info: any = (acc.account as any).data.parsed.info;
        const ta = info.tokenAmount;
        if (!ta || Number(ta.amount) <= 0) continue;
        if (info.mint === env.wsolMint) continue;
        holdings.push({ mint: String(info.mint), raw: BigInt(ta.amount), ui: Number(ta.uiAmount), decimals: Number(ta.decimals) });
      }
    } catch (e: any) {
      console.log("программа", pid, "ошибка:", String(e?.message ?? e).slice(0, 120));
    }
  }

  if (!holdings.length) {
    console.log("токенов нет — чистить нечего");
    return;
  }

  const before = await conn.getBalance(w.publicKey);
  console.log(`найдено ${holdings.length} токенов, SOL до: ${(before / 1e9).toFixed(4)}`);
  for (const h of holdings) console.log(` · ${h.mint} — ${h.ui} (dec ${h.decimals})`);
  if (DRY) return;

  let ok = 0;
  for (const h of holdings) {
    try {
      const r = await sellTokenToSol(h.mint, h.raw);
      ok++;
      console.log(`продан ${h.mint}: +${(r.lamports / 1e9).toFixed(5)} SOL (${r.signature.slice(0, 8)}…)`);
    } catch (e: any) {
      console.log(`НЕ продан ${h.mint}: ${String(e?.message ?? e).slice(0, 160)}`);
    }
  }
  const after = await conn.getBalance(w.publicKey);
  console.log(`готово: ${ok}/${holdings.length}, SOL после: ${(after / 1e9).toFixed(4)} (${((after - before) / 1e9).toFixed(4)})`);
}

main().catch((e) => {
  console.error("FATAL", e);
  process.exit(1);
});