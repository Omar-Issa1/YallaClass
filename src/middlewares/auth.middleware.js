const mongoose = require('mongoose');

const User = require('../models/user.model');
const AppError = require('../utils/app-error');
const { verifyAccessToken } = require('../utils/token');

async function authenticate(req, res, next) {
  const header = req.headers.authorization || '';

  if (!header.startsWith('Bearer ')) {
    return next(new AppError('Authentication required', 401));
  }

  const token = header.slice('Bearer '.length).trim();

  if (!token) {
    return next(new AppError('Authentication required', 401));
  }

  let payload;

  try {
    payload = verifyAccessToken(token);
  } catch (error) {
    const message = error.name === 'TokenExpiredError' ? 'Token expired' : 'Invalid token';
    return next(new AppError(message, 401));
  }

  if (!payload.sub || !mongoose.isValidObjectId(payload.sub)) {
    return next(new AppError('Invalid token', 401));
  }

  const user = await User.findById(payload.sub);

  if (!user) {
    return next(new AppError('User no longer exists', 401));
  }

  if (user.status === 'SUSPENDED') {
    return next(new AppError('Your account has been suspended', 403));
  }

  req.user = user;
  return next();
}

module.exports = authenticate;
