"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createChart, ColorType, CrosshairMode, LineStyle, type IChartApi, type ISeriesApi } from "lightweight-charts";
import { MoveRight } from "lucide-react";
import { usdCompact } from "@/lib/format";

export type ChartCandle = { t: number; o: number; h: number; l: number; c: number; v: number };
type Profile = { price: number; vol: number }[];
type LiqBin = { price: number; usd: number };
type Zone = { low: number; high: number };

export type ChartLayers = { volume: boolean; liquidity: boolean; zones: boolean };

type Props = {
  candles: ChartCandle[];
  profile: Profile;
  binLiquidity?: LiqBin[];
  zones?: { z1: Zone; z2: Zone } | null;
  entryPrice?: number | null;
  pAvgPrice?: number | null;
  pExitPrice?: number | null;
  layers?: ChartLayers;
  height?: number;
  showVolume?: boolean;
  usdMode?: boolean;
  /** Меняется при смене пула/таймфрейма — только тогда сбрасываем зум. */
  resetKey?: string;
};

function precisionFor(price: number) {
  if (price >= 1000) return { precision: 2, minMove: 0.01 };
  if (price >= 10) return { precision: 3, minMove: 0.001 };
  if (price >= 1) return { precision: 4, minMove: 0.0001 };
  if (price >= 0.01) return { precision: 5, minMove: 0.00001 };
  if (price >= 0.0001) return { precision: 7, minMove: 0.0000001 };
  return { precision: 9, minMove: 0.000000001 };
}

const p90 = (arr: number[]) => {
  if (!arr.length) return 1;
  const s = [...arr].sort((a, b) => a - b);
  return Math.max(1e-9, s[Math.floor(s.length * 0.9)] ?? s[s.length - 1]);
};

export function PriceChart({
  candles,
  profile,
  binLiquidity = [],
  zones,
  entryPrice,
  pAvgPrice,
  pExitPrice,
  layers = { volume: true, liquidity: true, zones: true },
  height = 380,
  showVolume = true,
  usdMode = false,
  resetKey = "",
}: Props) {
  const boxRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const linesRef = useRef<any[]>([]);
  const dataSig = useRef("");
  const needFit = useRef(true);
  const lastRange = useRef<any>(null);

  const [atRightEdge, setAtRightEdge] = useState(true);

  // ── создание графика
  useEffect(() => {
    if (!boxRef.current) return;
    const chart = createChart(boxRef.current, {
      layout: {
        background: { type: ColorType.Solid, color: "transparent" },
        textColor: "#7d7268",
        fontSize: 10,
        fontFamily: "Inter, sans-serif",
      },
      grid: {
        vertLines: { color: "rgba(255,255,255,0.03)" },
        horzLines: { color: "rgba(255,255,255,0.03)" },
      },
      rightPriceScale: {
        borderColor: "rgba(255,255,255,0.05)",
        scaleMargins: { top: 0.12, bottom: showVolume ? 0.2 : 0.08 },
      },
      timeScale: {
        borderColor: "rgba(255,255,255,0.05)",
        timeVisible: true,
        secondsVisible: false,
        rightOffset: 6,
        barSpacing: 6,
        minBarSpacing: 0.6,
        fixLeftEdge: false,
        lockVisibleTimeRangeOnResize: true,
      },
      crosshair: {
        mode: CrosshairMode.Magnet, // как в TradingView: прилипает к свече
        vertLine: { color: "rgba(255,179,71,0.35)", labelBackgroundColor: "#2a1c0e" },
        horzLine: { color: "rgba(255,179,71,0.35)", labelBackgroundColor: "#2a1c0e" },
      },
      // ── навигация 1:1 с TV:
      handleScroll: {
        mouseWheel: false, // колесо не скроллит, а зумит (как в TV)
        pressedMouseMove: true,
        horzTouchDrag: true,
        vertTouchDrag: false,
      },
      handleScale: {
        axisPressedMouseMove: { time: true, price: true },
        mouseWheel: true, // зум колесом вокруг курсора
        pinch: true,
      },
      kineticScroll: { mouse: true, touch: true }, // инерция при перетаскивании
      autoSize: false,
      height,
      width: boxRef.current.clientWidth,
    });
    chartRef.current = chart;

    const series = chart.addCandlestickSeries({
      upColor: "#35e0a1",
      downColor: "#ff5f56",
      borderUpColor: "#35e0a1",
      borderDownColor: "#ff5f56",
      wickUpColor: "rgba(53,224,161,0.7)",
      wickDownColor: "rgba(255,95,86,0.7)",
    });
    seriesRef.current = series;

    if (showVolume) {
      const volSeries = chart.addHistogramSeries({ priceFormat: { type: "volume" }, priceScaleId: "vol" });
      chart.priceScale("vol").applyOptions({ scaleMargins: { top: 0.84, bottom: 0 }, visible: false });
      volSeries.setData(
        candles.map((c) => ({
          time: Math.floor(c.t / 1000) as any,
          value: c.v,
          color: c.c >= c.o ? "rgba(53,224,161,0.18)" : "rgba(255,95,86,0.16)",
        })),
      );
    }

    // индикатор «ушли от правого края»
    const onRange = (range: any) => {
      lastRange.current = range;
      if (range) setAtRightEdge(range.to >= candles.length - 3);
      scheduleDraw();
    };
    chart.timeScale().subscribeVisibleLogicalRangeChange(onRange);

    const onResize = () => {
      if (!boxRef.current) return;
      chart.applyOptions({ width: boxRef.current.clientWidth });
      scheduleDraw();
    };
    window.addEventListener("resize", onResize);
    const ro = new ResizeObserver(onResize);
    if (boxRef.current) ro.observe(boxRef.current);

    // двойной клик — сброс масштаба, как в TV
    const onDblClick = () => chart.timeScale().fitContent();
    boxRef.current.addEventListener("dblclick", onDblClick);

    return () => {
      window.removeEventListener("resize", onResize);
      ro.disconnect();
      boxRef.current?.removeEventListener("dblclick", onDblClick);
      chart.remove();
      chartRef.current = null;
      seriesRef.current = null;
      linesRef.current = [];
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [height, showVolume]);

  // ── данные: обновляем только при реальном изменении (сохраняя зум)
  useEffect(() => {
    const series = seriesRef.current;
    const chart = chartRef.current;
    if (!series || !chart || !candles.length) return;

    const seen = new Set<number>();
    const uniq = candles
      .filter((c) => Number.isFinite(c.t) && Number.isFinite(c.c) && c.c > 0)
      .sort((a, b) => a.t - b.t)
      .filter((c) => {
        const t = Math.floor(c.t / 1000);
        if (seen.has(t)) return false;
        seen.add(t);
        return true;
      });
    if (!uniq.length) return;

    const sig = `${uniq.length}|${uniq[0].t}|${uniq[uniq.length - 1].t}|${uniq[uniq.length - 1].c}`;
    const isNewSeries = dataSig.current === "";
    const prevLen = Number(dataSig.current.split("|")[0] || 0);

    if (dataSig.current !== sig) {
      dataSig.current = sig;
      if (usdMode) {
        series.applyOptions({ priceFormat: { type: "custom", formatter: (p: number) => usdCompact(p), minMove: 1 } });
      } else {
        series.applyOptions({ priceFormat: { type: "price", ...precisionFor(uniq[uniq.length - 1].c) } });
      }
      series.setData(uniq.map((c) => ({ time: Math.floor(c.t / 1000) as any, open: c.o, high: c.h, low: c.l, close: c.c })));
      // подгоняем масштаб, если данных ещё не было или их было слишком мало
      if (isNewSeries || needFit.current || (prevLen < 5 && uniq.length >= 20)) {
        needFit.current = false;
        chart.timeScale().fitContent();
      }
    }
  }, [candles, usdMode]);

  // сброс зума только при смене пула/таймфрейма
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;
    needFit.current = true;
    // если данные уже есть — подгоняем сразу, иначе сделаем это при их появлении
    const t = setTimeout(() => {
      if (dataSig.current) {
        chart.timeScale().fitContent();
        needFit.current = false;
      }
    }, 40);
    return () => clearTimeout(t);
  }, [resetKey]);

  // ── ценовые линии (вход / средняя / стоп / границы сеток)
  useEffect(() => {
    const series = seriesRef.current;
    if (!series) return;
    for (const line of linesRef.current) {
      try {
        series.removePriceLine(line);
      } catch {
        /* ignore */
      }
    }
    linesRef.current = [];
    const add = (price?: number | null, color = "#ffb347", title = "", style = LineStyle.Dashed) => {
      if (!price || !Number.isFinite(price)) return;
      linesRef.current.push(
        series.createPriceLine({ price, color, lineWidth: 1, lineStyle: style, axisLabelVisible: true, title }),
      );
    };
    if (layers.zones && zones) {
      add(zones.z1.high, "rgba(255,179,71,0.75)", "граница сетки", LineStyle.Dotted);
      add(zones.z1.low, "rgba(255,179,71,0.55)", "", LineStyle.Dotted);
      add(zones.z2.low, "rgba(255,122,24,0.55)", "", LineStyle.Dotted);
    }
    add(entryPrice, "#9b9187", "вход");
    add(pAvgPrice, "#ffb347", "средняя");
    add(pExitPrice, "#ff5f56", "стоп", LineStyle.Solid);
    scheduleDraw();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entryPrice, pAvgPrice, pExitPrice, zones, layers.zones]);

  // ── canvas-оверлей: объём, ликвидность пула, зоны (быстро и без лагов)
  const drawRef = useRef<() => void>(() => {});
  drawRef.current = () => {
    const canvas = canvasRef.current;
    const series = seriesRef.current;
    const chart = chartRef.current;
    if (!canvas || !series || !chart) return;

    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    if (!w || !h) return;
    if (canvas.width !== Math.floor(w * dpr) || canvas.height !== Math.floor(h * dpr)) {
      canvas.width = Math.floor(w * dpr);
      canvas.height = Math.floor(h * dpr);
    }
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    const priceToY = (p: number) => series.priceToCoordinate(p) as number | null;
    const barsRight = 4;
    const colW = 46;

    // зоны
    if (layers.zones && zones) {
      const zonesToDraw: [Zone, string, string][] = [
        [zones.z2, "rgba(255,122,24,0.10)", "rgba(255,122,24,0.40)"],
        [zones.z1, "rgba(255,179,71,0.14)", "rgba(255,179,71,0.50)"],
      ];
      for (const [z, fill, stroke] of zonesToDraw) {
        const yTop = priceToY(z.high);
        const yBot = priceToY(z.low);
        if (yTop == null || yBot == null) continue;
        const top = Math.min(yTop, yBot);
        const hgt = Math.max(1, Math.abs(yBot - yTop));
        ctx.fillStyle = fill;
        ctx.fillRect(0, top, w - 74, hgt);
        ctx.strokeStyle = stroke;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(0, top + 0.5);
        ctx.lineTo(w - 74, top + 0.5);
        ctx.moveTo(0, top + hgt - 0.5);
        ctx.lineTo(w - 74, top + hgt - 0.5);
        ctx.stroke();
      }
    }

    const drawBars = (
      items: { price: number; value: number }[],
      max: number,
      right: number,
      grad: [string, string],
    ) => {
      const gradObj = ctx.createLinearGradient(w - right - colW, 0, w - right, 0);
      gradObj.addColorStop(0, grad[0]);
      gradObj.addColorStop(1, grad[1]);
      ctx.fillStyle = gradObj;
      for (const it of items) {
        const y = priceToY(it.price);
        if (y == null || y < -2 || y > h + 2) continue;
        const bw = Math.min(colW, (it.value / max) * colW);
        ctx.fillRect(w - right - bw, y - 1, bw, 2);
      }
    };

    if (layers.liquidity && binLiquidity.length) {
      drawBars(
        binLiquidity.map((b) => ({ price: b.price, value: b.usd })),
        p90(binLiquidity.map((b) => b.usd)),
        barsRight + 62,
        ["rgba(53,224,161,0.04)", "rgba(53,224,161,0.85)"],
      );
    }
    if (layers.volume && profile.length) {
      drawBars(
        profile.map((p) => ({ price: p.price, value: p.vol })),
        p90(profile.map((p) => p.vol)),
        barsRight,
        ["rgba(255,122,24,0.04)", "rgba(255,179,71,0.95)"],
      );
    }
  };

  const rafRef = useRef(0);
  const scheduleDraw = () => {
    cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(() => drawRef.current());
  };

  useEffect(() => {
    scheduleDraw();
  }, [candles, profile, binLiquidity, zones, layers, usdMode]);

  useEffect(() => {
    const ro = new ResizeObserver(scheduleDraw);
    if (canvasRef.current) ro.observe(canvasRef.current);
    return () => ro.disconnect();
  }, []);

  return (
    <div className="relative w-full" style={{ height }}>
      <div ref={boxRef} className="absolute inset-0" />
      <canvas
        ref={canvasRef}
        className="pointer-events-none absolute inset-0"
        style={{ top: 0, right: 0, bottom: 24, width: "100%" }}
      />
      {!atRightEdge && (
        <button
          onClick={() => chartRef.current?.timeScale().scrollToRealTime()}
          className="absolute bottom-9 right-[76px] z-10 grid h-8 w-8 place-items-center rounded-full border border-white/[0.12] bg-[#1a130b]/90 text-accent2 shadow-lg backdrop-blur transition hover:bg-[#241a12]"
          title="Вернуться к текущей цене"
        >
          <MoveRight className="h-4 w-4" />
        </button>
      )}
    </div>
  );
}
