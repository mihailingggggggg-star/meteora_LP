const ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

export function b58encode(bytes: Uint8Array): string {
  let zeros = 0;
  while (zeros < bytes.length && bytes[zeros] === 0) zeros++;
  const digits: number[] = [];
  for (let i = zeros; i < bytes.length; i++) {
    let carry = bytes[i];
    for (let j = 0; j < digits.length; j++) {
      carry += digits[j] << 8;
      digits[j] = carry % 58;
      carry = (carry / 58) | 0;
    }
    while (carry > 0) {
      digits.push(carry % 58);
      carry = (carry / 58) | 0;
    }
  }
  let out = "1".repeat(zeros);
  for (let i = digits.length - 1; i >= 0; i--) out += ALPHABET[digits[i]];
  return out;
}

/** Дискриминаторы событий обмена из IDL программы DLMM (`idls/dlmm.json`). */
const SWAP = Uint8Array.from([81, 108, 227, 190, 205, 208, 10, 196]);
const SWAP2 = Uint8Array.from([46, 116, 82, 215, 148, 27, 84, 77]);

export type DlmmSwapEvent = {
  lbPair: string;
  from: string;
  startBinId: number;
  endBinId: number;
  amountIn: bigint;
  amountOut: bigint;
  swapForY: boolean;
  fee: bigint;
};

class Reader {
  offset = 0;
  constructor(private buf: Uint8Array) {}
  private view(n: number) {
    if (this.offset + n > this.buf.length) throw new Error("eof");
    return new DataView(this.buf.buffer, this.buf.byteOffset + this.offset, n);
  }
  u8() {
    this.view(1);
    return this.buf[this.offset++];
  }
  bool() {
    return this.u8() !== 0;
  }
  i32() {
    const v = this.view(4).getInt32(0, true);
    this.offset += 4;
    return v;
  }
  u64(): bigint {
    const v = this.view(8).getBigUint64(0, true);
    this.offset += 8;
    return v;
  }
  u128(): bigint {
    const lo = this.u64();
    const hi = this.u64();
    return (hi << 64n) + lo;
  }
  pubkey(): string {
    if (this.offset + 32 > this.buf.length) throw new Error("eof");
    const key = b58encode(this.buf.subarray(this.offset, this.offset + 32));
    this.offset += 32;
    return key;
  }
}

const matchDisc = (b: Uint8Array, d: Uint8Array) => {
  if (b.length < 8) return false;
  for (let i = 0; i < 8; i++) if (b[i] !== d[i]) return false;
  return true;
};

/** Событие обмена из логов транзакции — без RPC. */
export function decodeSwapFromLogs(logs: string[], expectedPool?: string): DlmmSwapEvent | null {
  for (const line of logs ?? []) {
    const marker = "Program data: ";
    const idx = line.indexOf(marker);
    if (idx < 0) continue;
    let bytes: Uint8Array;
    try {
      bytes = Buffer.from(line.slice(idx + marker.length).trim(), "base64");
    } catch {
      continue;
    }
    const isSwap = matchDisc(bytes, SWAP);
    const isSwap2 = matchDisc(bytes, SWAP2);
    if (!isSwap && !isSwap2) continue;

    try {
      const r = new Reader(bytes);
      r.offset = 8;
      const lbPair = r.pubkey();
      const from = r.pubkey();
      const startBinId = r.i32();
      const endBinId = r.i32();

      if (isSwap) {
        const amountIn = r.u64();
        const amountOut = r.u64();
        const swapForY = r.bool();
        const fee = r.u64();
        r.u64();
        r.u128();
        r.u64();
        if (expectedPool && lbPair !== expectedPool) continue;
        return { lbPair, from, startBinId, endBinId, amountIn, amountOut, swapForY, fee };
      }

      const swapForY = r.bool();
      r.u64();
      const amountIn = r.u64();
      const amountLeft = r.u64();
      const amountOut = r.u64();
      r.u64();
      r.u64();
      r.u64();
      const hostFee = r.u64();
      r.bool();
      r.bool();
      if (expectedPool && lbPair !== expectedPool) continue;
      return {
        lbPair,
        from,
        startBinId,
        endBinId,
        amountIn: amountIn - amountLeft,
        amountOut,
        swapForY,
        fee: hostFee,
      };
    } catch {
      continue;
    }
  }
  return null;
}
