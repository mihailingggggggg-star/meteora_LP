"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { Loader2, ArrowRight, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/kit";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Ошибка входа");
      router.push("/");
      router.refresh();
    } catch (err: any) {
      setError(err?.message ?? "Ошибка входа");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden px-4">
      <div className="pointer-events-none absolute -left-40 -top-40 h-[520px] w-[520px] rounded-full bg-[#ff7a18]/12 blur-[140px]" />
      <div className="pointer-events-none absolute -bottom-40 -right-32 h-[460px] w-[460px] rounded-full bg-[#ffb347]/10 blur-[150px]" />

      <motion.div
        initial={{ opacity: 0, y: 18 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
        className="w-full max-w-[420px]"
      >
        <div className="mb-7 flex items-center gap-3">
          <svg viewBox="0 0 48 48" className="h-11 w-11">
            <defs>
              <linearGradient id="lg2" x1="0" y1="0" x2="1" y2="1">
                <stop offset="0%" stopColor="#ffb347" />
                <stop offset="55%" stopColor="#ff7a18" />
                <stop offset="100%" stopColor="#d1450a" />
              </linearGradient>
            </defs>
            <rect x="1" y="1" width="46" height="46" rx="15" fill="url(#lg2)" />
            <path d="M13 33V15l11 9 11-9v18" fill="none" stroke="#1a0c02" strokeWidth="3.4" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <div>
            <div className="text-[17px] font-semibold tracking-tight">Meteora Terminal</div>
            <div className="text-[11.5px] text-muted">Управление ликвидностью DLMM</div>
          </div>
        </div>

        <div className="surface p-6">
          <h1 className="text-[20px] font-semibold tracking-tight">Вход в терминал</h1>
          <p className="mt-1 text-[12.5px] text-muted">
            Пароль защищает интерфейс. Кошелёк Phantom привязывается отдельно, по подписи.
          </p>

          <form onSubmit={submit} className="mt-5 space-y-3">
            <label className="block">
              <span className="text-[11px] uppercase tracking-[0.12em] text-dim">Email</span>
              <input
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                type="email"
                autoComplete="username"
                placeholder="admin@meteora.local"
                className="mt-1.5 h-11 w-full rounded-[13px] border border-white/[0.08] bg-white/[0.03] px-3.5 text-[13px] text-ink placeholder:text-dim focus:border-accent/50 focus:outline-none"
              />
            </label>
            <label className="block">
              <span className="text-[11px] uppercase tracking-[0.12em] text-dim">Пароль</span>
              <input
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                type="password"
                autoComplete="current-password"
                placeholder="••••••••"
                className="mt-1.5 h-11 w-full rounded-[13px] border border-white/[0.08] bg-white/[0.03] px-3.5 text-[13px] text-ink placeholder:text-dim focus:border-accent/50 focus:outline-none"
              />
            </label>

            {error ? (
              <div className="rounded-xl border border-danger/25 bg-danger/10 px-3 py-2 text-[12px] text-danger">{error}</div>
            ) : null}

            <Button type="submit" size="lg" className="w-full" disabled={busy}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              {busy ? "Проверяем…" : "Войти"}
              {!busy && <ArrowRight className="h-4 w-4" />}
            </Button>
          </form>

          <div className="mt-5 flex items-start gap-2 rounded-xl border border-white/[0.06] bg-white/[0.02] px-3 py-2.5">
            <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-mint" />
            <div className="text-[11px] leading-relaxed text-muted">
              Откройте ссылку на телефоне и добавьте терминал на рабочий стол — интерфейс работает как
              приложение (PWA).
            </div>
          </div>
        </div>

        <div className="mt-4 text-center text-[11px] text-dim">
          Локальная демо-учётка: <span className="text-muted">admin@meteora.local</span> /{" "}
        </div>
      </motion.div>
    </div>
  );
}
