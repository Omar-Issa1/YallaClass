const AppError = require('../utils/app-error');

/**
 * Minimal in-memory fixed-window rate limiter.
 *
 * The MVP runs as a single Node process, so a process-local map is enough to
 * slow down credential stuffing and public game-code enumeration. A
 * multi-instance deployment would need a shared store (for example Redis),
 * which is intentionally out of scope for this project.
 */
const buckets = new Map();
let sweepTimer = null;

function sweepExpiredBuckets() {
  const now = Date.now();

  for (const [key, bucket] of buckets) {
    if (bucket.resetAt <= now) {
      buckets.delete(key);
    }
  }
}

function ensureSweepTimer() {
  if (sweepTimer) {
    return;
  }

  sweepTimer = setInterval(sweepExpiredBuckets, 60 * 1000);

  if (typeof sweepTimer.unref === 'function') {
    sweepTimer.unref();
  }
}

function defaultKeyGenerator(req) {
  return req.ip || req.socket?.remoteAddress || 'unknown';
}

function createRateLimiter({
  name,
  windowMs,
  max,
  message = 'Too many requests. Please try again later.',
  keyGenerator = defaultKeyGenerator,
}) {
  return function rateLimitMiddleware(req, res, next) {
    const now = Date.now();
    const key = `${name}:${String(keyGenerator(req) || 'unknown').slice(0, 300)}`;
    let bucket = buckets.get(key);

    if (!bucket || bucket.resetAt <= now) {
      bucket = { count: 0, resetAt: now + windowMs };
      buckets.set(key, bucket);
    }

    bucket.count += 1;
    ensureSweepTimer();

    res.setHeader('RateLimit-Limit', String(max));
    res.setHeader('RateLimit-Remaining', String(Math.max(0, max - bucket.count)));
    res.setHeader('RateLimit-Reset', String(Math.ceil(bucket.resetAt / 1000)));

    if (bucket.count > max) {
      res.setHeader(
        'Retry-After',
        String(Math.max(1, Math.ceil((bucket.resetAt - now) / 1000)))
      );

      return next(new AppError(message, 429));
    }

    return next();
  };
}

function resetRateLimits() {
  buckets.clear();
}

module.exports = { createRateLimiter, resetRateLimits };
