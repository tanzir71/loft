type LoginRateLimitOptions = {
  now?: number;
};

const maxFailedAttempts = 5;
const windowMs = 10 * 60 * 1000;
const attempts = new Map<string, { count: number; firstAttemptAt: number }>();

function keyForEmail(email: string) {
  return email.trim().toLowerCase();
}

export function loginRateLimitStatus(email: string, input: LoginRateLimitOptions = {}) {
  const key = keyForEmail(email);
  const now = input.now ?? Date.now();
  const entry = attempts.get(key);

  if (!key || !entry) {
    return { allowed: true, retryAfterSeconds: 0 };
  }

  if (now - entry.firstAttemptAt >= windowMs) {
    attempts.delete(key);
    return { allowed: true, retryAfterSeconds: 0 };
  }

  if (entry.count < maxFailedAttempts) {
    return { allowed: true, retryAfterSeconds: 0 };
  }

  return {
    allowed: false,
    retryAfterSeconds: Math.ceil((entry.firstAttemptAt + windowMs - now) / 1000),
  };
}

export function recordFailedLogin(email: string, input: LoginRateLimitOptions = {}) {
  const key = keyForEmail(email);

  if (!key) {
    return;
  }

  const now = input.now ?? Date.now();
  const existing = attempts.get(key);

  if (!existing || now - existing.firstAttemptAt >= windowMs) {
    attempts.set(key, { count: 1, firstAttemptAt: now });
    return;
  }

  attempts.set(key, {
    count: existing.count + 1,
    firstAttemptAt: existing.firstAttemptAt,
  });
}

export function clearLoginFailures(email: string) {
  attempts.delete(keyForEmail(email));
}

export function resetLoginRateLimitForTests() {
  attempts.clear();
}
