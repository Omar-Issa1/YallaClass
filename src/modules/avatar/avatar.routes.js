const express = require('express');

const authenticate = require('../../middlewares/auth.middleware');
const { authorizeRoles, requireOrganization } = require('../../middlewares/role.middleware');
const asyncHandler = require('../../utils/async-handler');
const avatarController = require('./avatar.controller');

const router = express.Router();

router.use(authenticate, requireOrganization);

router.get(
  '/options',
  authorizeRoles('OWNER', 'TEACHER', 'ASSISTANT'),
  asyncHandler(avatarController.getAvatarOptions)
);

module.exports = router;
