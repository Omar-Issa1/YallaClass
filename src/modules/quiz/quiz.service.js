const Question = require('../../models/question.model');
const Quiz = require('../../models/quiz.model');
const AppError = require('../../utils/app-error');

const QUIZ_TITLE_MAX_LENGTH = 150;
const DUPLICATE_SUFFIX = ' (Copy)';

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function emptyStats() {
  return { questionCount: 0, estimatedDurationSec: 0 };
}

function statsFromQuestions(questions) {
  return {
    questionCount: questions.length,
    estimatedDurationSec: questions.reduce((total, question) => total + question.timeLimitSec, 0),
  };
}

async function getQuizStats(quizIds) {
  if (quizIds.length === 0) {
    return new Map();
  }

  const stats = await Question.aggregate([
    { $match: { quiz: { $in: quizIds } } },
    {
      $group: {
        _id: '$quiz',
        questionCount: { $sum: 1 },
        estimatedDurationSec: { $sum: '$timeLimitSec' },
      },
    },
  ]);

  return new Map(
    stats.map((item) => [
      item._id.toString(),
      {
        questionCount: item.questionCount,
        estimatedDurationSec: item.estimatedDurationSec,
      },
    ])
  );
}

async function getStatsForQuiz(quizId) {
  const stats = await getQuizStats([quizId]);

  return stats.get(quizId.toString()) || emptyStats();
}

function serializeQuiz(quiz, stats = emptyStats()) {
  return {
    id: quiz._id.toString(),
    title: quiz.title,
    description: quiz.description,
    organization: quiz.organization.toString(),
    createdBy: quiz.createdBy.toString(),
    status: quiz.status,
    archivedAt: quiz.archivedAt,
    questionCount: stats.questionCount,
    estimatedDurationSec: stats.estimatedDurationSec,
    createdAt: quiz.createdAt,
    updatedAt: quiz.updatedAt,
  };
}

function serializeQuestion(question) {
  return {
    id: question._id.toString(),
    quiz: question.quiz.toString(),
    text: question.text,
    points: question.points,
    timeLimitSec: question.timeLimitSec,
    order: question.order,
    options: question.options.map((option) => ({
      id: option._id.toString(),
      text: option.text,
      isCorrect: option.isCorrect,
    })),
    createdAt: question.createdAt,
    updatedAt: question.updatedAt,
  };
}

async function findQuiz(organizationId, quizId) {
  const quiz = await Quiz.findOne({ _id: quizId, organization: organizationId });

  if (!quiz) {
    throw new AppError('Quiz not found', 404);
  }

  return quiz;
}

function assertQuizEditable(quiz) {
  if (quiz.status === 'ARCHIVED') {
    throw new AppError('Archived quizzes cannot be modified. Unarchive it first.', 409);
  }
}

async function listQuizzes(organizationId, { search, status = 'ACTIVE' } = {}) {
  const filter = { organization: organizationId };

  if (status !== 'ALL') {
    filter.status = status;
  }

  if (search) {
    const searchPattern = new RegExp(escapeRegex(search), 'i');
    filter.$or = [{ title: searchPattern }, { description: searchPattern }];
  }

  const quizzes = await Quiz.find(filter).sort({ updatedAt: -1 });
  const statsByQuizId = await getQuizStats(quizzes.map((quiz) => quiz._id));

  return quizzes.map((quiz) =>
    serializeQuiz(quiz, statsByQuizId.get(quiz._id.toString()) || emptyStats())
  );
}

async function getQuiz(organizationId, quizId) {
  const quiz = await findQuiz(organizationId, quizId);
  const questions = await Question.find({ quiz: quiz._id }).sort({ order: 1, createdAt: 1 });

  return {
    ...serializeQuiz(quiz, statsFromQuestions(questions)),
    questions: questions.map(serializeQuestion),
  };
}

async function createQuiz(user, { title, description }) {
  const quiz = await Quiz.create({
    title,
    description,
    organization: user.organization,
    createdBy: user._id,
    status: 'ACTIVE',
  });

  return serializeQuiz(quiz);
}

async function updateQuiz(user, quizId, updates) {
  const quiz = await findQuiz(user.organization, quizId);

  assertQuizEditable(quiz);

  if (updates.title !== undefined) {
    quiz.title = updates.title;
  }

  if (updates.description !== undefined) {
    quiz.description = updates.description;
  }

  await quiz.save();

  return serializeQuiz(quiz, await getStatsForQuiz(quiz._id));
}

async function setArchived(user, quizId, archived) {
  const quiz = await findQuiz(user.organization, quizId);

  quiz.status = archived ? 'ARCHIVED' : 'ACTIVE';
  quiz.archivedAt = archived ? quiz.archivedAt || new Date() : null;

  await quiz.save();

  return serializeQuiz(quiz, await getStatsForQuiz(quiz._id));
}

async function duplicateQuiz(user, quizId) {
  const sourceQuiz = await findQuiz(user.organization, quizId);
  const sourceQuestions = await Question.find({ quiz: sourceQuiz._id }).sort({
    order: 1,
    createdAt: 1,
  });

  const maxBaseLength = QUIZ_TITLE_MAX_LENGTH - DUPLICATE_SUFFIX.length;
  const baseTitle =
    sourceQuiz.title.length > maxBaseLength
      ? sourceQuiz.title.slice(0, maxBaseLength).trim()
      : sourceQuiz.title;

  let copiedQuiz;

  try {
    copiedQuiz = await Quiz.create({
      title: `${baseTitle}${DUPLICATE_SUFFIX}`,
      description: sourceQuiz.description,
      organization: sourceQuiz.organization,
      createdBy: user._id,
      status: 'ACTIVE',
    });

    if (sourceQuestions.length > 0) {
      await Question.insertMany(
        sourceQuestions.map((question) => ({
          quiz: copiedQuiz._id,
          text: question.text,
          points: question.points,
          timeLimitSec: question.timeLimitSec,
          order: question.order,
          options: question.options.map((option) => ({
            text: option.text,
            isCorrect: option.isCorrect,
          })),
        }))
      );
    }
  } catch (error) {
    if (copiedQuiz) {
      await Question.deleteMany({ quiz: copiedQuiz._id }).catch(() => {});
      await Quiz.deleteOne({ _id: copiedQuiz._id }).catch(() => {});
    }

    throw error;
  }

  const copiedQuestions = await Question.find({ quiz: copiedQuiz._id }).sort({
    order: 1,
    createdAt: 1,
  });

  return {
    ...serializeQuiz(copiedQuiz, statsFromQuestions(copiedQuestions)),
    questions: copiedQuestions.map(serializeQuestion),
  };
}

async function deleteQuiz(user, quizId) {
  const quiz = await findQuiz(user.organization, quizId);

  await Question.deleteMany({ quiz: quiz._id });
  await quiz.deleteOne();

  return quiz._id.toString();
}

async function listQuestions(user, quizId) {
  const quiz = await findQuiz(user.organization, quizId);
  const questions = await Question.find({ quiz: quiz._id }).sort({ order: 1, createdAt: 1 });

  return questions.map(serializeQuestion);
}

async function findQuestion(quiz, questionId) {
  const question = await Question.findOne({ _id: questionId, quiz: quiz._id });

  if (!question) {
    throw new AppError('Question not found', 404);
  }

  return question;
}

async function getQuestion(user, quizId, questionId) {
  const quiz = await findQuiz(user.organization, quizId);
  const question = await findQuestion(quiz, questionId);

  return serializeQuestion(question);
}

async function createQuestion(user, quizId, data) {
  const quiz = await findQuiz(user.organization, quizId);

  assertQuizEditable(quiz);

  let order = data.order;

  if (order === undefined) {
    const lastQuestion = await Question.findOne({ quiz: quiz._id })
      .sort({ order: -1 })
      .select('order');

    order = lastQuestion ? lastQuestion.order + 1 : 0;
  }

  const question = await Question.create({
    quiz: quiz._id,
    text: data.text,
    points: data.points,
    timeLimitSec: data.timeLimitSec,
    order,
    options: data.options,
  });

  return serializeQuestion(question);
}

async function updateQuestion(user, quizId, questionId, updates) {
  const quiz = await findQuiz(user.organization, quizId);

  assertQuizEditable(quiz);

  const question = await findQuestion(quiz, questionId);

  if (updates.text !== undefined) {
    question.text = updates.text;
  }

  if (updates.options !== undefined) {
    question.options = updates.options;
  }

  if (updates.points !== undefined) {
    question.points = updates.points;
  }

  if (updates.timeLimitSec !== undefined) {
    question.timeLimitSec = updates.timeLimitSec;
  }

  if (updates.order !== undefined) {
    question.order = updates.order;
  }

  await question.save();

  return serializeQuestion(question);
}

async function deleteQuestion(user, quizId, questionId) {
  const quiz = await findQuiz(user.organization, quizId);

  assertQuizEditable(quiz);

  const question = await findQuestion(quiz, questionId);

  await question.deleteOne();

  return question._id.toString();
}

module.exports = {
  listQuizzes,
  getQuiz,
  createQuiz,
  updateQuiz,
  setArchived,
  duplicateQuiz,
  deleteQuiz,
  listQuestions,
  getQuestion,
  createQuestion,
  updateQuestion,
  deleteQuestion,
};
