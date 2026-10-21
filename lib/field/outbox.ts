"use client";

import type { CollectPayload, FieldOp, OpResult } from "./types";

// Everything the collector records goes into this outbox first (localStorage),
// then is sent in order. An entry leaves the outbox only when the server has
// accepted it (or says it already had it). Rejected entries stay, marked, so
// the collector can see why.

export type OutboxEntry = {
  op: FieldOp;
  photo?: string; // data URL of the cheque photo until it is uploaded
  label: string; // shown in the pending list
  state: "pending" | "rejected";
  error?: string;
  result?: OpResult;
};

const OUTBOX = "sa-field-outbox-v1";
const SENT = "sa-field-sent-v1";
const beatKey = (beatId: string) => `sa-field-beat-v1:${beatId}`;

function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function write(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Storage full: the newest cached beat list is the least important; drop caches first.
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const k = localStorage.key(i);
      if (k?.startsWith("sa-field-beat-v1:")) localStorage.removeItem(k);
    }
    localStorage.setItem(key, JSON.stringify(value));
  }
}

export const outbox = {
  list: (): OutboxEntry[] => read<OutboxEntry[]>(OUTBOX, []),
  add(entry: OutboxEntry) {
    write(OUTBOX, [...outbox.list(), entry]);
  },
  remove(id: string) {
    write(OUTBOX, outbox.list().filter((e) => e.op.client_op_id !== id));
  },
  update(id: string, patch: Partial<OutboxEntry>) {
    write(OUTBOX, outbox.list().map((e) => (e.op.client_op_id === id ? { ...e, ...patch } : e)));
  },
  /** Entries sent today, kept so the day total survives a refresh while offline. */
  sentToday(): OutboxEntry[] {
    const today = new Date().toDateString();
    return read<OutboxEntry[]>(SENT, []).filter((e) => new Date(e.op.happened_at).toDateString() === today);
  },
  markSent(entry: OutboxEntry) {
    write(SENT, [...outbox.sentToday(), entry].slice(-300));
  },
};

export const beatCache = {
  get: (beatId: string) => read<CollectPayload | null>(beatKey(beatId), null),
  set: (p: CollectPayload) => write(beatKey(p.beatId), p),
};

let flushing: Promise<{ sent: number; rejected: number; offline: boolean }> | null = null;

/** Send every pending entry, oldest first. Stops at the first network failure. */
export function flushOutbox(): Promise<{ sent: number; rejected: number; offline: boolean }> {
  if (flushing) return flushing;
  const run = (async () => {
    let sent = 0;
    let rejected = 0;
    try {
      for (const entry of outbox.list()) {
        if (entry.state === "rejected") continue;
        const op = { ...entry.op };

        if (entry.photo && !op.cheque_photo_path) {
          const form = new FormData();
          form.append("file", dataUrlToBlob(entry.photo), `${op.client_op_id}.jpg`);
          form.append("client_op_id", op.client_op_id);
          const res = await fetch("/api/field/photo", { method: "POST", body: form });
          if (!res.ok) {
            if (res.status >= 500 || res.status === 401) return { sent, rejected, offline: res.status >= 500 };
            const { error } = await res.json().catch(() => ({ error: "Photo rejected" }));
            outbox.update(op.client_op_id, { state: "rejected", error });
            rejected++;
            continue;
          }
          const { path } = (await res.json()) as { path: string };
          op.cheque_photo_path = path;
          outbox.update(op.client_op_id, { op });
        }

        const res = await fetch("/api/field/ops", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(op),
        });
        if (res.ok) {
          const result = (await res.json()) as OpResult;
          outbox.remove(op.client_op_id);
          outbox.markSent({ ...entry, op, photo: undefined, result });
          sent++;
        } else if (res.status === 422) {
          const { error } = await res.json().catch(() => ({ error: "Rejected" }));
          outbox.update(op.client_op_id, { state: "rejected", error });
          rejected++;
        } else {
          // 401 (signed out) or a server problem: keep everything and try later.
          return { sent, rejected, offline: res.status !== 401 };
        }
      }
      return { sent, rejected, offline: false };
    } catch {
      return { sent, rejected, offline: true };
    }
  })();
  // Cleared only after the run is stored, even when it finishes at once.
  flushing = run.finally(() => {
    flushing = null;
  });
  return flushing;
}

function dataUrlToBlob(dataUrl: string): Blob {
  const [head, body] = dataUrl.split(",");
  const mime = /data:(.*?);/.exec(head ?? "")?.[1] ?? "image/jpeg";
  const bin = atob(body ?? "");
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}

/** Shrink a camera photo to at most 1280 px on the long side, as JPEG. */
export async function compressPhoto(file: File): Promise<string> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = reject;
      i.src = url;
    });
    const scale = Math.min(1, 1280 / Math.max(img.width, img.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(img.width * scale);
    canvas.height = Math.round(img.height * scale);
    canvas.getContext("2d")!.drawImage(img, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/jpeg", 0.7);
  } finally {
    URL.revokeObjectURL(url);
  }
}

export function newOpId(): string {
  return crypto.randomUUID();
}

/** Best-effort location; never blocks saving for more than 4 seconds. */
export function currentPosition(): Promise<{ lat?: string; lng?: string }> {
  return new Promise((resolve) => {
    if (!("geolocation" in navigator)) return resolve({});
    const timer = setTimeout(() => resolve({}), 4000);
    navigator.geolocation.getCurrentPosition(
      (p) => {
        clearTimeout(timer);
        resolve({ lat: p.coords.latitude.toFixed(6), lng: p.coords.longitude.toFixed(6) });
      },
      () => {
        clearTimeout(timer);
        resolve({});
      },
      { enableHighAccuracy: false, timeout: 4000, maximumAge: 120000 },
    );
  });
}
