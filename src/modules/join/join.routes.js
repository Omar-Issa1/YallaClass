const express = require('express');

const env = require('../../config/env');
const {
  createRateLimiter,
} = require('../../middlewares/rate-limit.middleware');
const { validate, validateParams } = require('../../middlewares/validate.middleware');
const asyncHandler = require('../../utils/async-handler');
const joinController = require('./join.controller');
const {
  gameCodeParamsSchema,
  joinSessionSchema,
  reconnectSchema,
} = require('./join.validation');

const router = express.Router();

// Public join endpoints are unauthenticated. Rate limiting the whole router
// slows down game-code enumeration and join spam.
router.use(
  createRateLimiter({
    name: 'join',
    windowMs: env.JOIN_RATE_LIMIT_WINDOW_MS,
    max: env.JOIN_RATE_LIMIT_MAX,
    message: 'Too many join attempts. Please try again later.',
  })
);

router.get(
  '/:code',
  validateParams(gameCodeParamsSchema),
  asyncHandler(joinController.getSession)
);

router.post(
  '/:code/reconnect',
  validateParams(gameCodeParamsSchema),
  validate(reconnectSchema),
  asyncHandler(joinController.reconnect)
);

router.post(
  '/:code',
  validateParams(gameCodeParamsSchema),
  validate(joinSessionSchema),
  asyncHandler(joinController.joinSession)
);

module.exports = router;
