import { journal } from "./journal.js";

/**
 * Алерты в Telegram (и всегда — в журнал).
 *
 * Без этого боевой режим слепой: ошибка транзакции, стоп по просадке или
 * расхождение баланса должны дойти до человека, а не остаться в логе на сервере.
 */
const TOKEN = (process.env.TG_BOT_TOKEN || "").trim();
const CHAT = (process.env.TG_CHAT_ID || "").trim();

const lastSent = new Map<string, number>();
const THROTTLE_MS = 5 * 60_000;

export function alertsEnabled(): boolean {
  return Boolean(TOKEN && CHAT);
}

async function telegram(text: string): Promise<boolean> {
  if (!alertsEnabled()) return false;
  try {
    const res = await fetch(`https://api.telegram.org/bot${TOKEN}/sendMessage`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        chat_id: CHAT,
        text: `🤖 <b>Meteora Terminal</b>\n\n${text}`,
        parse_mode: "HTML",
        disable_web_page_preview: true,
      }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * Обычный алерт: пишется в журнал всегда, в Telegram — не чаще раза в 5 минут
 * на один и тот же ключ (чтобы падающий RPC не залил чат).
 */
export async function alert(text: string, key?: string): Promise<void> {
  journal("WARN", `алерт: ${text}`);
  const k = key ?? text.slice(0, 48);
  const now = Date.now();
  if (now - (lastSent.get(k) ?? 0) < THROTTLE_MS) return;
  lastSent.set(k, now);
  await telegram(text);
}

/** Критический алерт: без троттлинга (остановка торговли, ошибка live-операции). */
export async function alertCritical(text: string): Promise<void> {
  journal("ERROR", `критично: ${text}`);
  await telegram(`🚨 ${text}`);
}
