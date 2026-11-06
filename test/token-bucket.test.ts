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

function makeBucket(clock: () => number, refillPerSecond = 1) {
  return new rl.TokenBucket({ capacity: 10, refillPerSecond, clock });
}

async function drain(bucket: rl.TokenBucket, key: string): Promise<void> {
  for (let i = 0; i < 10; i++) {
    await bucket.consume(key);
  }
}

describe("TokenBucket", () => {
  it("allows 10 immediate calls, rejects the 11th, refills after 1000 ms", async () => {
    const c = makeClock();
    const bucket = makeBucket(c.clock);
    for (let i = 0; i < 10; i++) {
      const r = await bucket.consume("a");
      expect(r.allowed).toBe(true);
      expect(r.remaining).toBe(9 - i);
    }
    const rejected = await bucket.consume("a");
    expect(rejected).toEqual({
      allowed: false,
      limit: 10,
      remaining: 0,
      resetMs: 10_000,
      retryAfterMs: 1000,
    });
    c.advance(1000);
    const again = await bucket.consume("a");
    expect(again.allowed).toBe(true);
    expect(again.remaining).toBe(0);
  });

  it("reports retryAfterMs 2000 with refillPerSecond 0.5", async () => {
    const c = makeClock();
    const bucket = makeBucket(c.clock, 0.5);
    await drain(bucket, "a");
    const rejected = await bucket.consume("a");
    expect(rejected.allowed).toBe(false);
    expect(rejected.retryAfterMs).toBe(2000);
    c.advance(1000);
    const half = await bucket.consume("a");
    expect(half.allowed).toBe(false);
    expect(half.retryAfterMs).toBe(1000);
    c.advance(1000);
    expect((await bucket.consume("a")).allowed).toBe(true);
  });

  it("refills fractional tokens continuously", async () => {
    const c = makeClock();
    const bucket = makeBucket(c.clock, 3);
    await drain(bucket, "a");
    c.advance(500);
    const first = await bucket.consume("a");
    expect(first.allowed).toBe(true);
    expect(first.remaining).toBe(0);
    const second = await bucket.consume("a");
    expect(second.allowed).toBe(false);
    expect(second.retryAfterMs).toBe(167);
  });

  it("caps refill after a long idle gap", async () => {
    const c = makeClock();
    const bucket = makeBucket(c.clock);
    await drain(bucket, "a");
    c.advance(1_000_000_000);
    const first = await bucket.consume("a");
    expect(first.remaining).toBe(9);
    for (let i = 0; i < 9; i++) {
      expect((await bucket.consume("a")).allowed).toBe(true);
    }
    expect((await bucket.consume("a")).allowed).toBe(false);
  });

  it("supports costs and does not consume on rejection", async () => {
    const c = makeClock();
    const bucket = makeBucket(c.clock);
    const big = await bucket.consume("a", 10);
    expect(big.allowed).toBe(true);
    expect(big.remaining).toBe(0);
    const none = await bucket.consume("a", 4);
    expect(none.allowed).toBe(false);
    expect(none.retryAfterMs).toBe(4000);
    c.advance(4000);
    const tooMuch = await bucket.consume("a", 5);
    expect(tooMuch.allowed).toBe(false);
    expect(tooMuch.retryAfterMs).toBe(1000);
    const ok = await bucket.consume("a", 4);
    expect(ok.allowed).toBe(true);
    expect(ok.remaining).toBe(0);
  });

  it("validates cost and key", async () => {
    const bucket = makeBucket(makeClock().clock);
    for (const cost of [11, 0, -1, 1.5, Number.NaN]) {
      const attempt = bucket.consume("a", cost);
      await expect(attempt).rejects.toMatchObject({ code: "INVALID_COST" });
      await expect(attempt).rejects.toBeInstanceOf(rl.RateLimitError);
    }
    for (const key of ["", "k".repeat(513), 5 as unknown as string]) {
      const attempt = bucket.consume(key);
      await expect(attempt).rejects.toMatchObject({ code: "KEY_INVALID" });
    }
    const ok = await bucket.consume("k".repeat(512));
    expect(ok.allowed).toBe(true);
  });

  it("isolates keys", async () => {
    const bucket = makeBucket(makeClock().clock);
    await drain(bucket, "a");
    expect((await bucket.consume("a")).allowed).toBe(false);
    const other = await bucket.consume("b");
    expect(other.allowed).toBe(true);
    expect(other.remaining).toBe(9);
  });

  it("counts a clock moving from 1000 to 500 as zero elapsed time", async () => {
    const c = makeClock(1000);
    const bucket = makeBucket(c.clock);
    await bucket.consume("a", 10);
    c.set(500);
    const back = await bucket.consume("a");
    expect(back).toMatchObject({
      allowed: false,
      remaining: 0,
      retryAfterMs: 1000,
    });
    c.set(1500);
    const later = await bucket.consume("a");
    expect(later.allowed).toBe(false);
    expect(later.retryAfterMs).toBe(500);
  });

  it("rejects a clock that returns a non-finite value", async () => {
    const bucket = makeBucket(() => Number.NaN);
    const attempt = bucket.consume("a");
    await expect(attempt).rejects.toMatchObject({ code: "INVALID_CONFIG" });
  });

  it("uses Date.now when no clock is given", async () => {
    const bucket = new rl.TokenBucket({ capacity: 1, refillPerSecond: 1 });
    const r = await bucket.consume("a");
    expect(r.allowed).toBe(true);
    expect(r.remaining).toBe(0);
  });

  it("stores compact state under prefix:key and expires it", async () => {
    const c = makeClock();
    const store = new rl.MemoryStore({ clock: c.clock });
    const bucket = new rl.TokenBucket({
      capacity: 10,
      refillPerSecond: 1,
      store,
      clock: c.clock,
      prefix: "api",
    });
    await bucket.consume("a");
    const raw = await store.get("api:a");
    expect(JSON.parse(raw ?? "")).toEqual({ t: 9, s: 0 });
    c.advance(9_999);
    expect(await store.get("api:a")).toBeDefined();
    c.advance(1);
    expect(await store.get("api:a")).toBeUndefined();
  });

  it("keeps limiters with different prefixes apart on a shared store", async () => {
    const c = makeClock();
    const store = new rl.MemoryStore({ clock: c.clock });
    const make = (prefix: string) =>
      new rl.TokenBucket({ capacity: 1, refillPerSecond: 1, store, clock: c.clock, prefix });
    const x = make("x");
    const y = make("y");
    expect((await x.consume("a")).allowed).toBe(true);
    expect((await x.consume("a")).allowed).toBe(false);
    expect((await y.consume("a")).allowed).toBe(true);
  });

  it("treats corrupt or oversized state as absent", async () => {
    const c = makeClock();
    const store = new rl.MemoryStore({ clock: c.clock });
    const bucket = new rl.TokenBucket({
      capacity: 10,
      refillPerSecond: 1,
      store,
      clock: c.clock,
    });
    const seeds = [
      "garbage",
      "[]",
      "null",
      '{"t":"x","s":1}',
      '{"t":0}',
      "x".repeat(300),
      '{"t":999,"s":0}',
    ];
    for (const seed of seeds) {
      await store.set("tb:a", seed, 60_000);
      const r = await bucket.consume("a");
      expect(r.allowed).toBe(true);
      expect(r.remaining).toBe(9);
    }
  });

  it("clamps negative stored tokens to zero", async () => {
    const c = makeClock();
    const store = new rl.MemoryStore({ clock: c.clock });
    const bucket = makeBucketWithStore(c.clock, store);
    await store.set("tb:a", '{"t":-5,"s":0}', 60_000);
    const r = await bucket.consume("a");
    expect(r.allowed).toBe(false);
  });

  it("works with a store that has no update()", async () => {
    const c = makeClock();
    const inner = new rl.MemoryStore({ clock: c.clock });
    const calls = { get: 0, set: 0 };
    const store: rl.RateLimitStore = {
      async get(key: string): Promise<string | undefined> {
        calls.get += 1;
        return inner.get(key);
      },
      async set(key: string, value: string, ttlMs: number): Promise<void> {
        calls.set += 1;
        await inner.set(key, value, ttlMs);
      },
    };
    expect(store.update).toBeUndefined();
    const bucket = makeBucketWithStore(c.clock, store);
    await bucket.consume("a");
    const second = await bucket.consume("a");
    expect(second.remaining).toBe(8);
    expect(calls).toEqual({ get: 2, set: 2 });
  });

  it("propagates store failures", async () => {
    const failing: rl.RateLimitStore = {
      get: () => Promise.reject(new Error("boom")),
      set: () => Promise.reject(new Error("boom")),
    };
    const bucket = makeBucketWithStore(makeClock().clock, failing);
    await expect(bucket.consume("a")).rejects.toThrow("boom");
  });

  it("fails when a store update never applies the function", async () => {
    const lazy: rl.RateLimitStore = {
      get: async () => undefined,
      set: async () => undefined,
      async update(): Promise<string> {
        return "x";
      },
    };
    const bucket = makeBucketWithStore(makeClock().clock, lazy);
    const attempt = bucket.consume("a");
    await expect(attempt).rejects.toMatchObject({ code: "INVALID_CONFIG" });
  });
});

function makeBucketWithStore(clock: () => number, store: rl.RateLimitStore) {
  return new rl.TokenBucket({ capacity: 10, refillPerSecond: 1, store, clock });
}
