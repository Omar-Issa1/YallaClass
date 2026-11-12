const { sendSuccess } = require('../../utils/api-response');
const quizService = require('./quiz.service');

async function listQuizzes(req, res) {
  const quizzes = await quizService.listQuizzes(req.organizationId, req.validatedQuery);

  return sendSuccess(res, {
    message: 'Quizzes retrieved successfully',
    data: { quizzes },
  });
}

async function getQuiz(req, res) {
  const quiz = await quizService.getQuiz(req.organizationId, req.params.id);

  return sendSuccess(res, {
    message: 'Quiz retrieved successfully',
    data: { quiz },
  });
}

async function createQuiz(req, res) {
  const quiz = await quizService.createQuiz(req.user, req.body);

  return sendSuccess(res, {
    statusCode: 201,
    message: 'Quiz created successfully',
    data: { quiz },
  });
}

async function updateQuiz(req, res) {
  const quiz = await quizService.updateQuiz(req.user, req.params.id, req.body);

  return sendSuccess(res, {
    message: 'Quiz updated successfully',
    data: { quiz },
  });
}

async function archiveQuiz(req, res) {
  const quiz = await quizService.setArchived(req.user, req.params.id, true);

  return sendSuccess(res, {
    message: 'Quiz archived successfully',
    data: { quiz },
  });
}

async function unarchiveQuiz(req, res) {
  const quiz = await quizService.setArchived(req.user, req.params.id, false);

  return sendSuccess(res, {
    message: 'Quiz unarchived successfully',
    data: { quiz },
  });
}

async function duplicateQuiz(req, res) {
  const quiz = await quizService.duplicateQuiz(req.user, req.params.id);

  return sendSuccess(res, {
    statusCode: 201,
    message: 'Quiz duplicated successfully',
    data: { quiz },
  });
}

async function deleteQuiz(req, res) {
  const id = await quizService.deleteQuiz(req.user, req.params.id);

  return sendSuccess(res, {
    message: 'Quiz deleted successfully',
    data: { id },
  });
}

async function listQuestions(req, res) {
  const questions = await quizService.listQuestions(req.user, req.params.id);

  return sendSuccess(res, {
    message: 'Questions retrieved successfully',
    data: { questions },
  });
}

async function getQuestion(req, res) {
  const question = await quizService.getQuestion(
    req.user,
    req.params.id,
    req.params.questionId
  );

  return sendSuccess(res, {
    message: 'Question retrieved successfully',
    data: { question },
  });
}

async function createQuestion(req, res) {
  const question = await quizService.createQuestion(req.user, req.params.id, req.body);

  return sendSuccess(res, {
    statusCode: 201,
    message: 'Question created successfully',
    data: { question },
  });
}

async function updateQuestion(req, res) {
  const question = await quizService.updateQuestion(
    req.user,
    req.params.id,
    req.params.questionId,
    req.body
  );

  return sendSuccess(res, {
    message: 'Question updated successfully',
    data: { question },
  });
}

async function deleteQuestion(req, res) {
  const id = await quizService.deleteQuestion(
    req.user,
    req.params.id,
    req.params.questionId
  );

  return sendSuccess(res, {
    message: 'Question deleted successfully',
    data: { id },
  });
}

module.exports = {
  listQuizzes,
  getQuiz,
  createQuiz,
  updateQuiz,
  archiveQuiz,
  unarchiveQuiz,
  duplicateQuiz,
  deleteQuiz,
  listQuestions,
  getQuestion,
  createQuestion,
  updateQuestion,
  deleteQuestion,
};
