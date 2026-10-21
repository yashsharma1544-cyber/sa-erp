import { beforeEach, describe, expect, it, vi } from "vitest";
import { flushOutbox, outbox } from "@/lib/field/outbox";
import type { FieldOp } from "@/lib/field/types";

// Minimal browser stand-ins for the outbox (it runs on the phone).
class MemoryStorage {
  private m = new Map<string, string>();
  get length() {
    return this.m.size;
  }
  key(i: number) {
    return [...this.m.keys()][i] ?? null;
  }
  getItem(k: string) {
    return this.m.get(k) ?? null;
  }
  setItem(k: string, v: string) {
    this.m.set(k, v);
  }
  removeItem(k: string) {
    this.m.delete(k);
  }
}

const op = (n: number, extra: Partial<FieldOp> = {}): FieldOp => ({
  client_op_id: `00000000-0000-0000-0000-00000000000${n}`,
  kind: "receipt",
  customer_id: "00000000-0000-0000-0000-0000000000aa",
  firm_id: "00000000-0000-0000-0000-0000000000bb",
  amount: "100.00",
  mode: "cash",
  happened_at: new Date().toISOString(),
  ...extra,
});

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

describe("field outbox", () => {
  beforeEach(() => {
    vi.stubGlobal("localStorage", new MemoryStorage());
  });

  it("sends entries in order and clears them once accepted", async () => {
    const sent: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body)) as FieldOp;
      sent.push(body.client_op_id);
      return json(200, { status: "created", kind: "receipt", id: body.client_op_id, receipt_no: `SA/R/26-27/0000${sent.length}` });
    }));
    outbox.add({ op: op(1), label: "a", state: "pending" });
    outbox.add({ op: op(2), label: "b", state: "pending" });

    const r = await flushOutbox();
    expect(r).toEqual({ sent: 2, rejected: 0, offline: false });
    expect(sent).toEqual([op(1).client_op_id, op(2).client_op_id]);
    expect(outbox.list()).toHaveLength(0);
    expect(outbox.sentToday().map((e) => e.result?.receipt_no)).toEqual(["SA/R/26-27/00001", "SA/R/26-27/00002"]);
  });

  it("keeps everything when the network is down", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => {
      throw new TypeError("Failed to fetch");
    }));
    outbox.add({ op: op(1), label: "a", state: "pending" });
    const r = await flushOutbox();
    expect(r.offline).toBe(true);
    expect(outbox.list()).toHaveLength(1);
    expect(outbox.list()[0]!.state).toBe("pending");
  });

  it("keeps entries on a server error and stops there", async () => {
    const calls = vi.fn(async () => json(500, { error: "boom" }));
    vi.stubGlobal("fetch", calls);
    outbox.add({ op: op(1), label: "a", state: "pending" });
    outbox.add({ op: op(2), label: "b", state: "pending" });
    await flushOutbox();
    expect(calls).toHaveBeenCalledTimes(1);
    expect(outbox.list().map((e) => e.state)).toEqual(["pending", "pending"]);
  });

  it("marks a rejected entry and carries on with the next", async () => {
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body)) as FieldOp;
      return body.client_op_id === op(1).client_op_id
        ? json(422, { error: "This customer is not in your collection beats" })
        : json(200, { status: "created", kind: "receipt", id: body.client_op_id });
    }));
    outbox.add({ op: op(1), label: "a", state: "pending" });
    outbox.add({ op: op(2), label: "b", state: "pending" });
    const r = await flushOutbox();
    expect(r).toEqual({ sent: 1, rejected: 1, offline: false });
    expect(outbox.list()).toHaveLength(1);
    expect(outbox.list()[0]).toMatchObject({ state: "rejected", error: "This customer is not in your collection beats" });
    // Rejected entries are not retried on the next send.
    const again = await flushOutbox();
    expect(again.sent + again.rejected).toBe(0);
  });

  it("uploads the cheque photo first and sends its path with the receipt", async () => {
    const urls: string[] = [];
    let sentPath: string | undefined;
    vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit) => {
      urls.push(url);
      if (url === "/api/field/photo") return json(200, { path: "2026-10/u/op.jpg" });
      sentPath = (JSON.parse(String(init.body)) as FieldOp).cheque_photo_path;
      return json(200, { status: "created", kind: "receipt", id: "x" });
    }));
    outbox.add({
      op: op(3, { mode: "cheque", cheque_no: "1", cheque_date: "2026-10-21", cheque_bank: "SBI" }),
      photo: "data:image/jpeg;base64,/9j/4AAQ",
      label: "c",
      state: "pending",
    });
    await flushOutbox();
    expect(urls).toEqual(["/api/field/photo", "/api/field/ops"]);
    expect(sentPath).toBe("2026-10/u/op.jpg");
    expect(outbox.sentToday()[0]!.photo).toBeUndefined();
  });

  it("does not upload the photo twice if the receipt failed after the upload", async () => {
    let photoCalls = 0;
    let fail = true;
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      if (url === "/api/field/photo") {
        photoCalls++;
        return json(200, { path: "p.jpg" });
      }
      if (fail) throw new TypeError("Failed to fetch");
      return json(200, { status: "created", kind: "receipt", id: "x" });
    }));
    outbox.add({ op: op(4, { mode: "cheque" }), photo: "data:image/jpeg;base64,AAAA", label: "d", state: "pending" });
    await flushOutbox();
    fail = false;
    await flushOutbox();
    expect(photoCalls).toBe(1);
    expect(outbox.list()).toHaveLength(0);
  });
});
