const mongoose = require('mongoose');

const Answer = require('../../models/answer.model');
const Question = require('../../models/question.model');
const Session = require('../../models/session.model');
const SessionPlayer = require('../../models/session-player.model');
const { serializeParticipant } = require('../../utils/serializers');
const {
  PHASE_DURATIONS,
  GAME_ERRORS,
  DEFAULT_PHASE_SETTINGS,
} = require('./game.constants');
const { gameError } = require('./game.errors');
const { playerRoom, sessionRoom, teacherRoom } = require('./game.rooms');
const {
  serializeGameQuestion,
  serializeLeaderboardEntry,
} = require('./game.serializers');
const gameCommands = require('./game.commands');
const attendanceService = require('../attendance/attendance.service');

const timers = new Map();
let io = null;

function init(socketServer) {
  io = socketServer;
  gameCommands.init(socketServer, {
    advanceAfterCommands,
    finishGame,
  });
}

function toId(value) {
  if (!value) {
    return null;
  }

  return value._id ? value._id.toString() : value.toString();
}

function toObjectId(value) {
  return value instanceof mongoose.Types.ObjectId
    ? value
    : new mongoose.Types.ObjectId(value);
}

function plainObject(value, fallback = {}) {
  if (!value) {
    return { ...fallback };
  }

  return value.toObject ? value.toObject() : { ...value };
}

function emit(room, event, payload) {
  if (io) {
    io.to(room).emit(event, payload);
  }
}

function clearTimer(sessionId) {
  const key = sessionId.toString();
  const timer = timers.get(key);

  if (timer) {
    clearTimeout(timer);
    timers.delete(key);
  }
}

function schedulePhase(sessionId, delayMs, handler) {
  clearTimer(sessionId);

  const key = sessionId.toString();
  const timer = setTimeout(
    () => {
      timers.delete(key);
      Promise.resolve()
        .then(handler)
        .catch((error) => {
          console.error(`[game] phase transition failed for session ${key}:`, error);
        });
    },
    Math.max(0, delayMs)
  );

  if (typeof timer.unref === 'function') {
    timer.unref();
  }

  timers.set(key, timer);
}

function phaseDelay(session) {
  if (!session.phaseEndsAt) {
    return 0;
  }

  return Math.max(0, new Date(session.phaseEndsAt).getTime() - Date.now());
}

function phaseMs(session, key, fallback) {
  const value = session.phaseSettings?.[key];

  return Number.isFinite(value) ? value : fallback;
}

function phaseVisible(session, key) {
  return session.phaseSettings?.[key] !== false;
}

function phaseKeyForState(gameState) {
  switch (gameState) {
    case 'REVEAL':
      return 'revealMs';
    case 'EXPLANATION':
      return 'explanationMs';
    case 'POINTS':
      return 'pointsMs';
    case 'LEADERBOARD':
      return 'leaderboardMs';
    case 'PHONE_LEADERBOARD':
      return 'phoneLeaderboardMs';
    default:
      return null;
  }
}

function scheduleCurrentPhase(session) {
  const sessionId = session._id.toString();
  const nextIndex = session.currentQuestionIndex + 1;

  switch (session.gameState) {
    case 'COUNTDOWN':
      schedulePhase(sessionId, phaseDelay(session), () => startQuestion(sessionId, 0));
      break;
    case 'QUESTION':
      schedulePhase(sessionId, phaseDelay(session), () => endQuestion(sessionId));
      break;
    case 'REVEAL':
      schedulePhase(sessionId, phaseDelay(session), () => showExplanation(sessionId));
      break;
    case 'EXPLANATION':
      schedulePhase(sessionId, phaseDelay(session), () => showPoints(sessionId));
      break;
    case 'POINTS':
      schedulePhase(sessionId, phaseDelay(session), () => showLeaderboard(sessionId));
      break;
    case 'LEADERBOARD':
      schedulePhase(sessionId, phaseDelay(session), () => showPhoneLeaderboard(sessionId));
      break;
    case 'PHONE_LEADERBOARD':
      schedulePhase(sessionId, phaseDelay(session), () => beginCommands(sessionId));
      break;
    case 'GIFT':
    case 'THIEF':
    case 'ROCKET':
      gameCommands.recoverSession(session).catch((error) => {
        console.error(`[game] command recovery failed for session ${sessionId}:`, error);
      });
      break;
    default:
      break;
  }
}

/**
 * Phase 5 scoring assumption (documented in README):
 * a correct answer is worth 50%-100% of the question points, decreasing
 * linearly with response time. Incorrect answers are worth zero.
 */
function calculatePoints(points, responseTimeMs, timeLimitMs) {
  if (!timeLimitMs || timeLimitMs <= 0) {
    return 0;
  }

  const ratio = Math.min(1, Math.max(0, responseTimeMs / timeLimitMs));

  return Math.max(0, Math.round(points * (1 - ratio * 0.5)));
}

async function getAnswerCounts(sessionId, questionId) {
  const rows = await Answer.aggregate([
    {
      $match: {
        session: toObjectId(sessionId),
        question: toObjectId(questionId),
      },
    },
    { $group: { _id: '$selectedOptionId', count: { $sum: 1 } } },
  ]);

  return rows.map((row) => ({
    optionId: row._id.toString(),
    count: row.count,
  }));
}

async function buildLeaderboard(sessionId) {
  const players = await SessionPlayer.find({
    session: sessionId,
    status: 'ACTIVE',
  }).sort({
    score: -1,
    totalResponseTimeMs: 1,
    joinedAt: 1,
    _id: 1,
  });

  let lastScore = null;
  let lastRank = 0;

  return players.map((player, index) => {
    const score = player.score || 0;
    const rank = lastScore !== null && score === lastScore ? lastRank : index + 1;

    lastScore = score;
    lastRank = rank;

    return serializeLeaderboardEntry(player, { rank, position: index + 1 });
  });
}

async function persistFinalRanks(leaderboard) {
  if (leaderboard.length === 0) {
    return;
  }

  await SessionPlayer.bulkWrite(
    leaderboard.map((entry) => ({
      updateOne: {
        filter: { _id: entry.participantId },
        update: { $set: { finalRank: entry.rank } },
      },
    }))
  );
}

async function applyAnswerToPlayer(answer) {
  const currentStreak = { $ifNull: ['$streak', 0] };
  const nextStreak = {
    $add: [currentStreak, 1],
  };
  const resolvedStreak = answer.isCorrect
    ? nextStreak
    : answer.streakShieldApplied
      ? currentStreak
      : 0;

  const pipeline = [
    {
      $set: {
        score: {
          $add: [{ $ifNull: ['$score', 0] }, answer.pointsAwarded || 0],
        },
        rawScore: {
          $add: [
            { $ifNull: ['$rawScore', 0] },
            answer.rawScoreAwarded || 0,
          ],
        },
        answeredCount: {
          $add: [{ $ifNull: ['$answeredCount', 0] }, 1],
        },
        correctCount: {
          $add: [{ $ifNull: ['$correctCount', 0] }, answer.isCorrect ? 1 : 0],
        },
        totalResponseTimeMs: {
          $add: [{ $ifNull: ['$totalResponseTimeMs', 0] }, answer.responseTimeMs || 0],
        },
        streak: resolvedStreak,
        bestStreak: answer.isCorrect
          ? {
              $cond: [
                { $gt: [nextStreak, { $ifNull: ['$bestStreak', 0] }] },
                nextStreak,
                { $ifNull: ['$bestStreak', 0] },
              ],
            }
          : { $ifNull: ['$bestStreak', 0] },
        doublePointsActive: answer.doublePointsApplied
          ? false
          : { $ifNull: ['$doublePointsActive', false] },
        streakShieldActive: answer.streakShieldApplied
          ? false
          : { $ifNull: ['$streakShieldActive', false] },
        answeredQuestions: {
          $concatArrays: [
            { $ifNull: ['$answeredQuestions', []] },
            [answer.question],
          ],
        },
        lastAnswerAt: answer.submittedAt || new Date(),
      },
    },
  ];

  return SessionPlayer.findOneAndUpdate(
    {
      _id: answer.sessionPlayer,
      answeredQuestions: { $ne: answer.question },
    },
    pipeline,
    { new: true, updatePipeline: true }
  );
}

async function reconcileUnappliedAnswers() {
  const answers = await Answer.find({ applied: { $ne: true } }).limit(1000);

  for (const answer of answers) {
    try {
      // Answers created before raw scores existed have no stored award. Derive
      // it from the session snapshot so reconciliation stays accurate.
      if (answer.isCorrect && !answer.rawScoreAwarded) {
        const session = await Session.findById(answer.session);

        if (session) {
          const question = (session.gameQuestions || []).find(
            (item) =>
              item.question.toString() === answer.question.toString()
          );

          if (question) {
            answer.rawScoreAwarded = question.points || 0;
          }
        }
      }

      const player = await applyAnswerToPlayer(answer);

      answer.applied = true;
      answer.streakAfter = player ? player.streak : answer.streakAfter;
      await answer.save();
    } catch (error) {
      console.error(`[game] could not reconcile answer ${answer._id}:`, error.message);
    }
  }

  if (answers.length > 0) {
    console.log(`[game] reconciled ${answers.length} persisted answer(s)`);
  }
}

async function getGameState(session, { participant = null, includeAnswerCounts = false } = {}) {
  const now = new Date();
  const totalQuestions = session.gameQuestions?.length || 0;
  const index = session.currentQuestionIndex ?? -1;
  const question =
    index >= 0 && index < totalQuestions ? session.gameQuestions[index] : null;
  const revealStates = [
    'REVEAL',
    'EXPLANATION',
    'POINTS',
    'LEADERBOARD',
    'PHONE_LEADERBOARD',
    'GIFT',
    'THIEF',
    'ROCKET',
    'FINISHED',
  ];
  const includeCorrect = revealStates.includes(session.gameState);
  const leaderboard = await buildLeaderboard(session._id);
  const totalPlayers = await SessionPlayer.countDocuments({
    session: session._id,
    status: 'ACTIVE',
  });
  let answerCounts = null;
  let answeredCount = null;

  if (includeAnswerCounts && question) {
    answerCounts = await getAnswerCounts(session._id, question.question);
    answeredCount = answerCounts.reduce((sum, item) => sum + item.count, 0);
  }

  const activeCommand = await gameCommands.getActiveCommand(session._id);
  const queuedCommands = includeAnswerCounts
    ? await gameCommands.getQueuedCommands(session._id)
    : [];

  const state = {
    sessionId: session._id.toString(),
    status: session.status,
    gameState: session.gameState,
    currentQuestionIndex: index,
    totalQuestions,
    questionProgress: {
      current: index >= 0 ? index + 1 : 0,
      total: totalQuestions,
      answeredCount,
      totalPlayers,
    },
    phaseStartedAt: session.phaseStartedAt || null,
    phaseEndsAt: session.phaseEndsAt || null,
    phaseRemainingMs:
      session.status === 'PAUSED'
        ? session.remainingTimeMs ?? null
        : session.phaseEndsAt
          ? Math.max(0, new Date(session.phaseEndsAt).getTime() - now.getTime())
          : null,
    remainingTimeMs: session.remainingTimeMs ?? null,
    serverTime: now,
    question: serializeGameQuestion(question, { includeCorrect }),
    leaderboard,
    commandSettings: plainObject(session.commandSettings, {
      gift: false,
      thief: false,
      rocket: false,
    }),
    phaseSettings: plainObject(session.phaseSettings, DEFAULT_PHASE_SETTINGS),
  };

  if (includeAnswerCounts) {
    state.answerCounts = answerCounts;
    state.answerCount = answeredCount;
    state.commandQueue = queuedCommands.map((command) =>
      gameCommands.serializeCommand(command)
    );

    const participants = await SessionPlayer.find({
      session: session._id,
      status: 'ACTIVE',
    }).sort({ joinedAt: 1, _id: 1 });

    state.participants = participants.map((player) => ({
      ...serializeParticipant(player),
      commandEligible: gameCommands.isEligibleTarget(session, null, player),
    }));
  }

  if (participant) {
    const player = await SessionPlayer.findById(participant._id || participant);

    if (player) {
      const entry = leaderboard.find(
        (item) => item.participantId === player._id.toString()
      );

      state.you = {
        participantId: player._id.toString(),
        nickname: player.nickname,
        score: player.score || 0,
        streak: player.streak || 0,
        bestStreak: player.bestStreak || 0,
        rank: entry ? entry.rank : null,
        doublePointsActive: Boolean(player.doublePointsActive),
        streakShieldActive: Boolean(player.streakShieldActive),
        colorShards: player.colorShards || 0,
        unlockedColors: player.unlockedColors || [],
        giftsReceived: player.giftsReceived || 0,
        lastGiftCards: player.lastGiftCards || [],
      };

      if (question) {
        const answer = await Answer.findOne({
          sessionPlayer: player._id,
          question: question.question,
        });

        if (answer) {
          state.yourAnswer = {
            selectedOptionId: toId(answer.selectedOptionId),
            responseTimeMs: answer.responseTimeMs,
            submittedAt: answer.submittedAt,
          };

          if (includeCorrect) {
            state.yourAnswer.isCorrect = answer.isCorrect;
            state.yourAnswer.pointsAwarded = answer.pointsAwarded;
            state.yourAnswer.basePointsAwarded = answer.basePointsAwarded;
            state.yourAnswer.doublePointsApplied = Boolean(
              answer.doublePointsApplied
            );
            state.yourAnswer.streakShieldApplied = Boolean(
              answer.streakShieldApplied
            );
            state.yourAnswer.streakAfter = answer.streakAfter;
          }
        } else {
          state.yourAnswer = null;
        }
      }
    }
  }

  if (activeCommand) {
    const isActor =
      participant &&
      toId(activeCommand.actor) === toId(participant._id || participant);
    const serialized = gameCommands.serializeCommand(activeCommand);

    if (includeAnswerCounts || isActor) {
      state.activeCommand = serialized;
    } else {
      state.activeCommand = {
        commandId: serialized.commandId,
        type: serialized.type,
        status: serialized.status,
        actorId: serialized.actorId,
        questionIndex: serialized.questionIndex,
        selectionEndsAt: serialized.selectionEndsAt,
      };
    }

    if (isActor) {
      state.yourCommand = serialized;

      if (activeCommand.status === 'AWAITING_TARGET') {
        const targets = await gameCommands.findEligibleTargets(
          session,
          activeCommand.actor,
          { requirePositiveScore: activeCommand.type === 'THIEF' }
        );

        state.commandTargets = targets.map((target) =>
          gameCommands.serializeTarget(target)
        );
      }
    }
  }

  return state;
}

async function startGame(session) {
  const questions = await Question.find({ quiz: session.quiz }).sort({
    order: 1,
    createdAt: 1,
    _id: 1,
  });

  if (questions.length === 0) {
    throw gameError(
      GAME_ERRORS.INVALID_GAME_STATE,
      'Quiz must have at least one question before starting',
      409
    );
  }

  const snapshots = questions.map((question) => ({
    question: question._id,
    text: question.text,
    points: question.points,
    timeLimitSec: question.timeLimitSec,
    order: question.order,
    explanation: question.explanation || null,
    options: question.options.map((option) => ({
      optionId: option._id,
      text: option.text,
      isCorrect: option.isCorrect,
    })),
  }));

  const now = new Date();
  const phaseEndsAt = new Date(now.getTime() + PHASE_DURATIONS.COUNTDOWN);
  const updated = await Session.findOneAndUpdate(
    { _id: session._id, status: 'LIVE', gameState: 'IDLE' },
    {
      $set: {
        gameQuestions: snapshots,
        gameState: 'COUNTDOWN',
        currentQuestionIndex: -1,
        phaseStartedAt: now,
        phaseEndsAt,
        remainingTimeMs: null,
        pausedAt: null,
        activeCommand: null,
      },
    },
    { new: true }
  );

  if (!updated) {
    const current = await Session.findById(session._id);

    if (current && current.gameState !== 'IDLE') {
      return current;
    }

    throw gameError(
      GAME_ERRORS.GAME_ALREADY_STARTED,
      'The game cannot be started in its current state',
      409
    );
  }

  emit(sessionRoom(updated._id), 'game:started', {
    sessionId: updated._id.toString(),
    startedAt: updated.startedAt,
    gameState: updated.gameState,
    totalQuestions: updated.gameQuestions.length,
    phaseStartedAt: updated.phaseStartedAt,
    phaseEndsAt: updated.phaseEndsAt,
    serverTime: now,
  });

  scheduleCurrentPhase(updated);

  return updated;
}

async function pauseGame(session) {
  const now = new Date();
  const paused = await Session.findOneAndUpdate(
    { _id: session._id, status: 'LIVE' },
    { $set: { status: 'PAUSED', pausedAt: now } },
    { new: true }
  );

  if (!paused) {
    return Session.findById(session._id);
  }

  const remainingTimeMs = paused.phaseEndsAt
    ? Math.max(0, new Date(paused.phaseEndsAt).getTime() - now.getTime())
    : null;

  paused.remainingTimeMs = remainingTimeMs;
  await paused.save();

  clearTimer(paused._id);
  await gameCommands.pauseActiveCommand(paused);

  emit(sessionRoom(paused._id), 'game:paused', {
    sessionId: paused._id.toString(),
    gameState: paused.gameState,
    pausedAt: paused.pausedAt,
    phaseEndsAt: paused.phaseEndsAt,
    remainingTimeMs,
    serverTime: now,
  });

  return paused;
}

async function resumeGame(session) {
  const current = await Session.findById(session._id);

  if (!current) {
    throw gameError(GAME_ERRORS.SESSION_NOT_FOUND, 'Session not found', 404);
  }

  if (current.status !== 'PAUSED') {
    return current;
  }

  const now = new Date();
  const phaseEndsAt =
    current.remainingTimeMs !== null && current.remainingTimeMs !== undefined
      ? new Date(now.getTime() + current.remainingTimeMs)
      : current.phaseEndsAt;

  const resumed = await Session.findOneAndUpdate(
    { _id: current._id, status: 'PAUSED' },
    {
      $set: {
        status: 'LIVE',
        phaseEndsAt,
        remainingTimeMs: null,
        pausedAt: null,
      },
    },
    { new: true }
  );

  if (!resumed) {
    return Session.findById(current._id);
  }

  emit(sessionRoom(resumed._id), 'game:resumed', {
    sessionId: resumed._id.toString(),
    gameState: resumed.gameState,
    resumedAt: now,
    phaseEndsAt: resumed.phaseEndsAt,
    serverTime: now,
  });

  const activeCommand = await gameCommands.resumeActiveCommand(resumed);

  if (!activeCommand) {
    scheduleCurrentPhase(resumed);
  }

  return resumed;
}

async function finishGame(session) {
  const now = new Date();
  const finished = await Session.findOneAndUpdate(
    { _id: session._id, status: { $ne: 'FINISHED' } },
    {
      $set: {
        status: 'FINISHED',
        gameState: 'FINISHED',
        endedAt: now,
        joinOpen: false,
        phaseEndsAt: null,
        remainingTimeMs: null,
        pausedAt: null,
        activeCommand: null,
      },
    },
    { new: true }
  );

  if (!finished) {
    return Session.findById(session._id);
  }

  clearTimer(finished._id);
  await gameCommands.cancelAllForSession(finished, 'GAME_FINISHED');

  const leaderboard = await buildLeaderboard(finished._id);
  await persistFinalRanks(leaderboard);

  try {
    await attendanceService.finalizeSessionAttendance(finished);
  } catch (error) {
    console.error(
      `[attendance] finalization failed for session ${finished._id}: ${error.message}`
    );
  }

  emit(sessionRoom(finished._id), 'game:finished', {
    sessionId: finished._id.toString(),
    endedAt: finished.endedAt,
    totalQuestions: finished.gameQuestions.length,
    leaderboard,
    serverTime: now,
  });

  return finished;
}

async function startQuestion(sessionId, index) {
  const current = await Session.findById(sessionId);

  if (!current || current.status !== 'LIVE') {
    return null;
  }

  if (index >= current.gameQuestions.length) {
    return finishGame(current);
  }

  const question = current.gameQuestions[index];

  if (!question) {
    return finishGame(current);
  }

  const now = new Date();
  const phaseEndsAt = new Date(now.getTime() + question.timeLimitSec * 1000);
  const updated = await Session.findOneAndUpdate(
    {
      _id: sessionId,
      status: 'LIVE',
      gameState: {
        $nin: ['IDLE', 'FINISHED', 'QUESTION'],
      },
      currentQuestionIndex: index - 1,
    },
    {
      $set: {
        gameState: 'QUESTION',
        currentQuestionIndex: index,
        phaseStartedAt: now,
        phaseEndsAt,
        remainingTimeMs: null,
        activeCommand: null,
      },
    },
    { new: true }
  );

  if (!updated) {
    return null;
  }

  clearTimer(updated._id);

  emit(sessionRoom(updated._id), 'question:started', {
    sessionId: updated._id.toString(),
    questionId: question.question.toString(),
    question: serializeGameQuestion(question),
    index,
    totalQuestions: updated.gameQuestions.length,
    phaseStartedAt: now,
    phaseEndsAt,
    serverTime: now,
  });

  schedulePhase(updated._id, question.timeLimitSec * 1000, () =>
    endQuestion(updated._id)
  );

  return updated;
}

async function endQuestion(sessionId) {
  const now = new Date();
  const current = await Session.findById(sessionId);
  const revealMs = phaseMs(
    current || {},
    'revealMs',
    PHASE_DURATIONS.REVEAL
  );
  const updated = await Session.findOneAndUpdate(
    { _id: sessionId, status: 'LIVE', gameState: 'QUESTION' },
    {
      $set: {
        gameState: 'REVEAL',
        phaseStartedAt: now,
        phaseEndsAt: new Date(now.getTime() + revealMs),
        remainingTimeMs: null,
      },
    },
    { new: true }
  );

  if (!updated) {
    return null;
  }

  clearTimer(updated._id);

  const index = updated.currentQuestionIndex;
  const question = updated.gameQuestions[index];

  if (!question) {
    scheduleCurrentPhase(updated);
    return updated;
  }

  const [answers, players, counts] = await Promise.all([
    Answer.find({ session: updated._id, question: question.question }),
    SessionPlayer.find({ session: updated._id, status: 'ACTIVE' }).sort({
      joinedAt: 1,
      _id: 1,
    }),
    getAnswerCounts(updated._id, question.question),
  ]);

  const totalPlayers = players.length;
  const answeredCount = answers.length;
  const questionId = question.question.toString();

  emit(sessionRoom(updated._id), 'question:ended', {
    sessionId: updated._id.toString(),
    questionId,
    index,
    answeredCount,
    totalPlayers,
    endedAt: now,
    serverTime: now,
  });

  if (phaseVisible(updated, 'showReveal')) {
    emit(sessionRoom(updated._id), 'answer:revealed', {
      sessionId: updated._id.toString(),
      questionId,
      index,
      correctOptionId: question.options.find((option) => option.isCorrect)
        ? question.options.find((option) => option.isCorrect).optionId.toString()
        : null,
      answerCounts: counts,
      answeredCount,
      totalPlayers,
      phaseEndsAt: updated.phaseEndsAt,
      serverTime: now,
    });
  }

  const leaderboard = await buildLeaderboard(updated._id);
  const rankByPlayer = new Map(
    leaderboard.map((entry) => [entry.participantId, entry.rank])
  );
  const answersByPlayer = new Map(
    answers.map((answer) => [answer.sessionPlayer.toString(), answer])
  );

  const participantResults = players.map((player) => {
    const answer = answersByPlayer.get(player._id.toString());
    const result = {
      participantId: player._id.toString(),
      nickname: player.nickname,
      questionId,
      selectedOptionId: answer ? answer.selectedOptionId.toString() : null,
      isCorrect: answer ? answer.isCorrect : false,
      pointsAwarded: answer ? answer.pointsAwarded : 0,
      basePointsAwarded: answer ? answer.basePointsAwarded : 0,
      doublePointsApplied: answer ? Boolean(answer.doublePointsApplied) : false,
      streakShieldApplied: answer ? Boolean(answer.streakShieldApplied) : false,
      responseTimeMs: answer ? answer.responseTimeMs : null,
      score: player.score || 0,
      streak: player.streak || 0,
      bestStreak: player.bestStreak || 0,
      rank: rankByPlayer.get(player._id.toString()) ?? null,
    };

    emit(playerRoom(player._id), 'answer:result', {
      sessionId: updated._id.toString(),
      ...result,
      serverTime: now,
    });

    emit(playerRoom(player._id), 'points:updated', {
      sessionId: updated._id.toString(),
      ...result,
      serverTime: now,
    });

    return result;
  });

  emit(teacherRoom(updated._id), 'answer:revealed:details', {
    sessionId: updated._id.toString(),
    questionId,
    index,
    participantResults,
    serverTime: now,
  });

  schedulePhase(updated._id, revealMs, () => showExplanation(updated._id));

  return updated;
}

async function showExplanation(sessionId) {
  const now = new Date();
  const current = await Session.findById(sessionId);
  const explanationMs = phaseMs(
    current || {},
    'explanationMs',
    PHASE_DURATIONS.EXPLANATION
  );
  const updated = await Session.findOneAndUpdate(
    { _id: sessionId, status: 'LIVE', gameState: 'REVEAL' },
    {
      $set: {
        gameState: 'EXPLANATION',
        phaseStartedAt: now,
        phaseEndsAt: new Date(now.getTime() + explanationMs),
      },
    },
    { new: true }
  );

  if (!updated) {
    return null;
  }

  clearTimer(updated._id);

  const question = updated.gameQuestions[updated.currentQuestionIndex];

  if (phaseVisible(updated, 'showExplanation')) {
    emit(sessionRoom(updated._id), 'explanation:shown', {
      sessionId: updated._id.toString(),
      questionId: question ? question.question.toString() : null,
      index: updated.currentQuestionIndex,
      explanation: question?.explanation || null,
      phaseEndsAt: updated.phaseEndsAt,
      serverTime: now,
    });
  }

  schedulePhase(updated._id, explanationMs, () => showPoints(updated._id));

  return updated;
}

async function showPoints(sessionId) {
  const now = new Date();
  const current = await Session.findById(sessionId);
  const pointsMs = phaseMs(current || {}, 'pointsMs', PHASE_DURATIONS.POINTS);
  const updated = await Session.findOneAndUpdate(
    { _id: sessionId, status: 'LIVE', gameState: 'EXPLANATION' },
    {
      $set: {
        gameState: 'POINTS',
        phaseStartedAt: now,
        phaseEndsAt: new Date(now.getTime() + pointsMs),
      },
    },
    { new: true }
  );

  if (!updated) {
    return null;
  }

  clearTimer(updated._id);

  const question = updated.gameQuestions[updated.currentQuestionIndex];
  const answers = question
    ? await Answer.find({ session: updated._id, question: question.question })
    : [];
  const players = await SessionPlayer.find({
    session: updated._id,
    status: 'ACTIVE',
  }).sort({ joinedAt: 1, _id: 1 });
  const answersByPlayer = new Map(
    answers.map((answer) => [answer.sessionPlayer.toString(), answer])
  );
  const results = players.map((player) => {
    const answer = answersByPlayer.get(player._id.toString());

    return {
      participantId: player._id.toString(),
      nickname: player.nickname,
      pointsAwarded: answer ? answer.pointsAwarded : 0,
      basePointsAwarded: answer ? answer.basePointsAwarded : 0,
      doublePointsApplied: answer ? Boolean(answer.doublePointsApplied) : false,
      streakShieldApplied: answer ? Boolean(answer.streakShieldApplied) : false,
      score: player.score || 0,
      streak: player.streak || 0,
    };
  });

  if (phaseVisible(updated, 'showPoints')) {
    emit(sessionRoom(updated._id), 'points:shown', {
      sessionId: updated._id.toString(),
      questionId: question ? question.question.toString() : null,
      index: updated.currentQuestionIndex,
      results,
      phaseEndsAt: updated.phaseEndsAt,
      serverTime: now,
    });
  }

  schedulePhase(updated._id, pointsMs, () => showLeaderboard(updated._id));

  return updated;
}

async function showLeaderboard(sessionId) {
  const now = new Date();
  const current = await Session.findById(sessionId);
  const leaderboardMs = phaseMs(
    current || {},
    'leaderboardMs',
    PHASE_DURATIONS.LEADERBOARD
  );
  const updated = await Session.findOneAndUpdate(
    { _id: sessionId, status: 'LIVE', gameState: 'POINTS' },
    {
      $set: {
        gameState: 'LEADERBOARD',
        phaseStartedAt: now,
        phaseEndsAt: new Date(now.getTime() + leaderboardMs),
      },
    },
    { new: true }
  );

  if (!updated) {
    return null;
  }

  clearTimer(updated._id);

  const question = updated.gameQuestions[updated.currentQuestionIndex];
  const leaderboard = await buildLeaderboard(updated._id);

  if (phaseVisible(updated, 'showLeaderboard')) {
    emit(sessionRoom(updated._id), 'leaderboard:updated', {
      sessionId: updated._id.toString(),
      questionId: question ? question.question.toString() : null,
      index: updated.currentQuestionIndex,
      leaderboard,
      generatedAt: now,
      phaseEndsAt: updated.phaseEndsAt,
      serverTime: now,
    });
  }

  schedulePhase(updated._id, leaderboardMs, () =>
    showPhoneLeaderboard(updated._id)
  );

  return updated;
}

async function showPhoneLeaderboard(sessionId) {
  const now = new Date();
  const current = await Session.findById(sessionId);
  const phoneLeaderboardMs = phaseMs(
    current || {},
    'phoneLeaderboardMs',
    PHASE_DURATIONS.PHONE_LEADERBOARD
  );
  const updated = await Session.findOneAndUpdate(
    { _id: sessionId, status: 'LIVE', gameState: 'LEADERBOARD' },
    {
      $set: {
        gameState: 'PHONE_LEADERBOARD',
        phaseStartedAt: now,
        phaseEndsAt: new Date(now.getTime() + phoneLeaderboardMs),
      },
    },
    { new: true }
  );

  if (!updated) {
    return null;
  }

  clearTimer(updated._id);

  const question = updated.gameQuestions[updated.currentQuestionIndex];
  const leaderboard = await buildLeaderboard(updated._id);

  if (phaseVisible(updated, 'showPhoneLeaderboard')) {
    emit(sessionRoom(updated._id), 'phone-leaderboard:updated', {
      sessionId: updated._id.toString(),
      questionId: question ? question.question.toString() : null,
      index: updated.currentQuestionIndex,
      leaderboard,
      top: leaderboard.slice(0, 10),
      generatedAt: now,
      phaseEndsAt: updated.phaseEndsAt,
      serverTime: now,
    });
  }

  schedulePhase(updated._id, phoneLeaderboardMs, () =>
    beginCommands(updated._id)
  );

  return updated;
}

async function beginCommands(sessionId) {
  const current = await Session.findById(sessionId);

  if (!current || current.status !== 'LIVE') {
    return null;
  }

  await gameCommands.enqueueForQuestion(current);
  await gameCommands.processQueue(current._id);

  return current;
}

async function advanceAfterCommands(session) {
  const current = await Session.findById(session._id);

  if (!current || current.status !== 'LIVE') {
    return null;
  }

  const nextIndex = current.currentQuestionIndex + 1;

  if (nextIndex < current.gameQuestions.length) {
    return startQuestion(current._id, nextIndex);
  }

  return finishGame(current);
}

async function submitAnswer(participantId, payload = {}) {
  const participant = await SessionPlayer.findById(participantId);

  if (!participant) {
    throw gameError(GAME_ERRORS.PARTICIPANT_NOT_FOUND, 'Participant not found', 404);
  }

  if (participant.status === 'KICKED') {
    throw gameError(
      GAME_ERRORS.PARTICIPANT_KICKED,
      'You were removed from this session',
      403
    );
  }

  const session = await Session.findById(participant.session);

  if (!session) {
    throw gameError(GAME_ERRORS.SESSION_NOT_FOUND, 'Session not found', 404);
  }

  if (session.status === 'PAUSED') {
    throw gameError(GAME_ERRORS.GAME_NOT_ACTIVE, 'The game is paused', 409);
  }

  if (session.status !== 'LIVE' || session.gameState !== 'QUESTION') {
    throw gameError(
      GAME_ERRORS.NO_ACTIVE_QUESTION,
      'No question is currently accepting answers',
      409
    );
  }

  const index = session.currentQuestionIndex;
  const question = session.gameQuestions[index];

  if (!question) {
    throw gameError(
      GAME_ERRORS.NO_ACTIVE_QUESTION,
      'No question is currently accepting answers',
      409
    );
  }

  if (!payload.questionId || !mongoose.isValidObjectId(payload.questionId)) {
    throw gameError(GAME_ERRORS.INVALID_PAYLOAD, 'A valid questionId is required', 400);
  }

  if (question.question.toString() !== payload.questionId.toString()) {
    throw gameError(
      GAME_ERRORS.QUESTION_MISMATCH,
      'This is not the current question',
      409
    );
  }

  if (!payload.optionId || !mongoose.isValidObjectId(payload.optionId)) {
    throw gameError(GAME_ERRORS.INVALID_PAYLOAD, 'A valid optionId is required', 400);
  }

  const option = question.options.find(
    (item) => item.optionId.toString() === payload.optionId.toString()
  );

  if (!option) {
    throw gameError(
      GAME_ERRORS.INVALID_OPTION,
      'The selected option does not belong to this question',
      400
    );
  }

  const now = new Date();

  if (
    !session.phaseEndsAt ||
    now.getTime() > new Date(session.phaseEndsAt).getTime()
  ) {
    throw gameError(
      GAME_ERRORS.DEADLINE_PASSED,
      'The question deadline has passed',
      409
    );
  }

  const existing = await Answer.findOne({
    sessionPlayer: participant._id,
    question: question.question,
  });

  if (existing) {
    throw gameError(
      GAME_ERRORS.ALREADY_ANSWERED,
      'You have already answered this question',
      409
    );
  }

  const timeLimitMs = question.timeLimitSec * 1000;
  const startedAt = session.phaseStartedAt
    ? new Date(session.phaseStartedAt).getTime()
    : new Date(session.phaseEndsAt).getTime() - timeLimitMs;
  const responseTimeMs = Math.max(
    0,
    Math.min(timeLimitMs, now.getTime() - startedAt)
  );
  const isCorrect = Boolean(option.isCorrect);
  const basePointsAwarded = isCorrect
    ? calculatePoints(question.points, responseTimeMs, timeLimitMs)
    : 0;
  const doublePointsApplied = Boolean(participant.doublePointsActive);
  const pointsAwarded =
    isCorrect && doublePointsApplied ? basePointsAwarded * 2 : basePointsAwarded;
  const streakShieldApplied =
    !isCorrect && Boolean(participant.streakShieldActive);

  let answer;

  try {
    answer = await Answer.create({
      session: session._id,
      organization: session.organization,
      sessionPlayer: participant._id,
      question: question.question,
      selectedOptionId: option.optionId,
      isCorrect,
      responseTimeMs,
      pointsAwarded,
      basePointsAwarded,
      rawScoreAwarded: isCorrect ? question.points || 0 : 0,
      doublePointsApplied,
      streakShieldApplied,
      applied: false,
      submittedAt: now,
    });
  } catch (error) {
    if (error.code === 11000) {
      throw gameError(
        GAME_ERRORS.ALREADY_ANSWERED,
        'You have already answered this question',
        409
      );
    }

    throw error;
  }

  const updatedPlayer = await applyAnswerToPlayer(answer);

  answer.applied = true;
  answer.streakAfter = updatedPlayer ? updatedPlayer.streak : participant.streak;
  await answer.save();

  const [answerCount, totalPlayers] = await Promise.all([
    Answer.countDocuments({ session: session._id, question: question.question }),
    SessionPlayer.countDocuments({ session: session._id, status: 'ACTIVE' }),
  ]);

  const acknowledgement = {
    sessionId: session._id.toString(),
    questionId: question.question.toString(),
    selectedOptionId: option.optionId.toString(),
    submittedAt: now,
    responseTimeMs,
  };

  emit(playerRoom(participant._id), 'answer:submitted', {
    ...acknowledgement,
    serverTime: now,
  });

  emit(teacherRoom(session._id), 'answer:submitted', {
    sessionId: session._id.toString(),
    questionId: question.question.toString(),
    participant: {
      id: participant._id.toString(),
      nickname: participant.nickname,
    },
    answerCount,
    totalPlayers,
    submittedAt: now,
    serverTime: now,
  });

  if (totalPlayers > 0 && answerCount >= totalPlayers) {
    schedulePhase(session._id, 0, () => endQuestion(session._id));
  }

  return acknowledgement;
}

function notifyPlayerJoined(session, participant) {
  emit(sessionRoom(session._id), 'player:joined', {
    sessionId: session._id.toString(),
    participant: serializeParticipant(participant),
    at: new Date(),
  });
}

function notifyPlayerReconnected(session, participant) {
  emit(teacherRoom(session._id), 'player:reconnected', {
    sessionId: session._id.toString(),
    participant: serializeParticipant(participant),
    at: new Date(),
  });
}

function notifyJoinLockChanged(session) {
  emit(sessionRoom(session._id), 'session:join-lock-updated', {
    sessionId: session._id.toString(),
    joinOpen: Boolean(session.joinOpen),
    serverTime: new Date(),
  });
}

function notifyPlayerKicked(session, participant) {
  const at = new Date();

  emit(sessionRoom(session._id), 'player:kicked', {
    sessionId: session._id.toString(),
    participantId: participant._id.toString(),
    nickname: participant.nickname,
    at,
  });

  emit(playerRoom(participant._id), 'session:kicked', {
    sessionId: session._id.toString(),
    reason: 'kicked',
    at,
  });

  if (io) {
    io.in(playerRoom(participant._id)).disconnectSockets(true);
  }
}

async function revealQuestion(session) {
  const current = await Session.findById(session._id);

  if (!current) {
    throw gameError(GAME_ERRORS.SESSION_NOT_FOUND, 'Session not found', 404);
  }

  if (current.status !== 'LIVE') {
    throw gameError(GAME_ERRORS.GAME_NOT_ACTIVE, 'The game is not live', 409);
  }

  if (current.gameState !== 'QUESTION') {
    throw gameError(
      GAME_ERRORS.PHASE_NOT_CONTROLLABLE,
      'Only an active question can be revealed',
      409
    );
  }

  clearTimer(current._id);
  await endQuestion(current._id);

  const updated = await Session.findById(current._id);

  emit(sessionRoom(current._id), 'game:revealed', {
    sessionId: current._id.toString(),
    questionId: toId(
      current.gameQuestions?.[current.currentQuestionIndex]?.question
    ),
    questionIndex: current.currentQuestionIndex,
    gameState: updated?.gameState || 'REVEAL',
    serverTime: new Date(),
  });

  return updated;
}

async function nextPhase(session) {
  const current = await Session.findById(session._id);

  if (!current) {
    throw gameError(GAME_ERRORS.SESSION_NOT_FOUND, 'Session not found', 404);
  }

  if (current.status !== 'LIVE') {
    throw gameError(GAME_ERRORS.GAME_NOT_ACTIVE, 'The game is not live', 409);
  }

  const fromState = current.gameState;
  clearTimer(current._id);

  switch (fromState) {
    case 'COUNTDOWN':
      await startQuestion(current._id, 0);
      break;
    case 'QUESTION':
      await endQuestion(current._id);
      break;
    case 'REVEAL':
      await showExplanation(current._id);
      break;
    case 'EXPLANATION':
      await showPoints(current._id);
      break;
    case 'POINTS':
      await showLeaderboard(current._id);
      break;
    case 'LEADERBOARD':
      await showPhoneLeaderboard(current._id);
      break;
    case 'PHONE_LEADERBOARD':
      await beginCommands(current._id);
      break;
    case 'GIFT':
    case 'THIEF':
    case 'ROCKET':
      await gameCommands.forceResolve(current, 'TEACHER_NEXT');
      break;
    default:
      throw gameError(
        GAME_ERRORS.PHASE_NOT_CONTROLLABLE,
        'The current phase cannot be advanced',
        409
      );
  }

  const updated = await Session.findById(current._id);

  emit(sessionRoom(current._id), 'game:phase-advanced', {
    sessionId: current._id.toString(),
    fromState,
    toState: updated?.gameState || null,
    questionIndex: updated?.currentQuestionIndex ?? current.currentQuestionIndex,
    serverTime: new Date(),
  });

  return updated;
}

async function skipQuestion(session) {
  const current = await Session.findById(session._id);

  if (!current) {
    throw gameError(GAME_ERRORS.SESSION_NOT_FOUND, 'Session not found', 404);
  }

  if (current.status !== 'LIVE') {
    throw gameError(GAME_ERRORS.GAME_NOT_ACTIVE, 'The game is not live', 409);
  }

  if (current.gameState === 'IDLE' || current.gameState === 'FINISHED') {
    throw gameError(
      GAME_ERRORS.PHASE_NOT_CONTROLLABLE,
      'The current phase cannot be skipped',
      409
    );
  }

  const fromState = current.gameState;
  const skippedIndex = current.currentQuestionIndex;

  clearTimer(current._id);

  if (fromState === 'QUESTION') {
    await endQuestion(current._id);
  }

  const latest = await Session.findById(current._id);

  if (latest) {
    await gameCommands.cancelAllForSession(latest, 'QUESTION_SKIPPED');
  }

  clearTimer(current._id);
  await advanceAfterCommands(latest || current);

  const updated = await Session.findById(current._id);

  emit(sessionRoom(current._id), 'game:skipped', {
    sessionId: current._id.toString(),
    fromState,
    skippedQuestionIndex: skippedIndex,
    gameState: updated?.gameState || null,
    currentQuestionIndex: updated?.currentQuestionIndex ?? skippedIndex,
    serverTime: new Date(),
  });

  return updated;
}

async function updateCommandSettings(session, settings) {
  const current = await Session.findById(session._id);

  if (!current) {
    throw gameError(GAME_ERRORS.SESSION_NOT_FOUND, 'Session not found', 404);
  }

  if (current.status === 'FINISHED') {
    throw gameError(
      GAME_ERRORS.GAME_NOT_ACTIVE,
      'Finished sessions cannot change command settings',
      409
    );
  }

  current.commandSettings = {
    ...plainObject(current.commandSettings),
    ...settings,
  };
  await current.save();

  const disabledTypes = [];

  if (settings.gift === false) {
    disabledTypes.push('GIFT');
  }

  if (settings.thief === false) {
    disabledTypes.push('THIEF');
  }

  if (settings.rocket === false) {
    disabledTypes.push('ROCKET');
  }

  if (disabledTypes.length > 0) {
    await gameCommands.cancelCommandsForTypes(
      current,
      disabledTypes,
      'COMMAND_DISABLED'
    );

    if (current.status === 'LIVE') {
      await gameCommands.processQueue(current._id);
    }
  }

  emit(sessionRoom(current._id), 'game:command-settings-updated', {
    sessionId: current._id.toString(),
    commandSettings: plainObject(current.commandSettings),
    serverTime: new Date(),
  });

  return Session.findById(current._id);
}

async function updatePhaseSettings(session, settings) {
  const current = await Session.findById(session._id);

  if (!current) {
    throw gameError(GAME_ERRORS.SESSION_NOT_FOUND, 'Session not found', 404);
  }

  if (current.status === 'FINISHED') {
    throw gameError(
      GAME_ERRORS.GAME_NOT_ACTIVE,
      'Finished sessions cannot change phase settings',
      409
    );
  }

  current.phaseSettings = {
    ...plainObject(current.phaseSettings, DEFAULT_PHASE_SETTINGS),
    ...settings,
  };
  await current.save();

  const key = phaseKeyForState(current.gameState);

  if (
    current.status === 'LIVE' &&
    key &&
    Number.isFinite(current.phaseSettings[key])
  ) {
    const now = new Date();
    current.phaseEndsAt = new Date(
      now.getTime() + current.phaseSettings[key]
    );
    await current.save();
    clearTimer(current._id);
    scheduleCurrentPhase(current);
  }

  emit(sessionRoom(current._id), 'game:phase-settings-updated', {
    sessionId: current._id.toString(),
    phaseSettings: plainObject(current.phaseSettings, DEFAULT_PHASE_SETTINGS),
    phaseEndsAt: current.phaseEndsAt || null,
    serverTime: new Date(),
  });

  return Session.findById(current._id);
}

async function recoverSessions() {
  await reconcileUnappliedAnswers();

  // A process restart drops every Socket.IO connection, so persisted
  // `connected` flags are stale. Clear them before scheduling recovery;
  // players are marked connected again when their sockets re-authenticate.
  const disconnectedAt = new Date();

  await SessionPlayer.updateMany(
    { connected: true },
    {
      $set: {
        connected: false,
        lastSeenAt: disconnectedAt,
        lastDisconnectedAt: disconnectedAt,
      },
    }
  );

  const liveSessions = await Session.find({
    status: 'LIVE',
    gameState: { $nin: ['IDLE', 'FINISHED'] },
  });

  for (const session of liveSessions) {
    if (!session.phaseEndsAt && session.gameState !== 'GIFT' && session.gameState !== 'THIEF' && session.gameState !== 'ROCKET') {
      session.phaseEndsAt = new Date();
      await session.save();
    }

    if (session.activeCommand) {
      await gameCommands.recoverSession(session);
    } else if (['GIFT', 'THIEF', 'ROCKET'].includes(session.gameState)) {
      await gameCommands.recoverSession(session);
    } else {
      scheduleCurrentPhase(session);
    }
  }

  const pausedSessions = await Session.find({
    status: 'PAUSED',
    gameState: { $nin: ['IDLE', 'FINISHED'] },
  });

  for (const session of pausedSessions) {
    if (session.remainingTimeMs === null || session.remainingTimeMs === undefined) {
      session.remainingTimeMs = session.phaseEndsAt
        ? Math.max(0, new Date(session.phaseEndsAt).getTime() - Date.now())
        : 0;
      await session.save();
    }

    if (session.activeCommand) {
      await gameCommands.recoverSession(session);
    }
  }

  return {
    live: liveSessions.length,
    paused: pausedSessions.length,
  };
}

module.exports = {
  init,
  calculatePoints,
  buildLeaderboard,
  getGameState,
  startGame,
  pauseGame,
  resumeGame,
  finishGame,
  startQuestion,
  endQuestion,
  showExplanation,
  showPoints,
  showLeaderboard,
  showPhoneLeaderboard,
  beginCommands,
  advanceAfterCommands,
  submitAnswer,
  notifyPlayerJoined,
  notifyPlayerReconnected,
  notifyJoinLockChanged,
  notifyPlayerKicked,
  revealQuestion,
  nextPhase,
  skipQuestion,
  updateCommandSettings,
  updatePhaseSettings,
  recoverSessions,
};
