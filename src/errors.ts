import type { RateLimitCode } from "./types.js";

/**
 * Base error of the library. `code` is stable and machine-readable; messages
 * never contain caller input.
 */
export class RateLimitError extends Error {
  /** Stable error code. */
  readonly code: RateLimitCode;

  /**
   * @param code - Stable machine-readable code.
   * @param message - Human-readable description without secrets or input.
   */
  constructor(code: RateLimitCode, message: string) {
    super(message);
    this.name = "RateLimitError";
    this.code = code;
  }
}
