const Question = require('../../models/question.model');
const Quiz = require('../../models/quiz.model');
const Session = require('../../models/session.model');
const SessionPlayer = require('../../models/session-player.model');
const AppError = require('../../utils/app-error');
const { generateJoinCode } = require('../../utils/session-code');
const {
  serializeSession,
  serializeParticipant,
  serializePublicSession,
} = require('../../utils/serializers');
const gameEngine = require('../game/game.engine');
const gameCommands = require('../game/game.commands');

const MAX_JOIN_CODE_ATTEMPTS = 10;

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function toId(value) {
  return value ? value.toString() : null;
}

function toPlainObject(value, fallback = {}) {
  if (!value) {
    return { ...fallback };
  }

  return value.toObject ? value.toObject() : { ...value };
}

async function recordTeacherAction(session, user, type, metadata = {}) {
  if (!session) {
    return;
  }

  await gameCommands.recordTeacherEvent(session, user, type, metadata);
}

async function getQuizSummaries(quizIds) {
  if (quizIds.length === 0) {
    return new Map();
  }

  const [quizzes, stats] = await Promise.all([
    Quiz.find({ _id: { $in: quizIds } }).select('title description'),
    Question.aggregate([
      { $match: { quiz: { $in: quizIds } } },
      {
        $group: {
          _id: '$quiz',
          questionCount: { $sum: 1 },
          estimatedDurationSec: { $sum: '$timeLimitSec' },
        },
      },
    ]),
  ]);

  const statsByQuizId = new Map(
    stats.map((item) => [
      item._id.toString(),
      {
        questionCount: item.questionCount,
        estimatedDurationSec: item.estimatedDurationSec,
      },
    ])
  );

  return new Map(
    quizzes.map((quiz) => [
      quiz._id.toString(),
      {
        quiz,
        questionCount: statsByQuizId.get(quiz._id.toString())?.questionCount || 0,
        estimatedDurationSec:
          statsByQuizId.get(quiz._id.toString())?.estimatedDurationSec || 0,
      },
    ])
  );
}

async function getParticipantCounts(sessionIds) {
  if (sessionIds.length === 0) {
    return new Map();
  }

  const counts = await SessionPlayer.aggregate([
    { $match: { session: { $in: sessionIds }, status: 'ACTIVE' } },
    { $group: { _id: '$session', count: { $sum: 1 } } },
  ]);

  return new Map(counts.map((item) => [item._id.toString(), item.count]));
}

async function findSession(organizationId, sessionId) {
  const session = await Session.findOne({
    _id: sessionId,
    organization: organizationId,
  });

  if (!session) {
    throw new AppError('Session not found', 404);
  }

  return session;
}

async function findSessionByCode(joinCode) {
  const session = await Session.findOne({ joinCode: joinCode.toUpperCase() });

  if (!session) {
    throw new AppError('Session not found', 404);
  }

  return session;
}

async function getSessionSummary(session) {
  const summaries = await getQuizSummaries([session.quiz]);
  const quizSummary = summaries.get(toId(session.quiz)) || {
    quiz: null,
    questionCount: 0,
    estimatedDurationSec: 0,
  };
  const participantCount = await SessionPlayer.countDocuments({
    session: session._id,
    status: 'ACTIVE',
  });

  return { ...quizSummary, participantCount };
}

async function createSession(user, { quiz: quizId }) {
  const quiz = await Quiz.findOne({ _id: quizId, organization: user.organization });

  if (!quiz) {
    throw new AppError('Quiz not found', 404);
  }

  if (quiz.status === 'ARCHIVED') {
    throw new AppError('Archived quizzes cannot be used to create a session', 409);
  }

  const questionCount = await Question.countDocuments({ quiz: quiz._id });

  if (questionCount === 0) {
    throw new AppError('Quiz must have at least one question before creating a session', 409);
  }

  let session = null;

  for (let attempt = 0; attempt < MAX_JOIN_CODE_ATTEMPTS; attempt += 1) {
    try {
      session = await Session.create({
        quiz: quiz._id,
        organization: user.organization,
        createdBy: user._id,
        joinCode: generateJoinCode(),
        status: 'LOBBY',
        joinOpen: true,
      });
      break;
    } catch (error) {
      const isJoinCodeCollision =
        error.code === 11000 && (error.keyPattern?.joinCode || error.keyValue?.joinCode);

      if (!isJoinCodeCollision) {
        throw error;
      }
    }
  }

  if (!session) {
    throw new AppError('Could not generate a unique game code. Please try again.', 500);
  }

  const summary = await getSessionSummary(session);

  return serializeSession(session, summary);
}

async function listSessions(organizationId, { status, quiz, search } = {}) {
  const filter = { organization: organizationId };

  if (status) {
    filter.status = status;
  }

  if (quiz) {
    filter.quiz = quiz;
  }

  if (search) {
    const searchPattern = new RegExp(escapeRegex(search), 'i');
    const matchingQuizzes = await Quiz.find({
      organization: organizationId,
      title: searchPattern,
    }).select('_id');

    if (matchingQuizzes.length === 0) {
      return [];
    }

    filter.quiz = { $in: matchingQuizzes.map((item) => item._id) };
  }

  const sessions = await Session.find(filter).sort({ createdAt: -1 });
  const quizSummaries = await getQuizSummaries(sessions.map((session) => session.quiz));
  const participantCounts = await getParticipantCounts(sessions.map((session) => session._id));

  return sessions.map((session) =>
    serializeSession(session, {
      ...(quizSummaries.get(toId(session.quiz)) || {}),
      participantCount: participantCounts.get(toId(session._id)) || 0,
    })
  );
}

async function getSession(organizationId, sessionId) {
  const session = await findSession(organizationId, sessionId);
  const summary = await getSessionSummary(session);

  return serializeSession(session, summary);
}

async function getLobby(organizationId, sessionId) {
  const session = await findSession(organizationId, sessionId);
  const summary = await getSessionSummary(session);
  const participants = await SessionPlayer.find({
    session: session._id,
    organization: organizationId,
    status: 'ACTIVE',
  }).sort({ joinedAt: 1 });

  return {
    ...serializeSession(session, summary),
    participants: participants.map((participant) => serializeParticipant(participant)),
  };
}

async function setJoinOpen(user, sessionId, { joinOpen }) {
  const session = await findSession(user.organization, sessionId);

  if (session.status === 'FINISHED') {
    throw new AppError('Finished sessions cannot be reopened', 409);
  }

  session.joinOpen = joinOpen;
  await session.save();

  gameEngine.notifyJoinLockChanged(session);
  await recordTeacherAction(session, user, 'TEACHER_JOIN_LOCK', { joinOpen });

  const summary = await getSessionSummary(session);

  return serializeSession(session, summary);
}

async function startSession(user, sessionId) {
  const session = await findSession(user.organization, sessionId);

  if (session.status !== 'LOBBY') {
    throw new AppError('Only sessions in the lobby can be started', 409);
  }

  const questionCount = await Question.countDocuments({ quiz: session.quiz });

  if (questionCount === 0) {
    throw new AppError('Quiz must have at least one question before starting', 409);
  }

  session.status = 'LIVE';
  session.startedAt = session.startedAt || new Date();
  session.joinOpen = false;
  await session.save();

  const gameSession = await gameEngine.startGame(session);
  await recordTeacherAction(gameSession, user, 'TEACHER_START', {
    gameState: gameSession.gameState,
  });
  const summary = await getSessionSummary(gameSession);

  return serializeSession(gameSession, summary);
}

async function pauseSession(user, sessionId) {
  const session = await findSession(user.organization, sessionId);

  if (session.status !== 'LIVE') {
    throw new AppError('Only live sessions can be paused', 409);
  }

  const paused = await gameEngine.pauseGame(session);
  await recordTeacherAction(paused, user, 'TEACHER_PAUSE', {
    gameState: paused.gameState,
    remainingTimeMs: paused.remainingTimeMs,
  });
  const summary = await getSessionSummary(paused);

  return serializeSession(paused, summary);
}

async function resumeSession(user, sessionId) {
  const session = await findSession(user.organization, sessionId);

  if (session.status !== 'PAUSED') {
    throw new AppError('Only paused sessions can be resumed', 409);
  }

  const resumed = await gameEngine.resumeGame(session);
  await recordTeacherAction(resumed, user, 'TEACHER_RESUME', {
    gameState: resumed.gameState,
    phaseEndsAt: resumed.phaseEndsAt,
  });
  const summary = await getSessionSummary(resumed);

  return serializeSession(resumed, summary);
}

async function finishSession(user, sessionId) {
  const session = await findSession(user.organization, sessionId);

  if (session.status === 'FINISHED') {
    throw new AppError('Session is already finished', 409);
  }

  const finished = await gameEngine.finishGame(session);
  await recordTeacherAction(finished, user, 'TEACHER_FINISH', {
    totalQuestions: finished.gameQuestions?.length || 0,
  });
  const summary = await getSessionSummary(finished);

  return serializeSession(finished, summary);
}

async function kickParticipant(user, sessionId, participantId) {
  const session = await findSession(user.organization, sessionId);
  const participant = await SessionPlayer.findOne({
    _id: participantId,
    session: session._id,
    organization: user.organization,
  });

  if (!participant) {
    throw new AppError('Participant not found', 404);
  }

  if (participant.status === 'KICKED') {
    throw new AppError('Participant has already been removed', 409);
  }

  participant.status = 'KICKED';
  participant.connected = false;
  participant.kickedAt = new Date();
  await participant.save();

  gameEngine.notifyPlayerKicked(session, participant);
  await recordTeacherAction(session, user, 'TEACHER_KICK', {
    participantId: participant._id.toString(),
    nickname: participant.nickname,
  });

  return participant._id.toString();
}

async function revealSession(user, sessionId) {
  const session = await findSession(user.organization, sessionId);
  const updated = await gameEngine.revealQuestion(session);

  await recordTeacherAction(updated || session, user, 'TEACHER_REVEAL', {
    questionIndex: updated?.currentQuestionIndex ?? session.currentQuestionIndex,
  });

  const summary = await getSessionSummary(updated);
  return serializeSession(updated, summary);
}

async function nextSession(user, sessionId) {
  const session = await findSession(user.organization, sessionId);
  const fromState = session.gameState;
  const updated = await gameEngine.nextPhase(session);

  await recordTeacherAction(updated || session, user, 'TEACHER_NEXT', {
    fromState,
    toState: updated?.gameState || null,
    questionIndex:
      updated?.currentQuestionIndex ?? session.currentQuestionIndex,
  });

  const summary = await getSessionSummary(updated);
  return serializeSession(updated, summary);
}

async function skipSession(user, sessionId) {
  const session = await findSession(user.organization, sessionId);
  const skippedQuestionIndex = session.currentQuestionIndex;
  const fromState = session.gameState;
  const updated = await gameEngine.skipQuestion(session);

  await recordTeacherAction(updated || session, user, 'TEACHER_SKIP', {
    fromState,
    skippedQuestionIndex,
    questionIndex:
      updated?.currentQuestionIndex ?? session.currentQuestionIndex,
  });

  const summary = await getSessionSummary(updated);
  return serializeSession(updated, summary);
}

async function updateCommandSettings(user, sessionId, settings) {
  const session = await findSession(user.organization, sessionId);
  const updated = await gameEngine.updateCommandSettings(session, settings);

  await recordTeacherAction(updated, user, 'TEACHER_COMMAND_SETTINGS', {
    changes: settings,
    commandSettings: toPlainObject(updated.commandSettings),
  });

  const summary = await getSessionSummary(updated);
  return serializeSession(updated, summary);
}

async function updatePhaseSettings(user, sessionId, settings) {
  const session = await findSession(user.organization, sessionId);
  const updated = await gameEngine.updatePhaseSettings(session, settings);

  await recordTeacherAction(updated, user, 'TEACHER_PHASE_SETTINGS', {
    changes: settings,
    phaseSettings: toPlainObject(updated.phaseSettings),
  });

  const summary = await getSessionSummary(updated);
  return serializeSession(updated, summary);
}

async function getPublicSession(joinCode) {
  const session = await findSessionByCode(joinCode);
  const summary = await getSessionSummary(session);

  return serializePublicSession(session, summary);
}

module.exports = {
  findSession,
  findSessionByCode,
  getSessionSummary,
  createSession,
  listSessions,
  getSession,
  getLobby,
  setJoinOpen,
  startSession,
  pauseSession,
  resumeSession,
  finishSession,
  kickParticipant,
  revealSession,
  nextSession,
  skipSession,
  updateCommandSettings,
  updatePhaseSettings,
  getPublicSession,
};
