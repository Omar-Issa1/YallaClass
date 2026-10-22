const mongoose = require('mongoose');

const AppError = require('../utils/app-error');

function validate(schema) {
  return function validateBody(req, res, next) {
    const result = schema.safeParse(req.body);

    if (!result.success) {
      const errors = result.error.issues.map((issue) => ({
        field: issue.path.join('.'),
        message: issue.message,
      }));

      return next(new AppError('Validation failed', 400, errors));
    }

    req.body = result.data;
    return next();
  };
}

function validateObjectId(param = 'id') {
  return function validateParam(req, res, next) {
    if (!mongoose.isValidObjectId(req.params[param])) {
      return next(new AppError(`Invalid ${param}`, 400));
    }

    return next();
  };
}

module.exports = { validate, validateObjectId };
