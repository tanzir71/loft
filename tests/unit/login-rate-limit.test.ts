import { describe, expect, it } from "vitest";

import {
  clearLoginFailures,
  loginRateLimitStatus,
  recordFailedLogin,
  resetLoginRateLimitForTests,
} from "@/lib/login-rate-limit";

describe("login rate limiting", () => {
  it("blocks repeated failed attempts and clears after a successful login", () => {
    resetLoginRateLimitForTests();
    const now = 1000;

    for (let index = 0; index < 5; index += 1) {
      recordFailedLogin("Tutor@Example.com", { now: now + index });
    }

    expect(loginRateLimitStatus("tutor@example.com", { now: now + 5 })).toEqual({
      allowed: false,
      retryAfterSeconds: 600,
    });

    clearLoginFailures("tutor@example.com");

    expect(loginRateLimitStatus("tutor@example.com", { now: now + 6 })).toEqual({
      allowed: true,
      retryAfterSeconds: 0,
    });
  });
});
