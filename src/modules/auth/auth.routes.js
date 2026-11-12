const express = require('express');

const env = require('../../config/env');
const authenticate = require('../../middlewares/auth.middleware');
const {
  createRateLimiter,
} = require('../../middlewares/rate-limit.middleware');
const { validate } = require('../../middlewares/validate.middleware');
const asyncHandler = require('../../utils/async-handler');
const authController = require('./auth.controller');
const { loginSchema } = require('./auth.validation');

const router = express.Router();

// Key login attempts by IP and email so one account cannot be brute-forced
// without also locking out unrelated accounts behind the same NAT.
const loginRateLimit = createRateLimiter({
  name: 'auth:login',
  windowMs: env.AUTH_RATE_LIMIT_WINDOW_MS,
  max: env.AUTH_RATE_LIMIT_MAX,
  message: 'Too many login attempts. Please try again later.',
  keyGenerator: (req) =>
    `${req.ip || 'unknown'}|${String(req.body?.email || '').toLowerCase()}`,
});

router.post(
  '/login',
  loginRateLimit,
  validate(loginSchema),
  asyncHandler(authController.login)
);
router.post('/logout', authController.logout);
router.get('/me', authenticate, asyncHandler(authController.me));

module.exports = router;
