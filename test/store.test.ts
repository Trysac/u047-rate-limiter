import { describe, expect, it } from "vitest";
import * as rl from "../src/index.js";

function makeClock(start = 0) {
  let now = start;
  return {
    clock: (): number => now,
    advance: (ms: number): void => {
      now += ms;
    },
  };
}

describe("MemoryStore", () => {
  it("sets, gets and expires values", async () => {
    const c = makeClock();
    const store = new rl.MemoryStore({ clock: c.clock });
    expect(await store.get("a")).toBeUndefined();
    await store.set("a", "1", 100);
    expect(await store.get("a")).toBe("1");
    c.advance(99);
    expect(await store.get("a")).toBe("1");
    c.advance(1);
    expect(await store.get("a")).toBeUndefined();
    expect(store.size).toBe(0);
  });

  it("evicts the least recently updated key at maxKeys", async () => {
    const store = new rl.MemoryStore({ maxKeys: 2 });
    const touch = (key: string) => store.update(key, () => "1", 60_000);
    await touch("a");
    await touch("b");
    await touch("a");
    await touch("c");
    expect(await store.get("a")).toBe("1");
    expect(await store.get("b")).toBeUndefined();
    expect(await store.get("c")).toBe("1");
    expect(store.size).toBe(2);
  });

  it("drops an expired key before any live one", async () => {
    const c = makeClock();
    const store = new rl.MemoryStore({ clock: c.clock, maxKeys: 2 });
    await store.set("live", "1", 100_000);
    await store.set("short", "1", 100);
    c.advance(200);
    await store.set("new", "1", 100_000);
    expect(await store.get("live")).toBe("1");
    expect(await store.get("short")).toBeUndefined();
    expect(await store.get("new")).toBe("1");
    expect(store.size).toBe(2);
  });

  it("does not evict others when overwriting an existing key", async () => {
    const store = new rl.MemoryStore({ maxKeys: 2 });
    await store.set("a", "1", 60_000);
    await store.set("b", "1", 60_000);
    await store.set("a", "2", 60_000);
    expect(await store.get("a")).toBe("2");
    expect(await store.get("b")).toBe("1");
  });

  it("is bounded by 10_000 keys by default", async () => {
    const store = new rl.MemoryStore();
    for (let i = 0; i < 10_050; i++) {
      await store.set(`k${i}`, "1", 60_000);
    }
    expect(store.size).toBe(10_000);
    expect(await store.get("k0")).toBeUndefined();
    expect(await store.get("k10049")).toBe("1");
  });

  it("update passes the current value and returns the next", async () => {
    const c = makeClock();
    const store = new rl.MemoryStore({ clock: c.clock });
    const seen: Array<string | undefined> = [];
    const bump = (cur: string | undefined): string => {
      seen.push(cur);
      return String(Number(cur ?? "0") + 1);
    };
    expect(await store.update("n", bump, 100)).toBe("1");
    expect(await store.update("n", bump, 100)).toBe("2");
    c.advance(100);
    expect(await store.update("n", bump, 100)).toBe("1");
    expect(seen).toEqual([undefined, "1", undefined]);
  });

  it("concurrent updates do not lose increments", async () => {
    const store = new rl.MemoryStore();
    const bump = (cur: string | undefined): string => String(Number(cur ?? "0") + 1);
    const jobs = Array.from({ length: 50 }, () => store.update("n", bump, 60_000));
    await Promise.all(jobs);
    expect(await store.get("n")).toBe("50");
  });

  it("leaves the value unchanged when the update function throws", async () => {
    const store = new rl.MemoryStore();
    await store.set("a", "1", 60_000);
    const boom = (): string => {
      throw new Error("boom");
    };
    await expect(store.update("a", boom, 60_000)).rejects.toThrow("boom");
    expect(await store.get("a")).toBe("1");
  });

  it("validates writes", async () => {
    const store = new rl.MemoryStore();
    const badKeys = ["", "k".repeat(1025), 5 as unknown as string];
    for (const key of badKeys) {
      await expect(store.set(key, "1", 100)).rejects.toMatchObject({
        code: "KEY_INVALID",
      });
    }
    const tooBig = store.set("a", "v".repeat(4097), 100);
    await expect(tooBig).rejects.toMatchObject({ code: "INVALID_CONFIG" });
    const notString = store.set("a", 5 as unknown as string, 100);
    await expect(notString).rejects.toMatchObject({ code: "INVALID_CONFIG" });
    for (const ttl of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      await expect(store.set("a", "1", ttl)).rejects.toMatchObject({
        code: "INVALID_CONFIG",
      });
    }
    await expect(store.set("k".repeat(1024), "v".repeat(4096), 1)).resolves.toBeUndefined();
  });

  it("validates options", () => {
    const make = (opts: rl.MemoryStoreOptions) => () => new rl.MemoryStore(opts);
    expect(make({ maxKeys: 0 })).toThrow(rl.RateLimitError);
    expect(make({ maxKeys: 1.5 })).toThrow(rl.RateLimitError);
    expect(make({ maxKeys: -1 })).toThrow(rl.RateLimitError);
    expect(make({ clock: 5 as unknown as () => number })).toThrow(rl.RateLimitError);
    const none = null as unknown as rl.MemoryStoreOptions;
    expect(make(none)).toThrow(rl.RateLimitError);
    expect(make({ maxKeys: 1 })).not.toThrow();
  });

  it("rejects a clock that returns a non-finite value", async () => {
    const store = new rl.MemoryStore({ clock: () => Number.NaN });
    await store.get("missing");
    await expect(store.set("a", "1", 100)).rejects.toMatchObject({
      code: "INVALID_CONFIG",
    });
  });
});
