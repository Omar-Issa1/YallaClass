const express = require('express');

const authenticate = require('../../middlewares/auth.middleware');
const { validate } = require('../../middlewares/validate.middleware');
const asyncHandler = require('../../utils/async-handler');
const authController = require('./auth.controller');
const { loginSchema, registerSchema } = require('./auth.validation');

const router = express.Router();

router.post('/register', validate(registerSchema), asyncHandler(authController.register));
router.post('/login', validate(loginSchema), asyncHandler(authController.login));
router.post('/logout', authController.logout);
router.get('/me', authenticate, asyncHandler(authController.me));

module.exports = router;
