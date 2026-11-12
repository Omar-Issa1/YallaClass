const express = require('express');

const authenticate = require('../../middlewares/auth.middleware');
const { authorizeRoles, requireOrganization } = require('../../middlewares/role.middleware');
const {
  validate,
  validateQuery,
  validateObjectId,
} = require('../../middlewares/validate.middleware');
const asyncHandler = require('../../utils/async-handler');
const sectionController = require('./section.controller');
const {
  createSectionSchema,
  updateSectionSchema,
  listSectionsQuerySchema,
} = require('./section.validation');

const router = express.Router();

const READ_ROLES = ['OWNER', 'TEACHER', 'ASSISTANT'];
const WRITE_ROLES = ['OWNER', 'TEACHER'];

router.use(authenticate, requireOrganization);

router.get(
  '/',
  authorizeRoles(...READ_ROLES),
  validateQuery(listSectionsQuerySchema),
  asyncHandler(sectionController.listSections)
);

router.post(
  '/',
  authorizeRoles(...WRITE_ROLES),
  validate(createSectionSchema),
  asyncHandler(sectionController.createSection)
);

router.get(
  '/:id',
  authorizeRoles(...READ_ROLES),
  validateObjectId(),
  asyncHandler(sectionController.getSection)
);

router.patch(
  '/:id',
  authorizeRoles(...WRITE_ROLES),
  validateObjectId(),
  validate(updateSectionSchema),
  asyncHandler(sectionController.updateSection)
);

router.delete(
  '/:id',
  authorizeRoles(...WRITE_ROLES),
  validateObjectId(),
  asyncHandler(sectionController.deleteSection)
);

module.exports = router;
