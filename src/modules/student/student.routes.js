const express = require('express');

const authenticate = require('../../middlewares/auth.middleware');
const { authorizeRoles, requireOrganization } = require('../../middlewares/role.middleware');
const {
  validate,
  validateQuery,
  validateObjectId,
} = require('../../middlewares/validate.middleware');
const asyncHandler = require('../../utils/async-handler');
const attendanceController = require('../attendance/attendance.controller');
const {
  studentHistoryQuerySchema,
} = require('../attendance/attendance.validation');
const studentController = require('./student.controller');
const {
  createStudentSchema,
  importStudentsSchema,
  updateStudentSchema,
  updateAvatarSchema,
  listStudentsQuerySchema,
} = require('./student.validation');

const router = express.Router();

const READ_ROLES = ['OWNER', 'TEACHER', 'ASSISTANT'];
const WRITE_ROLES = ['OWNER', 'TEACHER'];

router.use(authenticate, requireOrganization);

router.get(
  '/',
  authorizeRoles(...READ_ROLES),
  validateQuery(listStudentsQuerySchema),
  asyncHandler(studentController.listStudents)
);

router.post(
  '/',
  authorizeRoles(...WRITE_ROLES),
  validate(createStudentSchema),
  asyncHandler(studentController.createStudent)
);

router.post(
  '/import',
  authorizeRoles(...WRITE_ROLES),
  validate(importStudentsSchema),
  asyncHandler(studentController.importStudents)
);

router.patch(
  '/:id/avatar',
  authorizeRoles(...WRITE_ROLES),
  validateObjectId(),
  validate(updateAvatarSchema),
  asyncHandler(studentController.updateStudentAvatar)
);

router.get(
  '/:id/history',
  authorizeRoles(...READ_ROLES),
  validateObjectId(),
  validateQuery(studentHistoryQuerySchema),
  asyncHandler(attendanceController.getStudentHistory)
);

router.get(
  '/:id',
  authorizeRoles(...READ_ROLES),
  validateObjectId(),
  asyncHandler(studentController.getStudent)
);

router.patch(
  '/:id',
  authorizeRoles(...WRITE_ROLES),
  validateObjectId(),
  validate(updateStudentSchema),
  asyncHandler(studentController.updateStudent)
);

router.delete(
  '/:id',
  authorizeRoles(...WRITE_ROLES),
  validateObjectId(),
  asyncHandler(studentController.deleteStudent)
);

module.exports = router;
