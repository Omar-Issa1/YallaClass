const express = require('express');

const authenticate = require('../../middlewares/auth.middleware');
const { authorizeRoles, requireOrganization } = require('../../middlewares/role.middleware');
const {
  validate,
  validateQuery,
  validateObjectId,
} = require('../../middlewares/validate.middleware');
const asyncHandler = require('../../utils/async-handler');
const quizController = require('./quiz.controller');
const {
  createQuizSchema,
  updateQuizSchema,
  listQuizzesQuerySchema,
} = require('./quiz.validation');
const {
  createQuestionSchema,
  updateQuestionSchema,
} = require('./question.validation');

const router = express.Router();

const READ_ROLES = ['OWNER', 'TEACHER', 'ASSISTANT'];
const WRITE_ROLES = ['OWNER', 'TEACHER'];

router.use(authenticate, requireOrganization);

router.get(
  '/',
  authorizeRoles(...READ_ROLES),
  validateQuery(listQuizzesQuerySchema),
  asyncHandler(quizController.listQuizzes)
);

router.post(
  '/',
  authorizeRoles(...WRITE_ROLES),
  validate(createQuizSchema),
  asyncHandler(quizController.createQuiz)
);

router.get(
  '/:id/questions',
  authorizeRoles(...READ_ROLES),
  validateObjectId(),
  asyncHandler(quizController.listQuestions)
);

router.post(
  '/:id/questions',
  authorizeRoles(...WRITE_ROLES),
  validateObjectId(),
  validate(createQuestionSchema),
  asyncHandler(quizController.createQuestion)
);

router.get(
  '/:id/questions/:questionId',
  authorizeRoles(...READ_ROLES),
  validateObjectId(),
  validateObjectId('questionId'),
  asyncHandler(quizController.getQuestion)
);

router.patch(
  '/:id/questions/:questionId',
  authorizeRoles(...WRITE_ROLES),
  validateObjectId(),
  validateObjectId('questionId'),
  validate(updateQuestionSchema),
  asyncHandler(quizController.updateQuestion)
);

router.delete(
  '/:id/questions/:questionId',
  authorizeRoles(...WRITE_ROLES),
  validateObjectId(),
  validateObjectId('questionId'),
  asyncHandler(quizController.deleteQuestion)
);

router.patch(
  '/:id/archive',
  authorizeRoles(...WRITE_ROLES),
  validateObjectId(),
  asyncHandler(quizController.archiveQuiz)
);

router.patch(
  '/:id/unarchive',
  authorizeRoles(...WRITE_ROLES),
  validateObjectId(),
  asyncHandler(quizController.unarchiveQuiz)
);

router.post(
  '/:id/duplicate',
  authorizeRoles(...WRITE_ROLES),
  validateObjectId(),
  asyncHandler(quizController.duplicateQuiz)
);

router.get(
  '/:id',
  authorizeRoles(...READ_ROLES),
  validateObjectId(),
  asyncHandler(quizController.getQuiz)
);

router.patch(
  '/:id',
  authorizeRoles(...WRITE_ROLES),
  validateObjectId(),
  validate(updateQuizSchema),
  asyncHandler(quizController.updateQuiz)
);

router.delete(
  '/:id',
  authorizeRoles(...WRITE_ROLES),
  validateObjectId(),
  asyncHandler(quizController.deleteQuiz)
);

module.exports = router;
