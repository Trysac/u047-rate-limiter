import { describe, expect, it } from "vitest";
import * as rl from "../src/index.js";

function makeClock(start = 0) {
  let now = start;
  return {
    clock: (): number => now,
    set: (value: number): void => {
      now = value;
    },
    advance: (ms: number): void => {
      now += ms;
    },
  };
}

type FakeClock = ReturnType<typeof makeClock>;

function makeWindow(clock: () => number) {
  return new rl.SlidingWindow({ limit: 100, windowMs: 60_000, clock });
}

function makeSmall(clock: () => number) {
  return new rl.SlidingWindow({ limit: 10, windowMs: 1000, clock });
}

/** 80 hits in the previous window, 20 in the current, 15_000 ms into it. */
async function prepare(win: rl.SlidingWindow, c: FakeClock): Promise<void> {
  c.set(0);
  await win.consume("a", 80);
  c.set(60_000);
  await win.consume("a", 20);
  c.set(75_000);
}

describe("SlidingWindow", () => {
  it("allows cost 20 when the estimate is 80", async () => {
    const c = makeClock();
    const win = makeWindow(c.clock);
    await prepare(win, c);
    const r = await win.consume("a", 20);
    expect(r).toEqual({
      allowed: true,
      limit: 100,
      remaining: 0,
      resetMs: 105_000,
      retryAfterMs: 0,
    });
  });

  it("rejects cost 21 with retryAfterMs 750 without counting it", async () => {
    const c = makeClock();
    const win = makeWindow(c.clock);
    await prepare(win, c);
    const r = await win.consume("a", 21);
    expect(r).toEqual({
      allowed: false,
      limit: 100,
      remaining: 20,
      resetMs: 105_000,
      retryAfterMs: 750,
    });
    const fits = await win.consume("a", 20);
    expect(fits.allowed).toBe(true);
    expect(fits.remaining).toBe(0);
    c.advance(750);
    const wait = await makeWindow(c.clock).consume("fresh", 1);
    expect(wait.allowed).toBe(true);
  });

  it("allows a rejected cost once the hinted wait has passed", async () => {
    const c = makeClock();
    const win = makeWindow(c.clock);
    await prepare(win, c);
    expect((await win.consume("a", 21)).retryAfterMs).toBe(750);
    c.advance(749);
    expect((await win.consume("a", 21)).allowed).toBe(false);
    c.set(75_750);
    expect((await win.consume("a", 21)).allowed).toBe(true);
  });

  it("has no double burst at a window edge", async () => {
    const c = makeClock(59_999);
    const win = makeWindow(c.clock);
    for (let i = 0; i < 100; i++) {
      expect((await win.consume("a")).allowed).toBe(true);
    }
    c.set(60_000);
    const r = await win.consume("a");
    expect(r).toEqual({
      allowed: false,
      limit: 100,
      remaining: 0,
      resetMs: 60_000,
      retryAfterMs: 600,
    });
    c.set(120_000);
    expect((await win.consume("a")).allowed).toBe(true);
  });

  it("handles a single cost 100 hit at the window edge", async () => {
    const c = makeClock(59_999);
    const win = makeWindow(c.clock);
    expect((await win.consume("a", 100)).allowed).toBe(true);
    c.set(60_000);
    const r = await win.consume("a");
    expect(r.allowed).toBe(false);
    expect(r.retryAfterMs).toBe(600);
  });

  it("waits for the next window when the current one is full", async () => {
    const c = makeClock();
    const win = makeSmall(c.clock);
    const full = await win.consume("a", 10);
    expect(full.allowed).toBe(true);
    expect(full.remaining).toBe(0);
    const r = await win.consume("a");
    expect(r.allowed).toBe(false);
    expect(r.retryAfterMs).toBe(1100);
    c.set(1099);
    const almost = await win.consume("a");
    expect(almost.allowed).toBe(false);
    expect(almost.retryAfterMs).toBe(1);
    c.set(1100);
    expect((await win.consume("a")).allowed).toBe(true);
  });

  it("ignores windows older than one window", async () => {
    const c = makeClock();
    const win = makeSmall(c.clock);
    await win.consume("a", 10);
    c.set(10_000);
    const r = await win.consume("a", 10);
    expect(r.allowed).toBe(true);
    expect(r.remaining).toBe(0);
  });

  it("floors the fractional remaining count", async () => {
    const c = makeClock();
    const win = makeSmall(c.clock);
    await win.consume("a", 10);
    c.set(1250);
    const r = await win.consume("a");
    expect(r.allowed).toBe(true);
    expect(r.remaining).toBe(1);
    expect(r.resetMs).toBe(1750);
  });

  it("never grants a fresh quota when the clock moves backwards", async () => {
    const c = makeClock();
    const win = makeWindow(c.clock);
    await prepare(win, c);
    c.set(15_000);
    const r = await win.consume("a");
    expect(r.allowed).toBe(false);
    expect(r.retryAfterMs).toBe(750);
  });

  it("validates cost and key", async () => {
    const win = makeWindow(makeClock().clock);
    for (const cost of [101, 0, -1, 1.5]) {
      const attempt = win.consume("a", cost);
      await expect(attempt).rejects.toMatchObject({ code: "INVALID_COST" });
    }
    for (const key of ["", "k".repeat(513)]) {
      const attempt = win.consume(key);
      await expect(attempt).rejects.toMatchObject({ code: "KEY_INVALID" });
    }
    expect((await win.consume("k".repeat(512))).allowed).toBe(true);
  });

  it("isolates keys", async () => {
    const win = makeSmall(makeClock().clock);
    await win.consume("a", 10);
    expect((await win.consume("a")).allowed).toBe(false);
    const other = await win.consume("b");
    expect(other.allowed).toBe(true);
    expect(other.remaining).toBe(9);
  });

  it("uses Date.now when no clock is given", async () => {
    const win = new rl.SlidingWindow({ limit: 1, windowMs: 1000 });
    expect((await win.consume("a")).allowed).toBe(true);
    expect((await win.consume("a")).allowed).toBe(false);
  });

  it("rejects a clock that returns a non-finite value", async () => {
    const win = makeSmall(() => Number.POSITIVE_INFINITY);
    const attempt = win.consume("a");
    await expect(attempt).rejects.toMatchObject({ code: "INVALID_CONFIG" });
  });

  it("stores compact state and expires it after two windows", async () => {
    const c = makeClock();
    const store = new rl.MemoryStore({ clock: c.clock });
    const win = new rl.SlidingWindow({
      limit: 10,
      windowMs: 1000,
      store,
      clock: c.clock,
    });
    await win.consume("a");
    const raw = await store.get("sw:a");
    expect(JSON.parse(raw ?? "")).toEqual({ s: 0, c: 1, p: 0 });
    c.advance(1999);
    expect(await store.get("sw:a")).toBeDefined();
    c.advance(1);
    expect(await store.get("sw:a")).toBeUndefined();
  });

  it("keeps limiters with different prefixes apart on a shared store", async () => {
    const c = makeClock();
    const store = new rl.MemoryStore({ clock: c.clock });
    const make = (prefix: string) =>
      new rl.SlidingWindow({ limit: 1, windowMs: 1000, store, clock: c.clock, prefix });
    const x = make("x");
    const y = make("y");
    expect((await x.consume("a")).allowed).toBe(true);
    expect((await x.consume("a")).allowed).toBe(false);
    expect((await y.consume("a")).allowed).toBe(true);
  });

  it("treats corrupt or oversized state as absent", async () => {
    const c = makeClock();
    const store = new rl.MemoryStore({ clock: c.clock });
    const win = new rl.SlidingWindow({
      limit: 100,
      windowMs: 60_000,
      store,
      clock: c.clock,
    });
    const seeds = [
      "garbage",
      "[]",
      '{"s":0,"c":-1,"p":0}',
      '{"s":0,"c":0,"p":-1}',
      '{"s":0,"c":0}',
      '{"c":0,"p":0}',
      "x".repeat(300),
    ];
    for (const seed of seeds) {
      await store.set("sw:a", seed, 60_000);
      const r = await win.consume("a");
      expect(r.allowed).toBe(true);
      expect(r.remaining).toBe(99);
    }
  });

  it("works with a store that has no update()", async () => {
    const c = makeClock();
    const inner = new rl.MemoryStore({ clock: c.clock });
    const store: rl.RateLimitStore = {
      get: (key: string) => inner.get(key),
      set: (key: string, value: string, ttl: number) => inner.set(key, value, ttl),
    };
    const win = new rl.SlidingWindow({
      limit: 2,
      windowMs: 1000,
      store,
      clock: c.clock,
    });
    expect((await win.consume("a")).remaining).toBe(1);
    expect((await win.consume("a")).remaining).toBe(0);
    expect((await win.consume("a")).allowed).toBe(false);
  });

  it("propagates store failures and lazy updates", async () => {
    const failing: rl.RateLimitStore = {
      get: () => Promise.reject(new Error("boom")),
      set: () => Promise.reject(new Error("boom")),
    };
    const a = new rl.SlidingWindow({ limit: 1, windowMs: 10, store: failing });
    await expect(a.consume("a")).rejects.toThrow("boom");
    const lazy: rl.RateLimitStore = {
      get: async () => undefined,
      set: async () => undefined,
      async update(): Promise<string> {
        return "x";
      },
    };
    const b = new rl.SlidingWindow({ limit: 1, windowMs: 10, store: lazy });
    await expect(b.consume("a")).rejects.toMatchObject({
      code: "INVALID_CONFIG",
    });
  });
});
