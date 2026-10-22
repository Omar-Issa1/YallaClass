const env = require('../config/env');

function normalizeError(err) {
  if (err.type === 'entity.parse.failed') {
    return { statusCode: 400, message: 'Invalid JSON body' };
  }

  if (err.name === 'ValidationError' && err.errors) {
    return {
      statusCode: 400,
      message: 'Validation failed',
      errors: Object.values(err.errors).map((item) => ({
        field: item.path,
        message: item.message,
      })),
    };
  }

  if (err.name === 'CastError') {
    return {
      statusCode: 400,
      message: `Invalid value for ${err.path}`,
    };
  }

  if (err.code === 11000) {
    const field = Object.keys(err.keyValue || {})[0] || 'field';
    return {
      statusCode: 409,
      message: `${field} is already in use`,
    };
  }

  if (err.name === 'TokenExpiredError') {
    return { statusCode: 401, message: 'Token expired' };
  }

  if (err.name === 'JsonWebTokenError') {
    return { statusCode: 401, message: 'Invalid token' };
  }

  return {
    statusCode: err.statusCode || 500,
    message: err.message,
    errors: err.errors,
  };
}

function errorHandler(err, req, res, next) {
  const normalized = normalizeError(err);
  const statusCode = normalized.statusCode;
  const isServerError = statusCode >= 500;

  if (isServerError) {
    console.error(err);
  }

  const message =
    isServerError && env.NODE_ENV === 'production' ? 'Internal server error' : normalized.message;

  const body = { success: false, message };

  if (normalized.errors && normalized.errors.length > 0) {
    body.errors = normalized.errors;
  }

  if (env.NODE_ENV === 'development' && err.stack) {
    body.stack = err.stack;
  }

  res.status(statusCode).json(body);
}

module.exports = errorHandler;
