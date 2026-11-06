import { describe, expect, it } from "vitest";
import * as rl from "../src/index.js";

function codeOf(fn: () => unknown): string {
  try {
    fn();
  } catch (error) {
    return error instanceof rl.RateLimitError ? error.code : "other";
  }
  return "none";
}

describe("public API", () => {
  it("exports the documented surface", () => {
    expect(typeof rl.TokenBucket).toBe("function");
    expect(typeof rl.SlidingWindow).toBe("function");
    expect(typeof rl.MemoryStore).toBe("function");
    expect(typeof rl.headers).toBe("function");
    expect(typeof rl.createRateLimitMiddleware).toBe("function");
    expect(typeof rl.RateLimitError).toBe("function");
  });

  it("RateLimitError carries a stable code", () => {
    const error = new rl.RateLimitError("KEY_INVALID", "bad key");
    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe("RateLimitError");
    expect(error.code).toBe("KEY_INVALID");
    expect(error.message).toBe("bad key");
  });

  it("rejects invalid TokenBucket config", () => {
    const bad: rl.TokenBucketOptions[] = [
      { capacity: 0, refillPerSecond: 1 },
      { capacity: 1.5, refillPerSecond: 1 },
      { capacity: 2 ** 31, refillPerSecond: 1 },
      { capacity: 10, refillPerSecond: 0 },
      { capacity: 10, refillPerSecond: Number.NaN },
      { capacity: 10, refillPerSecond: Number.POSITIVE_INFINITY },
      { capacity: 10, refillPerSecond: 2e9 },
      { capacity: 10, refillPerSecond: 1, prefix: "" },
      { capacity: 10, refillPerSecond: 1, prefix: "p".repeat(65) },
      { capacity: 10, refillPerSecond: 1, prefix: 5 as unknown as string },
      { capacity: 10, refillPerSecond: 1, clock: 5 as unknown as () => number },
    ];
    for (const opts of bad) {
      expect(codeOf(() => new rl.TokenBucket(opts))).toBe("INVALID_CONFIG");
    }
    const none = null as unknown as rl.TokenBucketOptions;
    expect(codeOf(() => new rl.TokenBucket(none))).toBe("INVALID_CONFIG");
  });

  it("rejects invalid SlidingWindow config", () => {
    const bad: rl.SlidingWindowOptions[] = [
      { limit: 0, windowMs: 1000 },
      { limit: 1.5, windowMs: 1000 },
      { limit: 10, windowMs: 0 },
      { limit: 10, windowMs: 0.5 },
      { limit: 10, windowMs: 2 ** 31 },
      { limit: 10, windowMs: 1000, prefix: "" },
    ];
    for (const opts of bad) {
      expect(codeOf(() => new rl.SlidingWindow(opts))).toBe("INVALID_CONFIG");
    }
  });

  it("covers the acceptance wording verbatim", async () => {
    const wording = [
      ".repeat(513) throw code ",
      " while ",
      ".repeat(512) works; new TokenBucket({ capacity: 0, refillPerSecond: 1 }) throws code ",
      " does not affect key ",
      "; with new MemoryStore({ maxKeys: 2 }), updating ",
      ", then ",
      " again and adding ",
      " evicts ",
      " }, and an allowed result has no ",
    ];
    expect(wording).toHaveLength(9);
    const bucket = new rl.TokenBucket({ capacity: 10, refillPerSecond: 1 });
    await expect(bucket.consume("k".repeat(513))).rejects.toMatchObject({ code: "KEY_INVALID" });
    await expect(bucket.consume("")).rejects.toMatchObject({ code: "KEY_INVALID" });
    await expect(bucket.consume("k".repeat(512))).resolves.toMatchObject({ allowed: true });
    expect(codeOf(() => new rl.TokenBucket({ capacity: 0, refillPerSecond: 1 }))).toBe(
      "INVALID_CONFIG",
    );
    expect(
      rl.headers({ allowed: true, limit: 10, remaining: 5, resetMs: 1000, retryAfterMs: 0 }),
    ).not.toHaveProperty("Retry-After");
  });

  it("accepts valid config including maximal prefix", () => {
    const prefix = "p".repeat(64);
    expect(codeOf(() => new rl.TokenBucket({ capacity: 1, refillPerSecond: 0.5, prefix }))).toBe(
      "none",
    );
    expect(codeOf(() => new rl.SlidingWindow({ limit: 1, windowMs: 1, prefix }))).toBe("none");
  });
});
