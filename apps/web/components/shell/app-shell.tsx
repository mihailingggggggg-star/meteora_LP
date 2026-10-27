"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  LayoutDashboard,
  Layers,
  Radar,
  ArrowLeftRight,
  PieChart,
  NotebookText,
  Settings,
  LogOut,
  Bell,
  Moon,
  Search,
  RefreshCw,
  Activity,
  MoreHorizontal,
} from "lucide-react";
import { motion } from "framer-motion";
import { cn } from "@/lib/format";
import { ConnectWallet } from "@/components/wallet/connect-wallet";
import { useEngineState } from "@/lib/api";
import { toast } from "sonner";

/** Мобильное меню: только 4 главных раздела. Остальное — в «Ещё» шапки. */
const MOBILE_NAV = [
  { href: "/", icon: LayoutDashboard, label: "Главная" },
  { href: "/positions", icon: Layers, label: "Позиции" },
  { href: "/analytics", icon: PieChart, label: "Аналитика" },
  { href: "/settings", icon: Settings, label: "Кабинет" },
];

const MORE_NAV = [
  { href: "/screener", icon: Radar, label: "Скринер" },
  { href: "/swaps", icon: ArrowLeftRight, label: "Свапы" },
  { href: "/journal", icon: NotebookText, label: "Журнал" },
];

const NAV = [
  { href: "/", icon: LayoutDashboard, label: "Обзор" },
  { href: "/positions", icon: Layers, label: "Позиции" },
  { href: "/screener", icon: Radar, label: "Скринер" },
  { href: "/swaps", icon: ArrowLeftRight, label: "Свапы" },
  { href: "/analytics", icon: PieChart, label: "Аналитика" },
  { href: "/journal", icon: NotebookText, label: "Журнал" },
];

function Logo({ size = 40 }: { size?: number }) {
  return (
    <div className="relative grid place-items-center" style={{ width: size, height: size }}>
      <svg viewBox="0 0 48 48" style={{ width: size, height: size }}>
        <defs>
          <linearGradient id="lg" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#ffb347" />
            <stop offset="55%" stopColor="#ff7a18" />
            <stop offset="100%" stopColor="#d1450a" />
          </linearGradient>
        </defs>
        <rect x="1" y="1" width="46" height="46" rx="15" fill="url(#lg)" />
        <path
          d="M13 33V15l11 9 11-9v18"
          fill="none"
          stroke="#1a0c02"
          strokeWidth="3.4"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </div>
  );
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { state, connected } = useEngineState();

  const mode = state?.mode ?? "demo";
  const running = state?.running !== false;
  const halted = !!state?.halted;

  const logout = async () => {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
  };

  const rescan = async () => {
    try {
      await fetch("/api/engine/bot/scan", { method: "POST" });
      toast.success("Запущен скан пулов");
    } catch {
      toast.error("Не удалось запустить скан");
    }
  };

  return (
    <div className="min-h-screen">
      {/* ── Sidebar (desktop) */}
      <aside className="fixed left-0 top-0 z-40 hidden h-screen w-[92px] flex-col p-3 lg:flex">
        <div className="surface flex h-full flex-col items-center gap-1 py-4">
          <Link href="/" className="mb-3">
            <Logo />
          </Link>
          {NAV.map((item) => {
            const active = pathname === item.href || (item.href !== "/" && pathname.startsWith(item.href));
            return (
              <Link
                key={item.href}
                href={item.href}
                title={item.label}
                className={cn(
                  "relative grid h-11 w-11 place-items-center rounded-[14px] transition-all duration-200",
                  active ? "text-[#1d0f03]" : "text-muted hover:bg-white/[0.05] hover:text-ink",
                )}
              >
                {active && (
                  <motion.span
                    layoutId="nav-active"
                    className="absolute inset-0 rounded-[14px] bg-gradient-to-b from-[#ff9a3d] to-[#f2670a] shadow-[0_10px_22px_-10px_rgba(255,122,24,0.9)]"
                    transition={{ type: "spring", stiffness: 400, damping: 34 }}
                  />
                )}
                <item.icon className="relative z-10 h-[19px] w-[19px]" strokeWidth={1.9} />
              </Link>
            );
          })}
          <div className="mt-auto flex flex-col items-center gap-1">
            <Link
              href="/settings"
              className={cn(
                "grid h-11 w-11 place-items-center rounded-[14px] transition-colors",
                pathname.startsWith("/settings") ? "bg-white/[0.06] text-ink" : "text-muted hover:text-ink",
              )}
            >
              <Settings className="h-[19px] w-[19px]" strokeWidth={1.9} />
            </Link>
            <button
              onClick={logout}
              className="grid h-11 w-11 place-items-center rounded-[14px] text-muted transition-colors hover:text-danger"
              title="Выйти"
            >
              <LogOut className="h-[19px] w-[19px]" strokeWidth={1.9} />
            </button>
          </div>
        </div>
      </aside>

      <div className="lg:pl-[92px]">
        {/* ── Topbar */}
        <header className="sticky top-0 z-30 px-3 pt-3 lg:px-5 lg:pt-5">
          <div className="surface flex min-w-0 items-center gap-2 overflow-hidden px-2.5 py-2 lg:gap-3 lg:px-4 lg:py-2.5">
            <div className="lg:hidden">
              <Logo size={32} />
            </div>
            <div className="hidden items-center gap-2 rounded-full border border-white/[0.06] bg-white/[0.03] px-3 py-2 md:flex">
              <Search className="h-3.5 w-3.5 text-dim" />
              <input
                placeholder="Поиск пула, токена, позиции"
                className="w-[190px] bg-transparent text-[12px] text-ink placeholder:text-dim focus:outline-none"
              />
              <kbd className="rounded-md border border-white/[0.08] px-1.5 py-0.5 text-[10px] text-dim">⌘K</kbd>
            </div>

            <div className="ml-auto flex items-center gap-2">
              <div
                className={cn(
                  "hidden items-center gap-1.5 rounded-full border px-2.5 py-1.5 text-[10.5px] font-semibold uppercase tracking-wider sm:flex",
                  halted
                    ? "border-danger/30 bg-danger/10 text-danger"
                    : mode === "live"
                      ? "border-mint/30 bg-mint/10 text-mint"
                      : "border-accent/30 bg-accent/10 text-accent2",
                )}
              >
                <span
                  className={cn(
                    "h-1.5 w-1.5 rounded-full pulse-dot",
                    halted ? "bg-danger" : mode === "live" ? "bg-mint" : "bg-accent",
                  )}
                />
                {halted ? "halted" : mode === "live" ? "live" : "demo"}
              </div>
              <span
                className={cn(
                  "hidden items-center gap-1 text-[10.5px] sm:flex",
                  connected ? "text-mint" : "text-dim",
                )}
                title={connected ? "Поток данных активен" : "Ожидание движка"}
              >
                <Activity className="h-3 w-3" />
                {running ? "бот работает" : "пауза"}
              </span>
              <button
                onClick={rescan}
                className="hidden h-9 w-9 place-items-center rounded-full border border-white/[0.06] bg-white/[0.03] text-muted transition hover:text-ink sm:grid"
                title="Сканировать пулы"
              >
                <RefreshCw className={cn("h-4 w-4", state?.scanning && "animate-spin")} />
              </button>
              <button className="hidden h-9 w-9 place-items-center rounded-full border border-white/[0.06] bg-white/[0.03] text-muted transition hover:text-ink sm:grid">
                <Bell className="h-4 w-4" />
              </button>
              <button className="hidden h-9 w-9 place-items-center rounded-full border border-white/[0.06] bg-white/[0.03] text-muted transition hover:text-ink sm:grid">
                <Moon className="h-4 w-4" />
              </button>
              <details className="relative lg:hidden">
                <summary className="grid h-9 w-9 cursor-pointer list-none place-items-center rounded-full border border-white/[0.06] bg-white/[0.03] text-muted transition hover:text-ink [&::-webkit-details-marker]:hidden">
                  <MoreHorizontal className="h-4 w-4" />
                </summary>
                <div className="absolute right-0 top-11 z-50 w-44 overflow-hidden rounded-2xl border border-white/[0.08] bg-[#171310] p-1 shadow-2xl">
                  {MORE_NAV.map((item) => (
                    <Link
                      key={item.href}
                      href={item.href}
                      className="flex items-center gap-2.5 rounded-xl px-3 py-2 text-[12.5px] text-muted transition hover:bg-white/[0.05] hover:text-ink"
                    >
                      <item.icon className="h-4 w-4" strokeWidth={1.9} />
                      {item.label}
                    </Link>
                  ))}
                </div>
              </details>
              <ConnectWallet compact />
              <div className="flex shrink-0 items-center gap-2 rounded-full border border-white/[0.06] bg-white/[0.03] py-1 pl-1 pr-2">
                <div className="grid h-7 w-7 place-items-center rounded-full bg-gradient-to-br from-[#f7c58a] to-[#8a4a1a] text-[11px] font-bold text-[#2a1505]">
                  M
                </div>
                <div className="hidden leading-tight sm:block">
                  <div className="text-[11.5px] font-medium text-ink">Mihail</div>
                  <div className="text-[10px] text-dim">@owner</div>
                </div>
              </div>
            </div>
          </div>
        </header>

        <main className="min-w-0 overflow-x-hidden px-3 pb-32 pt-3 lg:px-5 lg:pb-8 lg:pt-4">{children}</main>
      </div>

      {/* затемнение под нижним меню: контент не «просвечивает» сквозь панель */}
      <div className="pointer-events-none fixed inset-x-0 bottom-0 z-30 h-32 bg-gradient-to-t from-black via-black/80 to-transparent lg:hidden" />

      {/* ── Mobile bottom nav: 4 раздела, прижато к краю */}
      <nav
        className="fixed inset-x-0 bottom-0 z-40 px-2 lg:hidden"
        style={{ paddingBottom: "max(4px, env(safe-area-inset-bottom))" }}
      >
        <div className="flex items-center justify-between rounded-t-[20px] border border-b-0 border-white/[0.07] bg-[#141110]/95 px-1.5 pb-1 pt-1.5 backdrop-blur-xl">
          {MOBILE_NAV.map((item) => {
            const active = pathname === item.href || (item.href !== "/" && pathname.startsWith(item.href));
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "flex flex-1 flex-col items-center gap-1 rounded-[14px] py-1.5 transition-colors",
                  active ? "text-accent2" : "text-dim",
                )}
              >
                <item.icon className="h-[19px] w-[19px]" strokeWidth={active ? 2.2 : 1.8} />
                <span className="text-[9.5px] font-medium">{item.label}</span>
              </Link>
            );
          })}
        </div>
      </nav>
    </div>
  );
}
