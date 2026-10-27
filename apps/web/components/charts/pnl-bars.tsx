"use client";

import { Bar, BarChart, Cell, ResponsiveContainer, Tooltip, XAxis } from "recharts";
import { usd } from "@/lib/format";

type Day = { day: string; pnl: number; fees: number; trades: number };

export function PnlBars({ data, height = 170 }: { data: Day[]; height?: number }) {
  const series = data.length
    ? data
    : [{ day: "—", pnl: 0, fees: 0, trades: 0 }];
  const todayKey = new Date().toISOString().slice(0, 10);

  return (
    <div style={{ height }} className="w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={series} margin={{ top: 16, right: 4, left: 4, bottom: 0 }} barCategoryGap="26%">
          <defs>
            <linearGradient id="barMuted" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#5a4a3a" stopOpacity={0.75} />
              <stop offset="100%" stopColor="#2a2018" stopOpacity={0.9} />
            </linearGradient>
            <linearGradient id="barMint" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#4bf0b5" />
              <stop offset="100%" stopColor="#12a877" />
            </linearGradient>
            <linearGradient id="barDanger" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#ff7a72" />
              <stop offset="100%" stopColor="#b8322a" />
            </linearGradient>
          </defs>
          <XAxis
            dataKey="day"
            tickFormatter={(v: string) => (v === "—" ? v : v.slice(5))}
            tick={{ fill: "#6a6058", fontSize: 9.5 }}
            axisLine={false}
            tickLine={false}
          />
          <Tooltip
            cursor={{ fill: "rgba(255,255,255,0.03)" }}
            content={({ active, payload }) => {
              if (!active || !payload?.length) return null;
              const d = payload[0].payload as Day;
              return (
                <div className="rounded-xl border border-white/[0.08] bg-[#1a130b] px-3 py-2 text-[11px] shadow-xl">
                  <div className="text-dim">{d.day}</div>
                  <div className="num font-semibold text-ink">{usd(d.pnl)}</div>
                  <div className="text-dim">комиссии {usd(d.fees)}</div>
                </div>
              );
            }}
          />
          <Bar dataKey="pnl" radius={[7, 7, 7, 7]} maxBarSize={40} isAnimationActive={false}>
            {series.map((d, i) => {
              const isToday = d.day === todayKey;
              const color = isToday ? "url(#barMint)" : d.pnl < 0 ? "url(#barDanger)" : "url(#barMuted)";
              return <Cell key={i} fill={color} />;
            })}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
