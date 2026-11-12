const AppError = require('../../utils/app-error');
const { GAME_ERRORS } = require('./game.constants');

function gameError(code, message, statusCode = 409) {
  const error = new AppError(message, statusCode);
  error.code = code;
  return error;
}

function normalizeSocketError(error) {
  if (error && error.code && error.statusCode) {
    return { code: error.code, message: error.message };
  }

  if (error && error.name === 'ValidationError') {
    return { code: GAME_ERRORS.INVALID_PAYLOAD, message: 'Invalid payload' };
  }

  if (error && error.code === 11000) {
    return { code: GAME_ERRORS.ALREADY_ANSWERED, message: 'You have already answered this question' };
  }

  return {
    code: error?.code || 'GAME_ERROR',
    message: error?.message || 'Unexpected game error',
  };
}

module.exports = {
  gameError,
  normalizeSocketError,
};
