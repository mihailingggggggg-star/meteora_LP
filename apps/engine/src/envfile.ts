import fs from "node:fs";
import path from "node:path";
import { env } from "./env.js";

/**
 * Точечное обновление .env из интерфейса (переключение режима, ключи).
 * Пишем атомарно, с правами 600: файл принадлежит пользователю сервиса,
 * поэтому движок может менять его сам, без прав root.
 */
export function updateEnvFile(patch: Record<string, string>): { file: string; changed: string[] } {
  const file = path.join(env.root, ".env");
  let text = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";
  const changed: string[] = [];

  for (const [key, value] of Object.entries(patch)) {
    const re = new RegExp(`^${key}=.*$`, "m");
    if (re.test(text)) {
      const next = text.replace(re, `${key}=${value}`);
      if (next !== text) changed.push(key);
      text = next;
    } else {
      text = `${text.replace(/\n*$/, "\n")}${key}=${value}\n`;
      changed.push(key);
    }
  }

  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, text, { mode: 0o600 });
  fs.renameSync(tmp, file);
  try {
    fs.chmodSync(file, 0o600);
  } catch {
    /* не критично */
  }
  return { file, changed };
}
