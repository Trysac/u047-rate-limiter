import type { IncomingMessage, ServerResponse } from "node:http";
import { describe, expect, it, vi } from "vitest";
import * as rl from "../src/index.js";

const EXPECTED_PROBLEM_JSON_BODY_TEXT =
  '{"type":"about:blank","title":"Too Many Requests","status":429}';

function makeClock(start = 0) {
  let now = start;
  return {
    clock: (): number => now,
    advance: (ms: number): void => {
      now += ms;
    },
  };
}

function makeReq(): IncomingMessage {
  return {} as unknown as IncomingMessage;
}

function makeRes() {
  const headersOut: Record<string, string> = {};
  const captured = { body: "" };
  const fake = {
    statusCode: 0,
    setHeader(name: string, value: string): void {
      headersOut[name] = value;
    },
    end(body: string): void {
      captured.body = body;
    },
  };
  return {
    res: fake as unknown as ServerResponse,
    fake,
    headersOut,
    captured,
  };
}

const keyOf = (): string => "client";

const failingStore: rl.RateLimitStore = {
  get: () => Promise.reject(new Error("boom")),
  set: () => Promise.reject(new Error("boom")),
};

async function exhausted(): Promise<rl.RateLimitResult> {
  const bucket = new rl.TokenBucket({
    capacity: 10,
    refillPerSecond: 1,
    clock: makeClock().clock,
  });
  for (let i = 0; i < 10; i++) {
    await bucket.consume("a");
  }
  return bucket.consume("a");
}

describe("headers()", () => {
  it("builds the headers of a rejected token bucket result", async () => {
    const rejected = await exhausted();
    expect(rl.headers(rejected)).toEqual({
      "RateLimit-Limit": "10",
      "RateLimit-Remaining": "0",
      "RateLimit-Reset": "10",
      "Retry-After": "1",
    });
  });

  it("omits Retry-After for allowed results", async () => {
    const bucket = new rl.TokenBucket({ capacity: 10, refillPerSecond: 1 });
    const h = rl.headers(await bucket.consume("a"));
    expect("Retry-After" in h).toBe(false);
    expect(h["RateLimit-Remaining"]).toBe("9");
    expect(h["RateLimit-Limit"]).toBe("10");
  });

  it("rounds seconds up and sanitizes bad numbers", () => {
    const odd = rl.headers({
      allowed: false,
      limit: 5,
      remaining: 0,
      resetMs: 1500,
      retryAfterMs: 1001,
    });
    expect(odd["RateLimit-Reset"]).toBe("2");
    expect(odd["Retry-After"]).toBe("2");
    const bad = rl.headers({
      allowed: false,
      limit: 5,
      remaining: 0,
      resetMs: Number.NaN,
      retryAfterMs: -5,
    });
    expect(bad["RateLimit-Reset"]).toBe("0");
    expect(bad["Retry-After"]).toBe("0");
  });
});

describe("createRateLimitMiddleware()", () => {
  it("responds 429 problem+json when limited and calls next otherwise", async () => {
    const c = makeClock();
    const bucket = new rl.TokenBucket({
      capacity: 10,
      refillPerSecond: 1,
      clock: c.clock,
    });
    const onEvent = vi.fn();
    const next = vi.fn();
    const mw = rl.createRateLimitMiddleware(bucket, { keyOf, onEvent });
    for (let i = 0; i < 10; i++) {
      const { res, headersOut } = makeRes();
      await mw(makeReq(), res, next);
      expect(headersOut).toEqual({});
    }
    expect(next).toHaveBeenCalledTimes(10);
    expect(onEvent).not.toHaveBeenCalled();
    const { res, fake, headersOut, captured } = makeRes();
    await mw(makeReq(), res, next);
    expect(next).toHaveBeenCalledTimes(10);
    expect(fake.statusCode).toBe(429);
    expect(captured.body).toBe(EXPECTED_PROBLEM_JSON_BODY_TEXT);
    expect(headersOut).toEqual({
      "Content-Type": "application/problem+json",
      "RateLimit-Limit": "10",
      "RateLimit-Remaining": "0",
      "RateLimit-Reset": "10",
      "Retry-After": "1",
    });
    expect(onEvent).toHaveBeenCalledTimes(1);
    expect(onEvent).toHaveBeenCalledWith({ type: "limited" });
  });

  it("works with a sliding window limiter", async () => {
    const win = new rl.SlidingWindow({
      limit: 1,
      windowMs: 1000,
      clock: makeClock().clock,
    });
    const next = vi.fn();
    const mw = rl.createRateLimitMiddleware(win, { keyOf });
    await mw(makeReq(), makeRes().res, next);
    const { res, fake } = makeRes();
    await mw(makeReq(), res, next);
    expect(next).toHaveBeenCalledTimes(1);
    expect(fake.statusCode).toBe(429);
  });

  it("passes the request to keyOf", async () => {
    const bucket = new rl.TokenBucket({ capacity: 1, refillPerSecond: 1 });
    const seen: unknown[] = [];
    const mw = rl.createRateLimitMiddleware(bucket, {
      keyOf: (req) => {
        seen.push(req);
        return "k";
      },
    });
    const req = makeReq();
    await mw(req, makeRes().res, vi.fn());
    expect(seen).toEqual([req]);
  });

  it("rethrows store errors by default", async () => {
    const bucket = new rl.TokenBucket({
      capacity: 1,
      refillPerSecond: 1,
      store: failingStore,
    });
    const next = vi.fn();
    const onEvent = vi.fn();
    const mw = rl.createRateLimitMiddleware(bucket, { keyOf, onEvent });
    await expect(mw(makeReq(), makeRes().res, next)).rejects.toThrow("boom");
    expect(next).not.toHaveBeenCalled();
    expect(onEvent).not.toHaveBeenCalled();
  });

  it("fails open and emits store_error when failOpen is true", async () => {
    const bucket = new rl.TokenBucket({
      capacity: 1,
      refillPerSecond: 1,
      store: failingStore,
    });
    const next = vi.fn();
    const onEvent = vi.fn();
    const mw = rl.createRateLimitMiddleware(bucket, {
      keyOf,
      failOpen: true,
      onEvent,
    });
    await mw(makeReq(), makeRes().res, next);
    expect(next).toHaveBeenCalledTimes(1);
    expect(onEvent).toHaveBeenCalledTimes(1);
    expect(onEvent).toHaveBeenCalledWith({ type: "store_error" });
  });

  it("still fails open when the event callback throws", async () => {
    const bucket = new rl.TokenBucket({
      capacity: 1,
      refillPerSecond: 1,
      store: failingStore,
    });
    const next = vi.fn();
    const mw = rl.createRateLimitMiddleware(bucket, {
      keyOf,
      failOpen: true,
      onEvent: () => {
        throw new Error("observer failed");
      },
    });
    await mw(makeReq(), makeRes().res, next);
    expect(next).toHaveBeenCalledTimes(1);
  });

  it("never fails open on an invalid key", async () => {
    const bucket = new rl.TokenBucket({ capacity: 1, refillPerSecond: 1 });
    const next = vi.fn();
    const onEvent = vi.fn();
    const mw = rl.createRateLimitMiddleware(bucket, {
      keyOf: () => "",
      failOpen: true,
      onEvent,
    });
    await expect(mw(makeReq(), makeRes().res, next)).rejects.toMatchObject({
      code: "KEY_INVALID",
    });
    expect(next).not.toHaveBeenCalled();
    expect(onEvent).not.toHaveBeenCalled();
  });

  it("propagates keyOf failures even with failOpen", async () => {
    const bucket = new rl.TokenBucket({ capacity: 1, refillPerSecond: 1 });
    const mw = rl.createRateLimitMiddleware(bucket, {
      keyOf: () => {
        throw new Error("no key");
      },
      failOpen: true,
    });
    await expect(mw(makeReq(), makeRes().res, vi.fn())).rejects.toThrow("no key");
  });

  it("limits without an onEvent callback", async () => {
    const bucket = new rl.TokenBucket({
      capacity: 1,
      refillPerSecond: 1,
      clock: makeClock().clock,
    });
    const mw = rl.createRateLimitMiddleware(bucket, { keyOf });
    await mw(makeReq(), makeRes().res, vi.fn());
    const { res, fake } = makeRes();
    await mw(makeReq(), res, vi.fn());
    expect(fake.statusCode).toBe(429);
  });

  it("validates its arguments", () => {
    const bucket = new rl.TokenBucket({ capacity: 1, refillPerSecond: 1 });
    const noLimiter = null as unknown as rl.Limiter;
    const noOpts = null as unknown as rl.MiddlewareOptions;
    const badKey = { keyOf: 5 } as unknown as rl.MiddlewareOptions;
    expect(() => rl.createRateLimitMiddleware(noLimiter, { keyOf })).toThrow(rl.RateLimitError);
    expect(() => rl.createRateLimitMiddleware(bucket, noOpts)).toThrow(rl.RateLimitError);
    expect(() => rl.createRateLimitMiddleware(bucket, badKey)).toThrow(rl.RateLimitError);
  });
});
