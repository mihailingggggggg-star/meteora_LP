"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Wallet, Loader2, Check } from "lucide-react";
import { b58encode } from "@/lib/base58";
import { shortAddr } from "@/lib/format";
import { Button } from "@/components/ui/kit";

type Provider = {
  connect: (opts?: { onlyIfTrusted?: boolean }) => Promise<{ publicKey: { toString(): string } }>;
  signMessage: (msg: Uint8Array, enc?: string) => Promise<{ signature: Uint8Array }>;
  disconnect?: () => Promise<void>;
  on?: (ev: string, cb: (...a: any[]) => void) => void;
};

function getProvider(): Provider | null {
  if (typeof window === "undefined") return null;
  const w = window as any;
  if (w.phantom?.solana?.isPhantom) return w.phantom.solana as Provider;
  if (w.solana?.isPhantom) return w.solana as Provider;
  return null;
}

export function ConnectWallet({ compact = false }: { compact?: boolean }) {
  const [address, setAddress] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [installed, setInstalled] = useState(true);

  useEffect(() => {
    setInstalled(!!getProvider());
    fetch("/api/wallet/me")
      .then((r) => r.json())
      .then((d) => setAddress(d.address ?? null))
      .catch(() => {});
    const provider = getProvider();
    const onDisconnect = () => setAddress(null);
    provider?.on?.("disconnect", onDisconnect);
    provider?.on?.("accountChanged", onDisconnect);
  }, []);

  const connect = async () => {
    const provider = getProvider();
    if (!provider) {
      setInstalled(false);
      toast.error("Расширение Phantom не найдено", {
        description: "Установите Phantom и обновите страницу — подключение откроется как в Meteora.",
      });
      window.open("https://phantom.app/download", "_blank");
      return;
    }
    setBusy(true);
    try {
      const resp = await provider.connect();
      const pub = resp.publicKey.toString();
      const nonceRes = await fetch(`/api/wallet/nonce?address=${pub}`).then((r) => r.json());
      const message = nonceRes.message as string;
      const signed = await provider.signMessage(new TextEncoder().encode(message), "utf8");
      const verify = await fetch("/api/wallet/verify", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ address: pub, signature: b58encode(signed.signature) }),
      }).then((r) => r.json());
      if (!verify.ok) throw new Error(verify.error || "не удалось проверить подпись");
      setAddress(verify.address);
      toast.success("Кошелёк привязан", { description: shortAddr(verify.address, 6) });
    } catch (err: any) {
      const msg = String(err?.message ?? err);
      if (!/user rejected/i.test(msg)) toast.error("Подключение не удалось", { description: msg.slice(0, 120) });
    } finally {
      setBusy(false);
    }
  };

  if (address) {
    return (
      <button
        onClick={() => {
          navigator.clipboard?.writeText(address);
          toast.success("Адрес скопирован");
        }}
        className="flex items-center gap-2 rounded-full border border-mint/25 bg-mint/10 px-3 py-2 text-[12px] font-medium text-mint transition hover:bg-mint/15"
      >
        <Check className="h-3.5 w-3.5" />
        <span className="num">{shortAddr(address, 4)}</span>
      </button>
    );
  }

  return (
    <Button variant={compact ? "ghost" : "outline"} size="sm" onClick={connect} disabled={busy}>
      {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Wallet className="h-3.5 w-3.5" />}
      <span className="hidden sm:inline">{busy ? "Подключаем…" : "Привязать кошелёк"}</span>
    </Button>
  );
}
