#!/usr/bin/env node
/**
 * Шифрование ключа торгового кошелька для .env (AES-256-GCM).
 *
 *   export WALLET_ENCRYPTION_KEY="$(openssl rand -base64 32)"
 *   npx tsx scripts/encrypt-wallet.ts '<base58 | JSON-массив>'
 *
 * На выходе — готовые строки для .env. Сам ключ никуда не пишется.
 * Расшифровка происходит в apps/engine/src/executor.ts при старте движка.
 */
import crypto from "node:crypto";
import { Keypair } from "@solana/web3.js";
import bs58 from "bs58";

function fail(msg: string): never {
  console.error(`✗ ${msg}`);
  process.exit(1);
}

const raw = (process.argv[2] || "").trim();
if (!raw) {
  fail("укажите ключ: npx tsx scripts/encrypt-wallet.ts '<base58 | [12,34,…]>'");
}

const encKey = (process.env.WALLET_ENCRYPTION_KEY || "").trim();
if (encKey.length < 16) {
  fail("WALLET_ENCRYPTION_KEY не задан (нужно ≥16 символов): export WALLET_ENCRYPTION_KEY=\"$(openssl rand -base64 32)\"");
}

let secret: Uint8Array;
try {
  if (raw.startsWith("[")) {
    secret = Uint8Array.from(JSON.parse(raw) as number[]);
  } else if (raw.startsWith("enc:")) {
    fail("ключ уже зашифрован (enc:…) — повторное шифрование не требуется");
  } else {
    secret = bs58.decode(raw);
  }
} catch {
  fail("не удалось разобрать ключ: ожидается base58-строка или JSON-массив");
}

let kp: Keypair;
try {
  kp = Keypair.fromSecretKey(secret);
} catch {
  fail("ключ не является валидным ed25519-секретом");
}

const key = crypto.createHash("sha256").update(encKey).digest();
const iv = crypto.randomBytes(12);
const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
const data = Buffer.concat([cipher.update(raw, "utf8"), cipher.final()]);
const encrypted = `enc:${iv.toString("base64")}:${cipher.getAuthTag().toString("base64")}:${data.toString("base64")}`;

console.log("");
console.log("# ── вставьте в .env (и не коммитьте его)");
console.log(`TRADING_WALLET_PUBKEY=${kp.publicKey.toBase58()}`);
console.log(`TRADING_WALLET_SECRET_BASE58=${encrypted}`);
console.log("");
console.log(`кошелёк: ${kp.publicKey.toBase58()}`);
console.log("проверка: curl -s localhost:8787/api/live/status | jq '.wallet, .walletError'");
