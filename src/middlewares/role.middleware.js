const AppError = require('../utils/app-error');

function authorizeRoles(...roles) {
  return function roleGuard(req, res, next) {
    if (!req.user) {
      return next(new AppError('Authentication required', 401));
    }

    if (!roles.includes(req.user.role)) {
      return next(new AppError('You do not have permission to perform this action', 403));
    }

    return next();
  };
}

function requireOrganization(req, res, next) {
  if (!req.user.organization) {
    return next(new AppError('User is not assigned to an organization', 403));
  }

  req.organizationId = req.user.organization;
  return next();
}

module.exports = { authorizeRoles, requireOrganization };
