const express = require('express');

const authenticate = require('../../middlewares/auth.middleware');
const { authorizeRoles, requireOrganization } = require('../../middlewares/role.middleware');
const { validate, validateObjectId } = require('../../middlewares/validate.middleware');
const asyncHandler = require('../../utils/async-handler');
const organizationController = require('./organization.controller');
const {
  addMemberSchema,
  updateMemberSchema,
  updateOrganizationSchema,
} = require('./organization.validation');

const router = express.Router();

router.use(authenticate, requireOrganization);

router.get(
  '/',
  authorizeRoles('OWNER', 'TEACHER', 'ASSISTANT'),
  asyncHandler(organizationController.getOrganization)
);

router.patch(
  '/',
  authorizeRoles('OWNER'),
  validate(updateOrganizationSchema),
  asyncHandler(organizationController.updateOrganization)
);

router.get(
  '/members',
  authorizeRoles('OWNER', 'TEACHER', 'ASSISTANT'),
  asyncHandler(organizationController.listMembers)
);

router.post(
  '/members',
  authorizeRoles('OWNER'),
  validate(addMemberSchema),
  asyncHandler(organizationController.addMember)
);

router.patch(
  '/members/:id',
  authorizeRoles('OWNER'),
  validateObjectId(),
  validate(updateMemberSchema),
  asyncHandler(organizationController.updateMember)
);

router.delete(
  '/members/:id',
  authorizeRoles('OWNER'),
  validateObjectId(),
  asyncHandler(organizationController.removeMember)
);

module.exports = router;
