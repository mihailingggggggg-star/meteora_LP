"use client";

import { Area, AreaChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { usd } from "@/lib/format";

type Point = { ts: number; equity: number };

export function EquityChart({
  data,
  height = 240,
  baseline,
}: {
  data: Point[];
  height?: number;
  /** уровень депозита: видно, выше или ниже него капитал */
  baseline?: number;
}) {
  const series =
    data.length > 2
      ? data
      : (() => {
          const target = data[data.length - 1]?.equity ?? 500;
          const start = target * 0.995;
          const n = 24;
          return Array.from({ length: n }, (_, i) => ({
            ts: Date.now() - (n - i) * 3600_000,
            equity:
              start +
              ((target - start) * i) / (n - 1) +
              Math.sin(i * 0.7) * target * 0.0012 * (1 - i / n),
          }));
        })();

  return (
    <div style={{ height }} className="w-full">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={series} margin={{ top: 12, right: 8, left: 0, bottom: 0 }}>
          <defs>
            <linearGradient id="eqFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#ff7a18" stopOpacity={0.55} />
              <stop offset="55%" stopColor="#ff7a18" stopOpacity={0.18} />
              <stop offset="100%" stopColor="#ff7a18" stopOpacity={0} />
            </linearGradient>
          </defs>
          {baseline && baseline > 0 ? (
            <ReferenceLine
              y={baseline}
              stroke="rgba(255,255,255,0.35)"
              strokeDasharray="4 4"
              label={{ value: "депозит", position: "insideBottomLeft", fill: "rgba(255,255,255,0.45)", fontSize: 9 }}
            />
          ) : null}
          <XAxis
            dataKey="ts"
            tickFormatter={(v) =>
              new Date(v).toLocaleDateString("ru-RU", { day: "2-digit", month: "short" })
            }
            tick={{ fill: "#6a6058", fontSize: 10 }}
            axisLine={false}
            tickLine={false}
            minTickGap={40}
          />
          <YAxis
            domain={["dataMin - 2", "dataMax + 2"]}
            tick={{ fill: "#6a6058", fontSize: 10 }}
            axisLine={false}
            tickLine={false}
            width={46}
            tickFormatter={(v) => usd(v, 0)}
          />
          <Tooltip
            content={({ active, payload }) => {
              if (!active || !payload?.length) return null;
              const p = payload[0].payload as Point;
              return (
                <div className="rounded-2xl border border-white/[0.08] bg-[#1a130b] px-3 py-2 shadow-xl">
                  <div className="text-[10px] text-dim">
                    {new Date(p.ts).toLocaleString("ru-RU", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}
                  </div>
                  <div className="num text-[13px] font-semibold text-ink">{usd(p.equity)}</div>
                </div>
              );
            }}
          />
          <Area
            type="monotone"
            dataKey="equity"
            stroke="#ff9a3d"
            strokeWidth={2}
            fill="url(#eqFill)"
            dot={false}
            activeDot={{ r: 4, fill: "#ffb347", stroke: "#241000", strokeWidth: 2 }}
            isAnimationActive={false}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
