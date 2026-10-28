"use client";

import { useEffect, useRef, useState } from "react";

const ENGINE = "/api/engine";

export async function engineGet<T>(path: string): Promise<T> {
  const res = await fetch(`${ENGINE}${path}`, { cache: "no-store" });
  if (!res.ok) throw new Error(`${res.status} ${path}`);
  return res.json();
}

export async function enginePost<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${ENGINE}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`${res.status} ${path}`);
  return res.json();
}

export async function engineDelete<T>(path: string): Promise<T> {
  const res = await fetch(`${ENGINE}${path}`, { method: "DELETE", cache: "no-store" });
  if (!res.ok) throw new Error(`${res.status} ${path}`);
  return res.json();
}

/** Живое состояние движка: опрос каждые 3 секунды (надёжно за прокси). */
export function useEngineState() {
  const [state, setState] = useState<any>(null);
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    let stop = false;
    const poll = async () => {
      try {
        const res = await fetch(`${ENGINE}/state`, { cache: "no-store" });
        if (!res.ok) throw new Error(String(res.status));
        const s = await res.json();
        if (!stop) {
          setState(s);
          setConnected(true);
        }
      } catch {
        if (!stop) setConnected(false);
      }
    };
    void poll();
    const timer = setInterval(poll, 3000);
    const onFocus = () => void poll();
    window.addEventListener("focus", onFocus);
    return () => {
      stop = true;
      clearInterval(timer);
      window.removeEventListener("focus", onFocus);
    };
  }, []);

  return { state, connected };
}

export type RangeKey = "today" | "yesterday" | "7d" | "30d" | "custom";

export function rangeQuery(range: RangeKey, from?: string, to?: string) {
  if (range === "custom" && from && to) {
    return `range=custom&from=${new Date(from).getTime()}&to=${new Date(to).getTime() + 86_400_000}`;
  }
  return `range=${range}`;
}
