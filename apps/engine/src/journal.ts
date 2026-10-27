import fs from "node:fs";
import path from "node:path";
import { env } from "./env.js";

const dir = path.join(env.root, "journal");
fs.mkdirSync(dir, { recursive: true });

const pad = (n: number) => String(n).padStart(2, "0");

/** Ротация: прошлые дни сжимаем в .gz, архивы старше 30 дней удаляем. */
export function rotateJournals() {
  try {
    const today = `${new Date().getFullYear()}-${pad(new Date().getMonth() + 1)}-${pad(new Date().getDate())}`;
    const zlib = require("node:zlib");
    for (const file of fs.readdirSync(dir)) {
      if (!file.endsWith(".md") || file.includes("-summary")) continue;
      if (file === `${today}.md` || file === "README.md") continue;
      const full = path.join(dir, file);
      const gz = `${full}.gz`;
      try {
        fs.writeFileSync(gz, zlib.gzipSync(fs.readFileSync(full)));
        fs.unlinkSync(full);
      } catch {
        /* пропускаем */
      }
    }
    const cutoff = Date.now() - 30 * 86_400_000;
    for (const file of fs.readdirSync(dir)) {
      if (!file.endsWith(".gz")) continue;
      const full = path.join(dir, file);
      try {
        if (fs.statSync(full).mtimeMs < cutoff) fs.unlinkSync(full);
      } catch {
        /* пропускаем */
      }
    }
  } catch {
    /* журнал не должен ронять движок */
  }
}
function dayKey(d = new Date()) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
function clock(d = new Date()) {
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

export type JournalType =
  | "BOOT"
  | "SCAN"
  | "SCORE"
  | "REJECT"
  | "ENTER"
  | "FILL"
  | "CLAIM"
  | "MOVE"
  | "STOP"
  | "EXIT_UP"
  | "EXIT_TIME"
  | "ERROR"
  | "WARN"
  | "HALT"
  | "SUMMARY"
  | "WS"
  | "SKIP"
  | "REBALANCE"
  | "CONSECUTIVE_LOSS"
  | "MAX_REBALANCES"
  | "EXIT_VOLATILITY"
  | "EXIT_FLOW"
  | "EXIT_ROTATE"
  | "DUPLICATE"
  | "MANUAL";

export function journal(type: JournalType, message: string, extra?: Record<string, unknown>) {
  const line = `[${clock()}] ${type.padEnd(6)} ${message}`;
  try {
    fs.appendFileSync(path.join(dir, `${dayKey()}.md`), line + "\n");
    fs.appendFileSync(
      path.join(dir, "events.jsonl"),
      JSON.stringify({ ts: Date.now(), mode: env.mode, type, message, ...(extra ?? {}) }) + "\n",
    );
  } catch {
    /* журнал не должен ронять движок */
  }
  return line;
}

export function readJournal(day: string, limit = 400): string[] {
  const file = path.join(dir, `${day}.md`);
  if (!fs.existsSync(file)) return [];
  return fs.readFileSync(file, "utf8").trim().split("\n").slice(-limit);
}
