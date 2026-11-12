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
  sessionAttendanceQuerySchema,
} = require('../attendance/attendance.validation');
const sessionController = require('./session.controller');
const {
  createSessionSchema,
  listSessionsQuerySchema,
  setJoinOpenSchema,
  commandSettingsSchema,
  phaseSettingsSchema,
} = require('./session.validation');

const router = express.Router();

const READ_ROLES = ['OWNER', 'TEACHER', 'ASSISTANT'];
const WRITE_ROLES = ['OWNER', 'TEACHER'];

router.use(authenticate, requireOrganization);

router.get(
  '/',
  authorizeRoles(...READ_ROLES),
  validateQuery(listSessionsQuerySchema),
  asyncHandler(sessionController.listSessions)
);

router.post(
  '/',
  authorizeRoles(...WRITE_ROLES),
  validate(createSessionSchema),
  asyncHandler(sessionController.createSession)
);

router.get(
  '/:id/lobby',
  authorizeRoles(...READ_ROLES),
  validateObjectId(),
  asyncHandler(sessionController.getLobby)
);

router.patch(
  '/:id/join-lock',
  authorizeRoles(...WRITE_ROLES),
  validateObjectId(),
  validate(setJoinOpenSchema),
  asyncHandler(sessionController.setJoinOpen)
);

router.post(
  '/:id/start',
  authorizeRoles(...WRITE_ROLES),
  validateObjectId(),
  asyncHandler(sessionController.startSession)
);

router.post(
  '/:id/pause',
  authorizeRoles(...WRITE_ROLES),
  validateObjectId(),
  asyncHandler(sessionController.pauseSession)
);

router.post(
  '/:id/resume',
  authorizeRoles(...WRITE_ROLES),
  validateObjectId(),
  asyncHandler(sessionController.resumeSession)
);

router.post(
  '/:id/finish',
  authorizeRoles(...WRITE_ROLES),
  validateObjectId(),
  asyncHandler(sessionController.finishSession)
);

router.delete(
  '/:id/participants/:participantId',
  authorizeRoles(...WRITE_ROLES),
  validateObjectId(),
  validateObjectId('participantId'),
  asyncHandler(sessionController.kickParticipant)
);

router.post(
  '/:id/reveal',
  authorizeRoles(...WRITE_ROLES),
  validateObjectId(),
  asyncHandler(sessionController.revealSession)
);

router.post(
  '/:id/next',
  authorizeRoles(...WRITE_ROLES),
  validateObjectId(),
  asyncHandler(sessionController.nextSession)
);

router.post(
  '/:id/skip',
  authorizeRoles(...WRITE_ROLES),
  validateObjectId(),
  asyncHandler(sessionController.skipSession)
);

router.patch(
  '/:id/command-settings',
  authorizeRoles(...WRITE_ROLES),
  validateObjectId(),
  validate(commandSettingsSchema),
  asyncHandler(sessionController.updateCommandSettings)
);

router.patch(
  '/:id/phase-settings',
  authorizeRoles(...WRITE_ROLES),
  validateObjectId(),
  validate(phaseSettingsSchema),
  asyncHandler(sessionController.updatePhaseSettings)
);

router.get(
  '/:id/attendance',
  authorizeRoles(...READ_ROLES),
  validateObjectId(),
  validateQuery(sessionAttendanceQuerySchema),
  asyncHandler(attendanceController.getSessionAttendance)
);

router.get(
  '/:id/report/export',
  authorizeRoles(...READ_ROLES),
  validateObjectId(),
  asyncHandler(attendanceController.exportSessionReport)
);

router.get(
  '/:id/report',
  authorizeRoles(...READ_ROLES),
  validateObjectId(),
  asyncHandler(attendanceController.getSessionReport)
);

router.get(
  '/:id',
  authorizeRoles(...READ_ROLES),
  validateObjectId(),
  asyncHandler(sessionController.getSession)
);

module.exports = router;
