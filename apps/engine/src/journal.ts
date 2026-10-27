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

export function dayKey(d = new Date()) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
const clock = (d = new Date()) => `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;

export type JournalType =
  | "BOOT"
  | "CONFIG"
  | "SETTINGS"
  | "SNAP"
  | "SCAN"
  | "SCORE"
  | "REJECT"
  | "ENTER"
  | "FILL"
  | "ROTATE_WAIT"
  | "RANGE_OUT"
  | "RANGE_BACK"
  | "CLAIM"
  | "MOVE"
  | "STOP"
  | "EXIT_UP"
  | "EXIT_TIME"
  | "EXIT_ROTATE"
  | "EXIT_RANGE_DOWN"
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
  | "DUPLICATE"
  | "MANUAL"
  | "LIVE"
  | "HEALTH"
  | "EXIT_FILTERS"
  | "RANGE_ADJUST";

/** Компактный контекст: убираем пустые поля и округляем числа — журнал не должен пухнуть. */
function compactCtx(value: unknown, depth = 0): unknown {
  if (value == null) return undefined;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return undefined;
    if (Number.isInteger(value)) return value;
    const abs = Math.abs(value);
    const digits = abs >= 1000 ? 0 : abs >= 1 ? 2 : 6;
    return Number(value.toFixed(digits));
  }
  if (typeof value === "string") return value.length > 120 ? `${value.slice(0, 117)}…` : value;
  if (typeof value === "boolean") return value;
  if (Array.isArray(value)) {
    if (depth > 2) return undefined;
    return value.slice(0, 8).map((v) => compactCtx(v, depth + 1)).filter((v) => v !== undefined);
  }
  if (typeof value === "object") {
    if (depth > 2) return undefined;
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      const c = compactCtx(v, depth + 1);
      if (c !== undefined) out[k] = c;
    }
    return Object.keys(out).length ? out : undefined;
  }
  return undefined;
}

/** Только YYYY-MM-DD: дата приходит из query-параметра, обход каталога недопустим. */
function fileFor(day = dayKey()) {
  const safe = /^\d{4}-\d{2}-\d{2}$/.test(day) ? day : dayKey();
  return path.join(dir, `${safe}.md`);
}

/** Шапка дня: один раз, с полной конфигурацией — по ней ИИ поймёт, в каких условиях шла торговля. */
export function journalConfig(payload: Record<string, unknown>) {
  const file = fileFor();
  try {
    if (fs.existsSync(file) && fs.statSync(file).size > 200) return;
    const body = [
      `# Журнал ${dayKey()} · ESMAR bot`,
      "",
      "> Формат строки: `[время] ТИП сообщение `{\"ctx\":…}`` — время локальное, контекст в JSON.",
      "> Типы: ENTER/EXIT_* — сделки · RANGE_OUT/BACK — выход из сетки · REBALANCE — перестройка сетки ·",
      "> ROTATE_WAIT — позиция ждёт ротации · CLAIM — сбор комиссий · SNAP — срез состояния раз в 5 мин ·",
      "> SETTINGS — изменение параметров (было → стало) · HALT/STOP — риск-стопы · REJECT/SKIP — отказы.",
      "",
      "## Конфигурация",
      "```json",
      JSON.stringify(compactCtx(payload) ?? {}, null, 1),
      "```",
      "",
      "## События",
      "",
    ].join("\n");
    fs.writeFileSync(file, body);
  } catch {
    /* журнал не должен ронять движок */
  }
}

/** Технический шум: пишем только в events.jsonl, чтобы md-журнал оставался лёгким. */
const MD_SKIP = new Set<JournalType>(["WS", "FILL", "SKIP", "SCORE"]);

export function journal(type: JournalType, message: string, extra?: Record<string, unknown>) {
  const ctx = extra ? compactCtx(extra) : undefined;
  const suffix = ctx ? ` \`${JSON.stringify(ctx)}\`` : "";
  const line = `[${clock()}] ${type.padEnd(10)} ${message}${suffix}`;
  try {
    if (!MD_SKIP.has(type)) fs.appendFileSync(fileFor(), line + "\n");
    fs.appendFileSync(
      path.join(dir, "events.jsonl"),
      JSON.stringify({ ts: Date.now(), mode: env.mode, type, message, ...(extra ?? {}) }) + "\n",
    );
  } catch {
    /* журнал не должен ронять движок */
  }
  return line;
}

/** Изменения настроек: пишем только реально изменившиеся поля (было → стало). */
export function journalSettings(prev: Record<string, unknown>, next: Record<string, unknown>) {
  const changes = Object.keys(next)
    .filter((k) => JSON.stringify(prev[k]) !== JSON.stringify(next[k]))
    .map((k) => ({ key: k, from: prev[k], to: next[k] }));
  if (!changes.length) return;
  journal("SETTINGS", `параметры: ${changes.map((c) => `${c.key} ${String(c.from)}→${String(c.to)}`).join(", ")}`, {
    changes,
    settings: next,
  });
}

export function readJournal(day: string, limit = 400): string[] {
  const file = fileFor(day);
  if (!fs.existsSync(file)) return [];
  return fs.readFileSync(file, "utf8").trim().split("\n").slice(-limit);
}

/** Полный текст файла — для скачивания. */
export function readJournalFull(day: string): string {
  const file = fileFor(day);
  if (!fs.existsSync(file)) return "";
  return fs.readFileSync(file, "utf8");
}

export function journalDays(limit = 30): string[] {
  try {
    return fs
      .readdirSync(dir)
      .filter((f) => /^\d{4}-\d{2}-\d{2}\.md$/.test(f))
      .map((f) => f.replace(".md", ""))
      .sort()
      .reverse()
      .slice(0, limit);
  } catch {
    return [];
  }
}
