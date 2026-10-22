const express = require('express');

const authenticate = require('../../middlewares/auth.middleware');
const { authorizeRoles } = require('../../middlewares/role.middleware');
const { validate, validateObjectId } = require('../../middlewares/validate.middleware');
const asyncHandler = require('../../utils/async-handler');
const adminController = require('./admin.controller');
const { updateUserStatusSchema } = require('./admin.validation');

const router = express.Router();

router.use(authenticate, authorizeRoles('ADMIN'));

router.get('/users', asyncHandler(adminController.listUsers));
router.get('/users/:id', validateObjectId(), asyncHandler(adminController.getUser));

router.patch(
  '/users/:id/status',
  validateObjectId(),
  validate(updateUserStatusSchema),
  asyncHandler(adminController.updateUserStatus)
);

router.get('/organizations', asyncHandler(adminController.listOrganizations));
router.get(
  '/organizations/:id',
  validateObjectId(),
  asyncHandler(adminController.getOrganization)
);

module.exports = router;
