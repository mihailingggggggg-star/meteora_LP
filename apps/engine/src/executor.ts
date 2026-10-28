import crypto from "node:crypto";
import {
  ComputeBudgetProgram,
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  VersionedTransaction,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import DLMM from "@meteora-ag/dlmm";
import BN from "bn.js";
import bs58 from "bs58";
import { env } from "./env.js";
import { db, getSetting, setSetting } from "./db.js";
import { updateEnvFile } from "./envfile.js";
import { journal } from "./journal.js";
import { alert, alertCritical, alertsEnabled } from "./alerts.js";
import { getConnection } from "./chain.js";
import type { Pool } from "./meteora.js";

/**
 * Исполнитель боевых операций (DLMM).
 *
 * Правила, которые здесь жёстко зашиты:
 *  • ничего не выполняется, пока не выполнены ТРИ условия: BOT_MODE=live,
 *    LIVE_EXECUTION=true и загружен ключ кошелька (`armed()`);
 *  • каждая операция пишется в onchain_ops (pending → sent → confirmed/failed)
 *    с подписью транзакции — повторный запуск не отправит её дважды;
 *  • любая ошибка цепочки поднимается наверх: движок останавливается и зовёт человека,
 *    а не «дорисовывает» результат в базе;
 *  • лимиты (3 позиции, сумма на позицию, резерв SOL на газ) проверяются здесь,
 *    а не в UI.
 */

// ─────────────────────────────── кошелёк

let wallet: Keypair | null = null;
let walletError: string | null = null;
let walletTried = false;

function decodeSecret(raw: string): Uint8Array {
  const value = raw.trim();
  // 1) JSON-массив (экспорт Phantom «Show Private Key» в виде [12, 34, …])
  if (value.startsWith("[")) {
    const arr = JSON.parse(value) as number[];
    return Uint8Array.from(arr);
  }
  // 2) enc:<iv>:<tag>:<data> — AES-256-GCM, ключ из WALLET_ENCRYPTION_KEY
  if (value.startsWith("enc:")) {
    if (!env.live.encryptionKey) throw new Error("ключ зашифрован, но WALLET_ENCRYPTION_KEY не задан");
    const [ivB64, tagB64, dataB64] = value.slice(4).split(":");
    if (!ivB64 || !tagB64 || !dataB64) throw new Error("некорректный формат enc: (ожидается enc:iv:tag:data)");
    const key = crypto.createHash("sha256").update(env.live.encryptionKey).digest();
    const decipher = crypto.createDecipheriv("aes-256-gcm", key, Buffer.from(ivB64, "base64"));
    decipher.setAuthTag(Buffer.from(tagB64, "base64"));
    const plain = Buffer.concat([decipher.update(Buffer.from(dataB64, "base64")), decipher.final()]).toString("utf8");
    return plain.startsWith("[") ? Uint8Array.from(JSON.parse(plain) as number[]) : bs58.decode(plain);
  }
  // 3) base58 (стандартный экспорт Phantom/Solflare)
  return bs58.decode(value);
}

/** Шифрование ключа для .env: enc:<iv>:<tag>:<data>. */
export function encryptSecret(secret: string, encryptionKey?: string): string {
  const keyText = encryptionKey || env.live.encryptionKey;
  if (!keyText) throw new Error("WALLET_ENCRYPTION_KEY не задан");
  const key = crypto.createHash("sha256").update(keyText).digest();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const data = Buffer.concat([cipher.update(secret, "utf8"), cipher.final()]);
  return `enc:${iv.toString("base64")}:${cipher.getAuthTag().toString("base64")}:${data.toString("base64")}`;
}

/** Ключ, сохранённый из интерфейса: { secret: "enc:…", pubkey } в таблице settings. */
export function storedWallet(): { secret: string; pubkey: string } | null {
  try {
    const v = getSetting<any>("live.wallet", null);
    if (!v || typeof v.secret !== "string" || !v.secret) return null;
    return { secret: v.secret, pubkey: String(v.pubkey ?? "") };
  } catch {
    return null;
  }
}

function secretSource(): { secret: string; pubkey: string; from: "db" | "env" | "none" } {
  const dbw = storedWallet();
  if (dbw) return { secret: dbw.secret, pubkey: dbw.pubkey || env.live.pubkey, from: "db" };
  if (env.live.secret) return { secret: env.live.secret, pubkey: env.live.pubkey, from: "env" };
  return { secret: "", pubkey: "", from: "none" };
}

/** Для статуса: откуда берётся ключ и задан ли ключ шифрования. */
export function walletInfo() {
  const src = secretSource();
  return {
    walletSource: src.from,
    encryptionKeyPresent: Boolean(env.live.encryptionKey),
    secretPresent: src.from !== "none",
    secretEncrypted: src.secret.startsWith("enc:"),
  };
}

function resetWalletCache() {
  wallet = null;
  walletTried = false;
  walletError = null;
}

/** Загружается ключ шифрования: из .env, а если его нет — генерируем и сохраняем в .env. */
function encryptionKey(createIfMissing: boolean): string {
  if (env.live.encryptionKey) return env.live.encryptionKey;
  if (!createIfMissing) return "";
  const key = crypto.randomBytes(32).toString("base64");
  updateEnvFile({ WALLET_ENCRYPTION_KEY: key });
  env.live.encryptionKey = key;
  journal("WARN", "сгенерирован WALLET_ENCRYPTION_KEY и сохранён в .env (ключ кошелька будет зашифрован)");
  return key;
}

/**
 * Сохранение ключа из интерфейса: расшифровываем/валидируем, шифруем AES-256-GCM
 * и кладём в БД. В журнал попадает только адрес — сам ключ не логируется никогда.
 */
export function setWalletSecret(rawSecret: string, pubkeyHint?: string): { pubkey: string; encrypted: boolean } {
  const raw = String(rawSecret ?? "").trim();
  if (!raw) throw new Error("пустой ключ");
  const bytes = decodeSecret(raw);
  const kp = Keypair.fromSecretKey(bytes);
  const pubkey = kp.publicKey.toBase58();
  if (pubkeyHint && pubkeyHint.trim() && pubkeyHint.trim() !== pubkey) {
    throw new Error(`ключ не соответствует указанному адресу (у ключа ${pubkey})`);
  }
  const key = encryptionKey(true);
  const payload = `enc:${(() => {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv("aes-256-gcm", crypto.createHash("sha256").update(key).digest(), iv);
    const data = Buffer.concat([cipher.update(raw, "utf8"), cipher.final()]);
    return `${iv.toString("base64")}:${cipher.getAuthTag().toString("base64")}:${data.toString("base64")}`;
  })()}`;
  setSetting("live.wallet", { secret: payload, pubkey, at: Date.now() });
  resetWalletCache();
  journal("BOOT", `кошелёк подключён из интерфейса: ${pubkey} (ключ зашифрован AES-256-GCM)`, { wallet: pubkey });
  return { pubkey, encrypted: true };
}

export function clearWallet(): void {
  setSetting("live.wallet", null);
  resetWalletCache();
  journal("WARN", "кошелёк отключён из интерфейса (ключ удалён из базы)");
}

export function loadWallet(): Keypair | null {
  if (walletTried) return wallet;
  walletTried = true;
  const src = secretSource();
  if (!src.secret) {
    walletError = "кошелёк не подключён: ни в интерфейсе, ни в .env нет ключа";
    return null;
  }
  try {
    const kp = Keypair.fromSecretKey(decodeSecret(src.secret));
    if (src.pubkey && kp.publicKey.toBase58() !== src.pubkey) {
      walletError = `ключ не соответствует указанному адресу (${kp.publicKey.toBase58()})`;
      return null;
    }
    wallet = kp;
    walletError = null;
    return wallet;
  } catch (err: any) {
    walletError = `не удалось прочитать ключ: ${err?.message ?? err}`;
    return null;
  }
}

export function walletAddress(): string | null {
  return loadWallet()?.publicKey.toBase58() ?? null;
}

/** Три условия боевого режима. Пока не выполнены — все операции пропускаются. */
export function armed(): boolean {
  return env.mode === "live" && env.live.enabled && loadWallet() !== null;
}

export function readiness(): { ok: boolean; reasons: string[] } {
  const reasons: string[] = [];
  const src = secretSource();
  if (env.mode !== "live") reasons.push("BOT_MODE=demo — движок считает симуляцию");
  if (!env.live.enabled) reasons.push("LIVE_EXECUTION=false — реальные транзакции выключены");
  // ключ может быть подключён из интерфейса (БД) — проверяем оба источника
  if (src.from === "none") reasons.push("кошелёк не подключён — подключите в разделе «Боевой режим»");
  else if (!loadWallet()) reasons.push(walletError ?? "ключ не загрузился");
  if (alertsEnabled() === false) reasons.push("TG_BOT_TOKEN/TG_CHAT_ID не заданы — алертов не будет");
  return { ok: reasons.length === 0, reasons };
}

// ─────────────────────────────── учёт операций

export type OpKind = "OPEN" | "CLOSE" | "CLAIM";

function opStart(kind: OpKind, positionId: number, payload: Record<string, unknown>): number {
  const info = db
    .prepare(
      `INSERT INTO onchain_ops (position_id, kind, status, pool, amount_usd, payload, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?)`,
    )
    .run(
      positionId,
      kind,
      "pending",
      String(payload.pool ?? ""),
      Number(payload.capital ?? 0),
      JSON.stringify(payload),
      Date.now(),
      Date.now(),
    );
  return Number(info.lastInsertRowid);
}

function opUpdate(
  id: number,
  patch: { status?: string; signature?: string; error?: string; positionPubkey?: string },
): void {
  const sets: string[] = [];
  const values: (string | number | null)[] = [];
  if (patch.status) {
    sets.push("status = ?");
    values.push(patch.status);
  }
  if (patch.signature) {
    sets.push("signature = ?");
    values.push(patch.signature);
  }
  if (patch.error) {
    sets.push("error = ?");
    values.push(patch.error.slice(0, 500));
  }
  if (patch.positionPubkey) {
    sets.push("position_pubkey = ?");
    values.push(patch.positionPubkey);
  }
  sets.push("updated_at = ?");
  values.push(Date.now());
  db.prepare(`UPDATE onchain_ops SET ${sets.join(", ")} WHERE id = ?`).run(...values, id);
}

/** Незавершённая операция того же типа — значит процесс упал между отправкой и подтверждением. */
export function pendingOp(positionId: number, kind: OpKind): any | null {
  return (
    (db
      .prepare(
        `SELECT * FROM onchain_ops WHERE position_id = ? AND kind = ? AND status IN ('pending','sent') ORDER BY id DESC LIMIT 1`,
      )
      .get(positionId, kind) as any) ?? null
  );
}

// ─────────────────────────────── сеть

async function withRpc<T>(fn: (conn: Connection) => Promise<T>): Promise<T> {
  try {
    return await fn(getConnection());
  } catch (err: any) {
    const fallback = env.rpcFallback;
    if (!fallback) throw err;
    journal("WARN", `основной RPC не ответил (${err?.message ?? err}) → резервный`);
    return fn(new Connection(fallback, { commitment: "confirmed" }));
  }
}

/** Кластер берём из RPC: devnet-адрес → devnet, иначе mainnet-beta. */
function clusterOf(): "mainnet-beta" | "devnet" {
  return env.rpcUrl.includes("devnet") ? "devnet" : "mainnet-beta";
}

function priorityIx() {
  return ComputeBudgetProgram.setComputeUnitPrice({ microLamports: Math.round(env.live.priorityFeeMicroLamports) });
}

/** Подпись и отправка по очереди: часть методов DLMM возвращает массив транзакций. */
async function sendAll(txs: Transaction[], extraSigners: Keypair[], label: string): Promise<string[]> {
  const w = loadWallet();
  if (!w) throw new Error("кошелёк не загружен");
  // что уже отправлено в этом вызове — чтобы повтор на резервном RPC не отправил
  // ту же транзакцию второй раз (двойное открытие/закрытие)
  const sent = new Map<Transaction, string>();
  const sigs: string[] = [];
  return withRpc(async (conn) => {
    for (const tx of txs) {
      const already = sent.get(tx);
      if (already) {
        if (!sigs.includes(already)) sigs.push(already);
        continue;
      }
      tx.feePayer = tx.feePayer ?? w.publicKey;
      // Идемпотентно: withRpc может повторить весь блок на резервном RPC, и тогда
      // tx.add() вставлял вторую ComputeBudget-инструкцию → «Transaction contains a
      // duplicate instruction». Ровно на этом упало повторное открытие после
      // ребаланса: позицию закрыли, открыть не смогли.
      const hasComputeBudget = tx.instructions.some((ix) =>
        ix.programId.equals(ComputeBudgetProgram.programId),
      );
      if (!hasComputeBudget) tx.add(priorityIx());

      // Репетиция: сначала симулируем. Если цепь говорит «не пройдёт» —
      // не отправляем и не жжём комиссию, а поднимаем ошибку (движок остановится и позовёт человека).
      try {
        const sim = await conn.simulateTransaction(tx, [w, ...extraSigners]);
        if (sim.value.err) {
          const logs = (sim.value.logs ?? []).slice(-4).join(" | ");
          const msg = `симуляция не прошла: ${JSON.stringify(sim.value.err)} · ${logs}`;
          if (env.live.dryRun) {
            // репетиция: транзакцию всё равно не отправляем, а токены не покупались —
            // значит и балансы не те. Логируем и идём дальше, торговлю не останавливаем.
            journal("WARN", `${label}: репетиция — симуляция не прошла (${msg})`, { label });
          } else {
            throw new Error(msg);
          }
        }
        journal("LIVE", `${label}: симуляция ok (units ${sim.value.unitsConsumed ?? "?"})`, {
          label,
          units: sim.value.unitsConsumed ?? null,
        });
      } catch (err: any) {
        if (String(err?.message ?? err).startsWith("симуляция не прошла")) throw err;
        journal("WARN", `${label}: симуляцию выполнить не удалось (${err?.message ?? err}) — отправляем дальше`, { label });
      }

      if (env.live.dryRun) {
        journal("LIVE", `${label}: DRY-RUN — транзакция не отправлена (LIVE_DRY_RUN=true)`, { label, dryRun: true });
        sigs.push("dry-run");
        continue;
      }

      const sig = await sendAndConfirmTransaction(conn, tx, [w, ...extraSigners], {
        commitment: "confirmed",
        maxRetries: 3,
      });
      sent.set(tx, sig);
      sigs.push(sig);
      journal("LIVE", `${label}: подтверждено ${sig}`, { label, signature: sig });
    }
    return sigs;
  });
}

const TOKEN_PROGRAM = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
const TOKEN_2022_PROGRAM = "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb";

/**
 * Баланс токена. Проверяем ОБА токен-программы: часть мемкоинов — Token-2022,
 * и раньше такие монеты «не находились», из-за чего вход отменялся сразу после докупки.
 */
async function tokenBalanceRaw(mint: string): Promise<bigint> {
  const w = loadWallet();
  if (!w) return 0n;
  const key = new PublicKey(mint);
  let sum = 0n;
  for (const programId of [TOKEN_PROGRAM, TOKEN_2022_PROGRAM]) {
    try {
      const res = await withRpc((conn) =>
        conn.getParsedTokenAccountsByOwner(w.publicKey, { mint: key, programId: new PublicKey(programId) }),
      );
      for (const acc of res.value) {
        const amt = (acc.account as any)?.data?.parsed?.info?.tokenAmount?.amount;
        if (amt) sum += BigInt(amt);
      }
    } catch {
      /* нет такого аккаунта в этой программе */
    }
  }
  return sum;
}

/** Ждём, пока RPC увидит новый баланс после свопа (обычно 1–3 секунды). */
async function waitForTokenBalance(mint: string, need: bigint, tries = 6): Promise<bigint> {
  let have = await tokenBalanceRaw(mint);
  for (let i = 0; i < tries && have < need; i++) {
    await new Promise((r) => setTimeout(r, 800));
    have = await tokenBalanceRaw(mint);
  }
  return have;
}

/**
 * Сколько реально доступно для входа по этому минту.
 *
 * Для SOL — нативные ламports минус резерв газа. Раньше здесь вызывался
 * tokenBalanceRaw(WSOL) и возвращал 0: отдельного WSOL-аккаунта у бота нет,
 * DLMM сам заворачивает SOL. Из-за этого КАЖДЫЙ вход в SOL-пару падал с
 * «на кошельке нет нужных токенов» уже после того, как токен был куплен.
 */
async function availableForMint(mint: string, reserveLamports: number): Promise<bigint> {
  if (mint === env.wsolMint) {
    const lamports = await solBalance();
    return BigInt(Math.max(0, Math.floor(lamports - reserveLamports)));
  }
  return tokenBalanceRaw(mint);
}

/**
 * Докупка токеновой половины через Jupiter.
 *
 * Зачем: симметричная позиция 50/50 требует ОБА токена. На кошельке бота лежит SOL —
 * без этого шага первая же попытка открыть позицию падала бы по «insufficient funds»
 * (и мы бы «жгли» комиссию на неудачной транзакции).
 */
async function ensureToken(mint: string, needRaw: bigint, usdNeed: number, solPriceUsd: number): Promise<bigint> {
  const w = loadWallet();
  if (!w) throw new Error("кошелёк не загружен");
  if (needRaw <= 0n) return 0n;

  const have = await tokenBalanceRaw(mint);
  if (have >= needRaw) return 0n;
  const shortRaw = needRaw - have;
  // сумма в SOL с запасом 2 % на проскальзывание и округление
  const lamports = BigInt(Math.ceil((usdNeed * (Number(shortRaw) / Number(needRaw))) / Math.max(1e-9, solPriceUsd) * 1e9 * 1.02));
  if (lamports <= 0n) return 0n;

  journal("LIVE", `докупка токена под 50/50: не хватает ${shortRaw.toString()} (≈${(Number(lamports) / 1e9).toFixed(4)} SOL)`, {
    mint,
    need: needRaw.toString(),
    have: have.toString(),
    lamports: lamports.toString(),
  });

  const jfetch = async (url: string, init?: RequestInit, tries = 3): Promise<Response> => {
    let last: Response | null = null;
    for (let i = 0; i < tries; i++) {
      const res = await fetch(url, init);
      if (res.ok) return res;
      last = res;
      // 429 — лимит публичного API: ждём и пробуем ещё
      if (res.status === 429) {
        await new Promise((r) => setTimeout(r, 1200 * (i + 1)));
        continue;
      }
      return res;
    }
    return last as Response;
  };

  const qres = await jfetch(
    `${env.jupiterBase}/quote?inputMint=${env.wsolMint}&outputMint=${mint}&amount=${lamports.toString()}&slippageBps=${Math.round(env.live.slippagePct * 100)}`,
  );
  if (!qres.ok) throw new Error(`jupiter: котировка недоступна (${qres.status}) — попробуем позже`);
  const quote = await qres.json();

  const sres = await jfetch(`${env.jupiterBase}/swap`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      quoteResponse: quote,
      userPublicKey: w.publicKey.toBase58(),
      wrapAndUnwrapSol: true,
      dynamicComputeUnitLimit: true,
    }),
  });
  if (!sres.ok) throw new Error(`jupiter: сборка swap не удалась (${sres.status}) — попробуем позже`);
  const { swapTransaction } = (await sres.json()) as { swapTransaction: string };
  const tx = VersionedTransaction.deserialize(Buffer.from(swapTransaction, "base64"));

  if (env.live.dryRun) {
    journal("LIVE", "докупка токена: DRY-RUN, транзакция не отправлена", { mint, lamports: lamports.toString() });
    return 0n;
  }

  tx.sign([w]);
  const sig = await withRpc((conn) => conn.sendTransaction(tx, { maxRetries: 3 }));
  await withRpc((conn) => conn.confirmTransaction(sig, "confirmed"));
  // даём RPC увидеть новый токен-аккаунт, иначе вход отменится «нет токенов»
  await waitForTokenBalance(mint, needRaw);
  journal("LIVE", `докупка токена выполнена: ${sig} (+${quote.outAmount} raw)`, {
    mint,
    signature: sig,
    outAmount: String(quote.outAmount),
    lamports: lamports.toString(),
  });
  return BigInt(String(quote.outAmount));
}
/**
 * Продажа токена обратно в SOL. Нужна для двух вещей:
 *  1) откат после сорванного входа — купленный токен не должен оставаться «мешком»;
 *  2) разовая чистка пыли, оставшейся от прошлых сбоев (scripts/recover-dust.ts).
 */
export async function sellTokenToSol(
  mint: string,
  rawAmount: bigint,
  slippageBps = 400,
): Promise<{ signature: string; lamports: number }> {
  const w = loadWallet();
  if (!w) throw new Error("кошелёк не загружен");
  if (rawAmount <= 0n) throw new Error("нечего продавать");
  const jf = async (url: string, init?: RequestInit, tries = 3): Promise<Response> => {
    let last: Response | null = null;
    for (let i = 0; i < tries; i++) {
      const res = await fetch(url, init);
      if (res.ok) return res;
      last = res;
      if (res.status === 429) {
        await new Promise((r) => setTimeout(r, 1200 * (i + 1)));
        continue;
      }
      return res;
    }
    return last as Response;
  };
  const q = await jf(
    `${env.jupiterBase}/quote?inputMint=${mint}&outputMint=${env.wsolMint}&amount=${rawAmount.toString()}&slippageBps=${slippageBps}`,
  );
  if (!q.ok) throw new Error(`jupiter: котировка на продажу недоступна (${q.status})`);
  const quote: any = await q.json();
  const s = await jf(`${env.jupiterBase}/swap`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      quoteResponse: quote,
      userPublicKey: w.publicKey.toBase58(),
      wrapAndUnwrapSol: true,
      dynamicComputeUnitLimit: true,
    }),
  });
  if (!s.ok) throw new Error(`jupiter: сборка swap на продажу не удалась (${s.status})`);
  const { swapTransaction } = (await s.json()) as { swapTransaction: string };
  const tx = VersionedTransaction.deserialize(Buffer.from(swapTransaction, "base64"));
  tx.sign([w]);
  const sig = await withRpc((conn) => conn.sendTransaction(tx, { maxRetries: 3 }));
  await withRpc((conn) => conn.confirmTransaction(sig, "confirmed"));
  const lamports = Number(quote?.outAmount ?? 0);
  journal("LIVE", `продажа токена в SOL: +${(lamports / 1e9).toFixed(4)} SOL`, {
    mint,
    amount: rawAmount.toString(),
    signature: sig,
  });
  return { signature: sig, lamports };
}

export type WalletBalance = {
  sol: number;
  solUsd: number;
  tokens: { mint: string; amount: number; usd: number; priced: boolean }[];
  /** токены без цены в Jupiter — они не входят в totalUsd, но видны в списке */
  unpricedCount: number;
  totalUsd: number;
  address: string | null;
};

/** Реальный баланс кошелька: SOL + токены, оценка в USD через Jupiter Price API. */
export async function walletBalance(): Promise<WalletBalance> {
  const w = loadWallet();
  if (!w) return { sol: 0, solUsd: 0, tokens: [], unpricedCount: 0, totalUsd: 0, address: null };

  const [lamports, accounts] = await withRpc(async (conn) => {
    const bal = await conn.getBalance(w.publicKey);
    // ОБЕ токен-программы: мемкоины всё чаще Token-2022, а старый код смотрел
    // только Tokenkeg — токены просто не попадали в отчёт по кошельку.
    const all: any[] = [];
    for (const pid of [TOKEN_PROGRAM, TOKEN_2022_PROGRAM]) {
      try {
        const accs = await conn.getParsedTokenAccountsByOwner(w.publicKey, { programId: new PublicKey(pid) });
        all.push(...accs.value);
      } catch {
        /* программы может не быть в ответе RPC — не критично */
      }
    }
    return [bal, all] as const;
  });

  const holdings = new Map<string, number>();
  for (const acc of accounts) {
    const info: any = (acc.account as any)?.data?.parsed?.info;
    const amount = Number(info?.tokenAmount?.uiAmount ?? 0);
    const mint = String(info?.mint ?? "");
    if (!mint || !(amount > 0)) continue;
    holdings.set(mint, (holdings.get(mint) ?? 0) + amount);
  }

  const ids = [env.wsolMint, ...holdings.keys()].join(",");
  let prices: Record<string, number> = {};
  try {
    const res = await fetch(`https://lite-api.jup.ag/price/v3?ids=${ids}`);
    if (res.ok) {
      const data: any = await res.json();
      for (const [mint, v] of Object.entries(data ?? {})) prices[mint] = Number((v as any)?.usdPrice ?? 0);
    }
  } catch {
    /* без цен покажем только SOL */
  }

  const sol = lamports / 1e9;
  const solUsd = sol * (prices[env.wsolMint] ?? 0);
  const tokens = [...holdings.entries()]
    .map(([mint, amount]) => {
      const price = prices[mint] ?? 0;
      return { mint, amount, usd: amount * price, priced: price > 0 };
    })
    // без цены токен раньше просто ИСЧЕЗАЛ из отчёта — теперь показываем его,
    // но в totalUsd он не входит (честнее, чем рисовать ноль или прятать)
    .filter((t) => t.usd >= 0.5 || !t.priced)
    .sort((a, b) => b.usd - a.usd)
    .slice(0, 12);
  const unpricedCount = tokens.filter((t) => !t.priced).length;

  return {
    sol,
    solUsd,
    tokens,
    unpricedCount,
    totalUsd: solUsd + tokens.reduce((s, t) => s + (t.priced ? t.usd : 0), 0),
    address: w.publicKey.toBase58(),
  };
}

export async function solBalance(): Promise<number> {
  const w = loadWallet();
  if (!w) return 0;
  return withRpc((conn) => conn.getBalance(w.publicKey));
}

// ─────────────────────────────── операции

export type OpenArgs = {
  positionId: number;
  pool: Pool;
  capitalUsd: number;
  /** смещения бинов относительно активного (отрицательные — ниже цены) */
  minK: number;
  maxK: number;
  solPriceUsd: number;
};

function strategyType(): number {
  switch (env.strategy.distribution) {
    case "curve":
      return 1; // StrategyType.Curve
    default:
      return 0; // StrategyType.Spot
  }
}

/**
 * Открытие реальной позиции: считается 50/50 по USD, диапазон берётся из плана,
 * бины — от активного бина на момент отправки (план мог «состариться»).
 */
export async function openPosition(args: OpenArgs): Promise<{ signature: string; positionPubkey: string }> {
  const w = loadWallet();
  if (!w) throw new Error(walletError ?? "кошелёк не загружен");
  if (!armed()) throw new Error("live-исполнение не включено");

  // ── лимиты
  const openCount = (db.prepare(`SELECT COUNT(*) AS n FROM positions WHERE mode='live' AND status='open'`).get() as any).n;
  if (Number(openCount) >= env.live.maxPositions) {
    throw new Error(`лимит позиций: уже открыто ${openCount} из ${env.live.maxPositions}`);
  }
  let capital = args.capitalUsd;
  if (env.live.maxPositionUsd > 0 && capital > env.live.maxPositionUsd) {
    journal("WARN", `сумма позиции урезана до лимита $${env.live.maxPositionUsd} (было $${capital.toFixed(2)})`);
    capital = env.live.maxPositionUsd;
  }

  const lamports = await solBalance();
  const reserve = env.live.minSolReserve * 1e9;
  // нужен ВЕСЬ капитал в SOL: половина останется в SOL, вторая половина будет обменяна в токен
  const needLamports = (capital / Math.max(1e-9, args.solPriceUsd)) * 1e9;
  if (lamports < reserve + needLamports) {
    throw new Error(
      `недостаточно SOL: есть ${(lamports / 1e9).toFixed(4)}, нужно ${((reserve + needLamports) / 1e9).toFixed(4)} (позиция + резерв газа ${env.live.minSolReserve})`,
    );
  }

  const pool = args.pool;
  const px = pool.tokenX.price > 0 ? pool.tokenX.price : 0;
  const py = pool.tokenY.price > 0 ? pool.tokenY.price : 0;
  if (!px || !py) throw new Error("нет цены одного из токенов пула — открытие невозможно");

  const usdX = capital / 2;
  const usdY = capital / 2;
  const amountX = BigInt(Math.floor((usdX / px) * 10 ** pool.tokenX.decimals));
  const amountY = BigInt(Math.floor((usdY / py) * 10 ** pool.tokenY.decimals));
  if (amountX <= 0n || amountY <= 0n) throw new Error("сумма позиции слишком мала для этого пула");

  // токеновая половина: если её нет на кошельке — покупаем через Jupiter
  const xIsWsol = pool.tokenX.address === env.wsolMint;
  const tokenMint = xIsWsol ? pool.tokenY.address : pool.tokenX.address;
  const tokenNeed = xIsWsol ? amountY : amountX;
  // Если вход сорвётся ПОСЛЕ покупки токена, купленное продаём обратно в SOL:
  // иначе на кошельке остаются «брошенные» мешки, а следующая попытка докупает ещё раз.
  let boughtRaw = 0n;
  let amountXuse = 0n;
  let amountYuse = 0n;
  try {
    boughtRaw = await ensureToken(tokenMint, tokenNeed, capital / 2, args.solPriceUsd);

  // Фактические балансы могут быть меньше расчётных (проскальзывание при докупке,
  // округление, комиссия за перевод). Если отправить больше, чем есть,
  // транзакция упадёт на симуляции — поэтому режем суммы по факту.
    // SOL-сторона проверяется по нативному балансу ламports, а не по WSOL-аккаунту:
    // отдельного WSOL-ATA у бота нет, DLMM заворачивает SOL сам. Раньше здесь
    // получался 0 и КАЖДЫЙ вход в SOL-пару отменялся уже после покупки токена.
    const balXraw = await availableForMint(pool.tokenX.address, reserve);
    const balYraw = await availableForMint(pool.tokenY.address, reserve);
    amountXuse = amountX > balXraw ? balXraw : amountX;
    amountYuse = amountY > balYraw ? balYraw : amountY;
    if (env.live.dryRun) {
      // репетиция ничего не покупает: проверяем логику входа, а не наличие токена
      amountXuse = amountX;
      amountYuse = amountY;
    }
    if (amountXuse <= 0n || amountYuse <= 0n) {
      throw new Error("на кошельке нет нужных токенов для входа (после докупки)");
    }
    if (amountXuse !== amountX || amountYuse !== amountY) {
      journal("WARN", `суммы входа урезаны по балансу: X ${amountX}→${amountXuse}, Y ${amountY}→${amountYuse}`, {
        position: args.positionId,
        amountX: amountXuse.toString(),
        amountY: amountYuse.toString(),
      });
    }
  } catch (err: any) {
    // вход не состоялся — возвращаем купленный токен в SOL, чтобы не терять деньги
    if (boughtRaw > 0n) {
      try {
        const back = await sellTokenToSol(tokenMint, boughtRaw);
        journal("LIVE", `вход отменён — докупленный токен продан обратно: +${(back.lamports / 1e9).toFixed(4)} SOL`, {
          mint: tokenMint,
          soldRaw: boughtRaw.toString(),
          lamports: back.lamports,
        });
      } catch (e2: any) {
        journal("WARN", `вход отменён, но продать токен обратно не удалось: ${e2?.message ?? e2}`, {
          mint: tokenMint,
          soldRaw: boughtRaw.toString(),
        });
      }
    }
    throw err;
  }
  const opId = opStart("OPEN", args.positionId, {
    pool: pool.address,
    capital,
    minK: args.minK,
    maxK: args.maxK,
  });

  const positionKp = Keypair.generate();
  try {
    const dlmm = await withRpc((conn) => DLMM.create(conn, new PublicKey(pool.address), { cluster: clusterOf() }));
    const active = await dlmm.getActiveBin();
    const activeBinId = Number(active.binId);
    const strategy = {
      minBinId: activeBinId + Math.round(args.minK),
      maxBinId: activeBinId + Math.round(args.maxK),
      strategyType: strategyType(),
    };

    const tx = await dlmm.initializePositionAndAddLiquidityByStrategy({
      positionPubKey: positionKp.publicKey,
      user: w.publicKey,
      totalXAmount: new BN(amountXuse.toString()),
      totalYAmount: new BN(amountYuse.toString()),
      strategy,
      slippage: env.live.slippagePct,
    });

    const sigs = await sendAll([tx], [positionKp], `OPEN pos#${args.positionId} ${pool.name}`);
    const signature = sigs[0] ?? "";

    if (env.live.dryRun) {
      // репетиция: позиции в цепочке НЕТ, поэтому не пишем фейковые адрес и подпись
      opUpdate(opId, { status: "dry_run" });
      journal("WARN", `pos#${args.positionId}: репетиция (dry-run) — позиция не отправлена, учёт только в демо-логике`, {
        position: args.positionId,
      });
      return { signature: "dry-run", positionPubkey: "" };
    }

    opUpdate(opId, { status: "confirmed", signature, positionPubkey: positionKp.publicKey.toBase58() });
    db.prepare(`UPDATE positions SET onchain_pubkey = ?, open_signature = ? WHERE id = ?`).run(
      positionKp.publicKey.toBase58(),
      signature,
      args.positionId,
    );
    journal(
      "ENTER",
      `pos#${args.positionId} открыта в цепочке: ${positionKp.publicKey.toBase58()} (tx ${signature}) бины ${strategy.minBinId}…${strategy.maxBinId}`,
      {
        position: args.positionId,
        positionPubkey: positionKp.publicKey.toBase58(),
        signature,
        minBinId: strategy.minBinId,
        maxBinId: strategy.maxBinId,
        amountX: amountX.toString(),
        amountY: amountY.toString(),
        capital,
      },
    );
    return { signature, positionPubkey: positionKp.publicKey.toBase58() };
  } catch (err: any) {
    opUpdate(opId, { status: "failed", error: String(err?.message ?? err) });
    throw err;
  }
}

/** Выход: снять всю ликвидность, забрать комиссии и закрыть аккаунт позиции. */
export async function closePosition(positionId: number, poolAddress: string, reason: string): Promise<string[]> {
  if (!armed()) return [];
  const w = loadWallet()!;
  const row = db.prepare(`SELECT onchain_pubkey FROM positions WHERE id = ?`).get(positionId) as any;
  const pubkey = row?.onchain_pubkey;
  if (!pubkey) {
    if (!env.live.dryRun) {
      await alert(`pos#${positionId}: нет адреса позиции в цепочке — закрываю только в базе`, `no-pubkey-${positionId}`);
    }
    return [];
  }

  const opId = opStart("CLOSE", positionId, { pool: poolAddress, capital: 0 });
  try {
    const dlmm = await withRpc((conn) => DLMM.create(conn, new PublicKey(poolAddress), { cluster: clusterOf() }));
    const { userPositions } = await dlmm.getPositionsByUserAndLbPair(w.publicKey);
    const found = userPositions.find((p: any) => p.publicKey.toBase58() === pubkey);
    const binIds: number[] = ((found as any)?.positionData?.positionBinData ?? []).map((b: any) => Number(b.binId));
    const fromBinId = binIds.length ? Math.min(...binIds) : 0;
    const toBinId = binIds.length ? Math.max(...binIds) : 0;

    const txs = await dlmm.removeLiquidity({
      user: w.publicKey,
      position: new PublicKey(pubkey),
      fromBinId,
      toBinId,
      bps: new BN(10000),
      shouldClaimAndClose: true,
    });
    const sigs = await sendAll(txs as Transaction[], [], `CLOSE pos#${positionId} ${reason}`);
    opUpdate(opId, { status: "confirmed", signature: sigs[sigs.length - 1] ?? "", positionPubkey: pubkey });
    journal("LIVE", `pos#${positionId} закрыта в цепочке`, {
      position: positionId,
      signatures: sigs,
      reason,
      bins: { fromBinId, toBinId },
    });
    return sigs;
  } catch (err: any) {
    opUpdate(opId, { status: "failed", error: String(err?.message ?? err) });
    throw err;
  }
}

/** Снятие комиссий с позиции. */
export async function claimFees(positionId: number, poolAddress: string): Promise<string[]> {
  if (!armed()) return [];
  const w = loadWallet()!;
  const row = db.prepare(`SELECT onchain_pubkey FROM positions WHERE id = ?`).get(positionId) as any;
  const pubkey = row?.onchain_pubkey;
  if (!pubkey) return [];

  const opId = opStart("CLAIM", positionId, { pool: poolAddress, capital: 0 });
  try {
    const dlmm = await withRpc((conn) => DLMM.create(conn, new PublicKey(poolAddress), { cluster: clusterOf() }));
    const { userPositions } = await dlmm.getPositionsByUserAndLbPair(w.publicKey);
    const found = userPositions.find((p: any) => p.publicKey.toBase58() === pubkey);
    if (!found) {
      opUpdate(opId, { status: "failed", error: "позиция не найдена в цепочке" });
      return [];
    }
    const txs = await dlmm.claimSwapFee({ owner: w.publicKey, position: found as any });
    const sigs = await sendAll(txs as Transaction[], [], `CLAIM pos#${positionId}`);
    opUpdate(opId, { status: "confirmed", signature: sigs[sigs.length - 1] ?? "", positionPubkey: pubkey });
    return sigs;
  } catch (err: any) {
    opUpdate(opId, { status: "failed", error: String(err?.message ?? err) });
    throw err;
  }
}

// ─────────────────────────────── сверка

/**
 * Позиция, прочитанная ИЗ ЦЕПОЧКИ (источник правды в live-режиме).
 * Суммы — в сырых единицах токенов, как их отдаёт DLMM.
 */
export type ChainPos = {
  positionPubkey: string;
  activeBinId: number;
  lowerBinId: number;
  upperBinId: number;
  totalX: string;
  totalY: string;
  feeX: string;
  feeY: string;
  claimedFeeX: string;
  claimedFeeY: string;
  at: number;
};

/**
 * Читает состояние позиции из DLMM: сколько токенов реально лежит в бинах,
 * сколько комиссий накоплено и не забрано, в каком бине сейчас цена.
 * Возвращает null, если позиции в цепочке нет (закрыта/перенесена вручную).
 */
export async function chainPosition(poolAddress: string, positionPubkey: string): Promise<ChainPos | null> {
  const w = loadWallet();
  if (!w) return null;
  return withRpc(async (conn) => {
    const dlmm = await DLMM.create(conn, new PublicKey(poolAddress), { cluster: clusterOf() });
    const [active, mine] = await Promise.all([
      dlmm.getActiveBin(),
      dlmm.getPositionsByUserAndLbPair(w.publicKey),
    ]);
    const found: any = (mine.userPositions ?? []).find((p: any) => p.publicKey.toBase58() === positionPubkey);
    if (!found) return null;
    const d: any = found.positionData ?? {};
    const str = (v: any) => (v == null ? "0" : String(v.toString()));
    return {
      positionPubkey,
      activeBinId: Number(active?.binId ?? 0),
      lowerBinId: Number(d.lowerBinId ?? 0),
      upperBinId: Number(d.upperBinId ?? 0),
      totalX: str(d.totalXAmount),
      totalY: str(d.totalYAmount),
      feeX: str(d.feeX),
      feeY: str(d.feeY),
      claimedFeeX: str(d.totalClaimedFeeXAmount),
      claimedFeeY: str(d.totalClaimedFeeYAmount),
      at: Date.now(),
    } satisfies ChainPos;
  });
}

export type ReconcileResult = {
  ok: boolean;
  sol: number;
  chainPositions: number;
  dbOpen: number;
  missing: string[];
  extra: string[];
  notes: string[];
};

/**
 * Сверка базы с цепочкой: сколько позиций реально открыто и на месте ли каждая.
 * Расхождение → остановка торговли и алерт (лучше встать, чем управлять «фантомом»).
 */
export async function reconcile(): Promise<ReconcileResult> {
  const notes: string[] = [];
  const empty: ReconcileResult = { ok: true, sol: 0, chainPositions: 0, dbOpen: 0, missing: [], extra: [], notes };
  if (!loadWallet()) return { ...empty, ok: false, notes: [walletError ?? "кошелёк не загружен"] };
  if (env.live.dryRun) return { ...empty, notes: ["dry-run: сверка с цепочкой отключена"] };

  const rows = db
    .prepare(`SELECT id, pool, onchain_pubkey FROM positions WHERE mode='live' AND status='open'`)
    .all() as any[];

  const sol = (await solBalance()) / 1e9;
  const missing: string[] = [];
  const extra: string[] = [];
  let chainPositions = 0;

  const byPool = new Map<string, { id: number; pubkey: string | null }[]>();
  for (const r of rows) {
    const list = byPool.get(r.pool) ?? [];
    list.push({ id: Number(r.id), pubkey: r.onchain_pubkey ?? null });
    byPool.set(r.pool, list);
  }

  for (const [poolAddress, list] of byPool) {
    try {
      const dlmm = await withRpc((conn) => DLMM.create(conn, new PublicKey(poolAddress), { cluster: clusterOf() }));
      const { userPositions } = await dlmm.getPositionsByUserAndLbPair(loadWallet()!.publicKey);
      chainPositions += userPositions.length;
      const onChain = new Set(userPositions.map((p: any) => p.publicKey.toBase58()));
      for (const item of list) {
        if (!item.pubkey || !onChain.has(item.pubkey)) missing.push(`pos#${item.id}`);
      }
      if (!list.length && userPositions.length) extra.push(poolAddress);
    } catch (err: any) {
      notes.push(`не удалось прочитать ${poolAddress}: ${err?.message ?? err}`);
    }
  }

  if (sol < env.live.minSolReserve) notes.push(`SOL на газ ниже резерва: ${sol.toFixed(4)} < ${env.live.minSolReserve}`);

  const ok = missing.length === 0 && extra.length === 0 && notes.length === 0;
  return { ok, sol, chainPositions, dbOpen: rows.length, missing, extra, notes };
}

/** Состояние боевого контура для интерфейса. */
export function status() {
  let solEstimate = 0;
  try {
    const r = db.prepare(`SELECT onchain_pubkey FROM positions WHERE mode='live' AND status='open' AND onchain_pubkey IS NOT NULL`).all();
    solEstimate = r.length;
  } catch {
    /* таблицы ещё нет */
  }
  const ops = db
    .prepare(
      `SELECT id, position_id, kind, status, position_pubkey, signature, amount_usd, error, created_at
       FROM onchain_ops ORDER BY id DESC LIMIT 15`,
    )
    .all() as any[];

  return {
    mode: env.mode,
    enabled: env.live.enabled,
    dryRun: env.live.dryRun,
    armed: armed(),
    wallet: walletAddress(),
    walletError,
    ...walletInfo(),
    limits: {
      maxPositions: env.live.maxPositions,
      maxPositionUsd: env.live.maxPositionUsd,
      slippagePct: env.live.slippagePct,
      minSolReserve: env.live.minSolReserve,
      priorityFeeMicroLamports: env.live.priorityFeeMicroLamports,
    },
    alertsEnabled: alertsEnabled(),
    rpc: env.rpcUrl.replace(/api-key=[^&]+/, "api-key=***"),
    rpcFallback: env.rpcFallback.replace(/api-key=[^&]+/, "api-key=***"),
    checks: readiness(),
    positionsWithChainAddress: solEstimate,
    ops,
  };
}
