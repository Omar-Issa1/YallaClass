const mongoose = require('mongoose');

const Answer = require('../../models/answer.model');
const Session = require('../../models/session.model');
const SessionCommand = require('../../models/session-command.model');
const SessionEvent = require('../../models/session-event.model');
const SessionPlayer = require('../../models/session-player.model');
const { AVATAR_COLOR_IDS } = require('../../constants/avatar');
const {
  COMMAND_PRIORITIES,
  COMMAND_SELECTION_TIMEOUT_MS,
  DEFAULT_COMMAND_SETTINGS,
  GIFT_CARDS,
  GIFT_DRAW_COUNT,
  GIFT_UNLOCK_STREAK,
  LEADERBOARD_STRIKE_POINTS,
  POINTS_BONUS_POINTS,
  ROCKET_UNLOCK_MULTIPLE,
  THIEF_ACTIVATION_CHANCE,
  THIEF_UNLOCK_STREAK,
  COLOR_SHARDS_PER_UNLOCK,
  GAME_ERRORS,
} = require('./game.constants');
const { gameError } = require('./game.errors');
const { playerRoom, sessionRoom, teacherRoom } = require('./game.rooms');

const selectionTimers = new Map();
const processingSessions = new Set();

let io = null;
let engineHooks = {
  advanceAfterCommands: async () => {},
};

function init(socketServer, hooks = {}) {
  io = socketServer;
  engineHooks = { ...engineHooks, ...hooks };
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

function emit(room, event, payload) {
  if (io) {
    io.to(room).emit(event, payload);
  }
}

function clearSelectionTimer(commandId) {
  const key = commandId.toString();
  const timer = selectionTimers.get(key);

  if (timer) {
    clearTimeout(timer);
    selectionTimers.delete(key);
  }
}

function scheduleSelectionTimer(sessionId, commandId, selectionEndsAt) {
  clearSelectionTimer(commandId);

  const key = commandId.toString();
  const delay = Math.max(
    0,
    new Date(selectionEndsAt).getTime() - Date.now()
  );
  const timer = setTimeout(
    () => {
      selectionTimers.delete(key);
      Promise.resolve()
        .then(() => handleSelectionTimeout(sessionId, commandId))
        .catch((error) => {
          console.error(`[commands] selection timeout failed: ${error.message}`);
        });
    },
    delay
  );

  if (typeof timer.unref === 'function') {
    timer.unref();
  }

  selectionTimers.set(key, timer);
}

function isNukeUnlock(streak) {
  return (
    Number.isInteger(streak) &&
    streak > 0 &&
    streak % ROCKET_UNLOCK_MULTIPLE === 0
  );
}

function shouldActivateThief(
  random = Math.random,
  chance = THIEF_ACTIVATION_CHANCE
) {
  return random() < chance;
}

function drawGiftCards(random = Math.random, count = GIFT_DRAW_COUNT) {
  const pool = GIFT_CARDS.map((card) => ({ ...card }));
  const cards = [];

  while (cards.length < count && pool.length > 0) {
    const totalWeight = pool.reduce((sum, card) => sum + card.weight, 0);
    let roll = random() * totalWeight;
    let index = pool.length - 1;

    for (let i = 0; i < pool.length; i += 1) {
      roll -= pool[i].weight;

      if (roll < 0) {
        index = i;
        break;
      }
    }

    cards.push(pool.splice(index, 1)[0]);
  }

  return cards;
}

function commandKey(sessionId, type, questionIndex, actorId) {
  return `${sessionId}:${type}:${questionIndex}:${actorId}`;
}

function commandEnabled(session, type) {
  const settings = session.commandSettings || DEFAULT_COMMAND_SETTINGS;

  switch (type) {
    case 'GIFT':
      return Boolean(settings.gift);
    case 'THIEF':
      return Boolean(settings.thief);
    case 'ROCKET':
      return Boolean(settings.rocket);
    default:
      return false;
  }
}

function serializeCommand(command) {
  if (!command) {
    return null;
  }

  return {
    id: command._id.toString(),
    commandId: command.commandId,
    type: command.type,
    status: command.status,
    actorId: toId(command.actor),
    targetId: toId(command.target),
    questionId: toId(command.question),
    questionIndex: command.questionIndex,
    selectionEndsAt: command.selectionEndsAt || null,
    remainingSelectionMs: command.remainingSelectionMs ?? null,
    startedAt: command.startedAt || null,
    completedAt: command.completedAt || null,
    result: command.result || {},
    error: command.error || null,
    createdAt: command.createdAt,
  };
}

function serializeTarget(player) {
  return {
    participantId: toId(player._id),
    nickname: player.nickname,
    name: player.name,
    avatar: {
      preset: player.avatar?.preset || null,
      color: player.avatar?.color || null,
    },
    score: player.score || 0,
    streak: player.streak || 0,
    connected: Boolean(player.connected),
  };
}

async function buildLeaderboardDocs(sessionId) {
  return SessionPlayer.find({
    session: sessionId,
    status: 'ACTIVE',
  }).sort({
    score: -1,
    totalResponseTimeMs: 1,
    joinedAt: 1,
    _id: 1,
  });
}

function isEligibleTarget(session, actorId, target, { requirePositiveScore = false } = {}) {
  if (!target) {
    return false;
  }

  if (toId(target._id) === toId(actorId)) {
    return false;
  }

  if (target.status !== 'ACTIVE' || !target.connected) {
    return false;
  }

  if (requirePositiveScore && (target.score || 0) <= 0) {
    return false;
  }

  const currentIndex = session.currentQuestionIndex ?? -1;

  if (
    target.offlineSinceQuestionIndex !== null &&
    target.offlineSinceQuestionIndex !== undefined &&
    target.offlineSinceQuestionIndex <= currentIndex - 2
  ) {
    return false;
  }

  return true;
}

async function findEligibleTargets(
  session,
  actorId,
  { requirePositiveScore = false } = {}
) {
  const filter = {
    session: session._id,
    status: 'ACTIVE',
    connected: true,
    _id: { $ne: toObjectId(actorId) },
  };

  if (requirePositiveScore) {
    filter.score = { $gt: 0 };
  }

  const players = await SessionPlayer.find(filter).sort({
    joinedAt: 1,
    _id: 1,
  });

  return players.filter((player) =>
    isEligibleTarget(session, actorId, player, { requirePositiveScore })
  );
}

async function recordCommandEvent(
  session,
  command,
  { targetId = null, value = 0, metadata = {} } = {}
) {
  try {
    await SessionEvent.updateOne(
      { dedupeKey: command.commandId },
      {
        $setOnInsert: {
          session: session._id,
          organization: session.organization,
          type: command.type,
          actorType: 'PLAYER',
          actorId: command.actor,
          targetId: targetId || null,
          value,
          question: command.question || null,
          questionIndex: command.questionIndex,
          timestamp: new Date(),
          metadata,
          dedupeKey: command.commandId,
        },
      },
      { upsert: true }
    );
  } catch (error) {
    if (error.code !== 11000) {
      throw error;
    }
  }
}

async function recordTeacherEvent(session, user, type, metadata = {}) {
  try {
    await SessionEvent.create({
      session: session._id,
      organization: session.organization,
      type,
      actorType: 'TEACHER',
      actorId: user?._id || null,
      targetId: metadata.participantId
        ? toObjectId(metadata.participantId)
        : null,
      value: Number.isFinite(metadata.value) ? metadata.value : 0,
      question: session.gameQuestions?.[session.currentQuestionIndex]?.question || null,
      questionIndex: session.currentQuestionIndex ?? -1,
      timestamp: new Date(),
      metadata,
    });
  } catch (error) {
    console.error(`[commands] could not record teacher event ${type}:`, error.message);
  }
}

async function enqueueForQuestion(session) {
  const current = await Session.findById(session._id);

  if (!current || current.status !== 'LIVE') {
    return [];
  }

  const index = current.currentQuestionIndex;
  const question = current.gameQuestions?.[index];

  if (!question) {
    return [];
  }

  const [answers, players] = await Promise.all([
    Answer.find({ session: current._id, question: question.question }),
    SessionPlayer.find({ session: current._id, status: 'ACTIVE' }).sort({
      joinedAt: 1,
      _id: 1,
    }),
  ]);
  const answersByPlayer = new Map(
    answers.map((answer) => [answer.sessionPlayer.toString(), answer])
  );
  const isLastQuestion = index + 1 >= current.gameQuestions.length;
  const triggers = [];

  for (const player of players) {
    const answer = answersByPlayer.get(player._id.toString());

    if (!answer || !answer.isCorrect) {
      continue;
    }

    if (
      commandEnabled(current, 'GIFT') &&
      player.streak === GIFT_UNLOCK_STREAK
    ) {
      triggers.push({
        type: 'GIFT',
        player,
        metadata: { unlockStreak: GIFT_UNLOCK_STREAK },
      });
    }

    if (
      commandEnabled(current, 'THIEF') &&
      !isLastQuestion &&
      player.streak === THIEF_UNLOCK_STREAK &&
      shouldActivateThief()
    ) {
      const targets = await findEligibleTargets(current, player._id, {
        requirePositiveScore: true,
      });

      if (targets.length > 0) {
        triggers.push({
          type: 'THIEF',
          player,
          metadata: {
            activationChance: THIEF_ACTIVATION_CHANCE,
            eligibleTargetCount: targets.length,
          },
        });
      }
    }

    if (commandEnabled(current, 'ROCKET') && isNukeUnlock(player.streak)) {
      const targets = await findEligibleTargets(current, player._id);

      if (targets.length > 0) {
        triggers.push({
          type: 'ROCKET',
          player,
          metadata: { unlockStreak: player.streak },
        });
      }
    }
  }

  triggers.sort(
    (a, b) =>
      COMMAND_PRIORITIES[a.type] - COMMAND_PRIORITIES[b.type] ||
      new Date(a.player.joinedAt).getTime() - new Date(b.player.joinedAt).getTime() ||
      a.player._id.toString().localeCompare(b.player._id.toString())
  );

  const created = [];

  for (const trigger of triggers) {
    const commandId = commandKey(
      current._id,
      trigger.type,
      index,
      trigger.player._id
    );

    try {
      const command = await SessionCommand.create({
        session: current._id,
        organization: current.organization,
        commandId,
        type: trigger.type,
        priority: COMMAND_PRIORITIES[trigger.type],
        actor: trigger.player._id,
        question: question.question,
        questionIndex: index,
        status: 'QUEUED',
        metadata: {
          ...trigger.metadata,
          actorNickname: trigger.player.nickname,
          questionId: question.question.toString(),
          questionIndex: index,
        },
      });

      created.push(command);

      emit(sessionRoom(current._id), 'command:queued', {
        sessionId: current._id.toString(),
        command: serializeCommand(command),
        actor: {
          participantId: trigger.player._id.toString(),
          nickname: trigger.player.nickname,
        },
        serverTime: new Date(),
      });
    } catch (error) {
      if (error.code !== 11000) {
        throw error;
      }
    }
  }

  return created;
}

async function markCommandCompleted(session, command, result, targetId = null) {
  const completed = await SessionCommand.findOneAndUpdate(
    {
      _id: command._id,
      status: { $in: ['PROCESSING', 'AWAITING_TARGET'] },
    },
    {
      $set: {
        status: 'COMPLETED',
        target: targetId || command.target || null,
        completedAt: new Date(),
        result,
      },
    },
    { new: true }
  );

  clearSelectionTimer(command.commandId);

  await Session.updateOne(
    { _id: session._id, activeCommand: command._id },
    { $set: { activeCommand: null } }
  );

  return completed || command;
}

async function cancelCommand(session, command, reason, metadata = {}) {
  const cancelled = await SessionCommand.findOneAndUpdate(
    {
      _id: command._id,
      status: { $in: ['QUEUED', 'PROCESSING', 'AWAITING_TARGET'] },
    },
    {
      $set: {
        status: 'CANCELLED',
        completedAt: new Date(),
        error: reason,
      },
    },
    { new: true }
  );

  clearSelectionTimer(command.commandId);

  await Session.updateOne(
    { _id: session._id, activeCommand: command._id },
    { $set: { activeCommand: null } }
  );

  await recordCommandEvent(session, command, {
    value: 0,
    metadata: {
      ...command.metadata,
      ...metadata,
      status: 'CANCELLED',
      reason,
    },
  });

  emit(sessionRoom(session._id), 'command:cancelled', {
    sessionId: session._id.toString(),
    command: serializeCommand(cancelled || command),
    reason,
    serverTime: new Date(),
  });

  return cancelled || command;
}

async function applyLeaderboardStrike(session, ownerPlayer) {
  const players = await buildLeaderboardDocs(session._id);
  const entries = players.map((player) => ({
    _id: player._id,
    score:
      player._id.toString() === ownerPlayer._id.toString()
        ? ownerPlayer.score || 0
        : player.score || 0,
    totalResponseTimeMs: player.totalResponseTimeMs || 0,
    joinedAt: player.joinedAt,
  }));

  entries.sort(
    (a, b) =>
      b.score - a.score ||
      a.totalResponseTimeMs - b.totalResponseTimeMs ||
      new Date(a.joinedAt).getTime() - new Date(b.joinedAt).getTime() ||
      a._id.toString().localeCompare(b._id.toString())
  );

  const ownerIndex = entries.findIndex(
    (entry) => entry._id.toString() === ownerPlayer._id.toString()
  );

  if (ownerIndex <= 0) {
    ownerPlayer.score = (ownerPlayer.score || 0) + LEADERBOARD_STRIKE_POINTS;

    return {
      amount: LEADERBOARD_STRIKE_POINTS,
      targetId: null,
      targetNickname: null,
      firstPlaceBonus: true,
    };
  }

  const target = entries[ownerIndex - 1];
  const amount = Math.min(LEADERBOARD_STRIKE_POINTS, target.score || 0);

  if (amount <= 0) {
    return {
      amount: 0,
      targetId: target._id.toString(),
      targetNickname: null,
      firstPlaceBonus: false,
    };
  }

  await SessionPlayer.updateOne(
    { _id: target._id },
    [
      {
        $set: {
          score: {
            $max: [
              0,
              {
                $subtract: [{ $ifNull: ['$score', 0] }, amount],
              },
            ],
          },
        },
      },
    ],
    { updatePipeline: true }
  );

  ownerPlayer.score = (ownerPlayer.score || 0) + amount;

  return {
    amount,
    targetId: target._id.toString(),
    targetNickname: null,
    firstPlaceBonus: false,
  };
}

async function applyGiftCardsToPlayer(
  session,
  playerInput,
  cards,
  { commandId = null } = {}
) {
  /**
   * Always resolve the player from MongoDB so card effects are based on
   * authoritative state even if the caller holds an older document.
   */
  const player = await SessionPlayer.findById(
    playerInput instanceof SessionPlayer ? playerInput._id : playerInput
  );

  if (!player) {
    throw gameError(GAME_ERRORS.PARTICIPANT_NOT_FOUND, 'Participant not found', 404);
  }

  if (
    commandId &&
    (player.appliedCommandIds || []).includes(commandId.toString())
  ) {
    return {
      alreadyApplied: true,
      cards: cards.map((card) => card.id),
      score: player.score || 0,
      value: 0,
    };
  }

  const scoreBefore = player.score || 0;
  const effects = [];
  let value = 0;

  for (const card of cards) {
    switch (card.id) {
      case 'DOUBLE_POINTS': {
        const alreadyActive = Boolean(player.doublePointsActive);
        player.doublePointsActive = true;
        effects.push({
          card: card.id,
          applied: !alreadyActive,
          alreadyActive,
        });
        break;
      }
      case 'STREAK_SHIELD': {
        const alreadyActive = Boolean(player.streakShieldActive);
        player.streakShieldActive = true;
        effects.push({
          card: card.id,
          applied: !alreadyActive,
          alreadyActive,
        });
        break;
      }
      case 'POINTS_BONUS': {
        player.score = (player.score || 0) + POINTS_BONUS_POINTS;
        value += POINTS_BONUS_POINTS;
        effects.push({
          card: card.id,
          applied: true,
          points: POINTS_BONUS_POINTS,
        });
        break;
      }
      case 'COLOR_SHARDS': {
        player.colorShards = (player.colorShards || 0) + 1;
        const unlocked = [];

        while (player.colorShards >= COLOR_SHARDS_PER_UNLOCK) {
          const nextColor = AVATAR_COLOR_IDS.find(
            (color) => !(player.unlockedColors || []).includes(color)
          );

          if (!nextColor) {
            break;
          }

          player.unlockedColors = [...(player.unlockedColors || []), nextColor];
          player.colorShards -= COLOR_SHARDS_PER_UNLOCK;
          unlocked.push(nextColor);
        }

        effects.push({
          card: card.id,
          applied: true,
          shards: player.colorShards,
          unlockedColors: unlocked,
        });
        break;
      }
      case 'LEADERBOARD_STRIKE': {
        const strike = await applyLeaderboardStrike(session, player);
        value += strike.amount;
        effects.push({
          card: card.id,
          applied: true,
          amount: strike.amount,
          targetId: strike.targetId,
          firstPlaceBonus: strike.firstPlaceBonus,
        });
        break;
      }
      default:
        effects.push({ card: card.id, applied: false, reason: 'UNKNOWN_CARD' });
        break;
    }
  }

  player.giftsReceived = (player.giftsReceived || 0) + 1;
  player.lastGiftCards = cards.map((card) => card.id);

  if (commandId && !(player.appliedCommandIds || []).includes(commandId.toString())) {
    player.appliedCommandIds = [
      ...(player.appliedCommandIds || []),
      commandId.toString(),
    ];
  }

  await player.save();

  return {
    alreadyApplied: false,
    cards: cards.map((card) => card.id),
    cardDetails: cards.map((card) => ({
      id: card.id,
      name: card.name,
      rarity: card.rarity,
    })),
    effects,
    value,
    scoreBefore,
    scoreAfter: player.score || 0,
    colorShards: player.colorShards || 0,
    unlockedColors: player.unlockedColors || [],
  };
}

async function executeGiftCommand(session, command) {
  const existing = await SessionEvent.findOne({ dedupeKey: command.commandId });

  if (existing) {
    return {
      ...(existing.metadata || {}),
      alreadyApplied: true,
      value: existing.value || 0,
    };
  }

  const player = await SessionPlayer.findById(command.actor);

  if (!player || player.status === 'KICKED') {
    throw gameError(
      GAME_ERRORS.PARTICIPANT_NOT_FOUND,
      'Gift owner is no longer active',
      404
    );
  }

  const cards = drawGiftCards();
  const result = await applyGiftCardsToPlayer(session, player, cards, {
    commandId: command.commandId,
  });

  await recordCommandEvent(session, command, {
    targetId: null,
    value: result.value || 0,
    metadata: {
      ...command.metadata,
      cards: result.cardDetails || [],
      effects: result.effects || [],
      scoreBefore: result.scoreBefore,
      scoreAfter: result.scoreAfter,
      colorShards: result.colorShards,
      unlockedColors: result.unlockedColors,
    },
  });

  emit(playerRoom(player._id), 'gift:received', {
    sessionId: session._id.toString(),
    commandId: command.commandId,
    cards: result.cardDetails || [],
    effects: result.effects || [],
    score: result.scoreAfter,
    value: result.value || 0,
    colorShards: result.colorShards,
    unlockedColors: result.unlockedColors,
    serverTime: new Date(),
  });

  return result;
}

async function executeThiefCommand(session, command, target, options) {
  const targetScoreBefore = target.score || 0;
  const targetStreakBefore = target.streak || 0;
  const owner = await SessionPlayer.findById(command.actor);
  const ownerScoreBefore = owner?.score || 0;

  const reset = await SessionPlayer.updateOne(
    { _id: target._id, score: { $gt: 0 } },
    {
      $set: { score: 0, streak: 0 },
      $addToSet: { appliedCommandIds: command.commandId },
    }
  );

  if (reset.modifiedCount === 0) {
    return null;
  }

  await SessionPlayer.updateOne(
    {
      _id: command.actor,
      appliedCommandIds: { $ne: command.commandId },
    },
    {
      $inc: { score: targetScoreBefore },
      $addToSet: { appliedCommandIds: command.commandId },
    }
  );

  const ownerAfter = await SessionPlayer.findById(command.actor);
  const result = {
    targetId: target._id.toString(),
    targetNickname: target.nickname,
    value: targetScoreBefore,
    ownerScoreBefore,
    ownerScoreAfter: ownerAfter?.score || 0,
    targetScoreBefore,
    targetScoreAfter: 0,
    targetStreakBefore,
    targetStreakAfter: 0,
    autoSelected: Boolean(options.autoSelected),
    reason: options.reason || null,
  };

  await recordCommandEvent(session, command, {
    targetId: target._id,
    value: targetScoreBefore,
    metadata: {
      ...command.metadata,
      ...result,
      ownerId: command.actor.toString(),
    },
  });

  emit(sessionRoom(session._id), 'thief:result', {
    sessionId: session._id.toString(),
    commandId: command.commandId,
    actorId: command.actor.toString(),
    ...result,
    serverTime: new Date(),
  });

  return result;
}

async function executeRocketCommand(session, command, target, options) {
  const targetScoreBefore = target.score || 0;
  const targetStreakBefore = target.streak || 0;

  const reset = await SessionPlayer.updateOne(
    {
      _id: target._id,
      appliedCommandIds: { $ne: command.commandId },
    },
    {
      $set: { score: 0, streak: 0 },
      $addToSet: { appliedCommandIds: command.commandId },
    }
  );

  if (reset.modifiedCount === 0) {
    return null;
  }

  const result = {
    targetId: target._id.toString(),
    targetNickname: target.nickname,
    value: targetScoreBefore,
    ownerPointsAwarded: 0,
    targetScoreBefore,
    targetScoreAfter: 0,
    targetStreakBefore,
    targetStreakAfter: 0,
    autoSelected: Boolean(options.autoSelected),
    reason: options.reason || null,
  };

  await recordCommandEvent(session, command, {
    targetId: target._id,
    value: targetScoreBefore,
    metadata: {
      ...command.metadata,
      ...result,
      ownerId: command.actor.toString(),
    },
  });

  emit(sessionRoom(session._id), 'rocket:result', {
    sessionId: session._id.toString(),
    commandId: command.commandId,
    actorId: command.actor.toString(),
    ...result,
    serverTime: new Date(),
  });

  return result;
}

async function executeTargetCommand(
  session,
  commandInput,
  target,
  { autoSelected = false, reason = null } = {}
) {
  const requirePositiveScore = commandInput.type === 'THIEF';

  if (
    !isEligibleTarget(session, commandInput.actor, target, {
      requirePositiveScore,
    })
  ) {
    throw gameError(
      GAME_ERRORS.TARGET_INELIGIBLE,
      'The selected target is no longer eligible',
      409
    );
  }

  /**
   * A target command can be resolved either by the owner or by the
   * selection timeout. Atomically claim it first so the effect is applied
   * exactly once even if both paths fire at the same time.
   */
  const command = await SessionCommand.findOneAndUpdate(
    { _id: commandInput._id, status: 'AWAITING_TARGET' },
    { $set: { status: 'PROCESSING', target: target._id } },
    { new: true }
  );

  if (!command) {
    return null;
  }

  let result = null;

  if (command.type === 'THIEF') {
    result = await executeThiefCommand(session, command, target, {
      autoSelected,
      reason,
    });
  } else if (command.type === 'ROCKET') {
    result = await executeRocketCommand(session, command, target, {
      autoSelected,
      reason,
    });
  }

  if (!result) {
    await cancelCommand(session, command, 'NO_EFFECT');
    return null;
  }

  const completed = await markCommandCompleted(
    session,
    command,
    result,
    target._id
  );

  emit(sessionRoom(session._id), 'command:completed', {
    sessionId: session._id.toString(),
    command: serializeCommand(completed),
    result,
    serverTime: new Date(),
  });

  const leaderboard = await buildLeaderboardDocs(session._id);
  const ranked = leaderboard.map((player, index) => ({
    participantId: player._id.toString(),
    nickname: player.nickname,
    score: player.score || 0,
    streak: player.streak || 0,
    position: index + 1,
  }));

  emit(sessionRoom(session._id), 'leaderboard:updated', {
    sessionId: session._id.toString(),
    questionId: toId(command.question),
    index: command.questionIndex,
    leaderboard: ranked,
    reason: command.type,
    generatedAt: new Date(),
    phaseEndsAt: null,
    serverTime: new Date(),
  });

  return result;
}

async function handleSelectionTimeout(sessionId, commandId) {
  const command = await SessionCommand.findById(commandId);

  if (!command || command.status !== 'AWAITING_TARGET') {
    return;
  }

  const session = await Session.findById(sessionId);

  if (!session || session.status !== 'LIVE') {
    return;
  }

  if (toId(session.activeCommand) !== command._id.toString()) {
    return;
  }

  const requirePositiveScore = command.type === 'THIEF';
  const targets = await findEligibleTargets(session, command.actor, {
    requirePositiveScore,
  });

  if (targets.length === 0) {
    await cancelCommand(session, command, 'NO_ELIGIBLE_TARGET', {
      autoSelected: true,
    });
    await processQueue(session._id);
    return;
  }

  try {
    await executeTargetCommand(session, command, targets[0], {
      autoSelected: true,
      reason: 'TIMEOUT',
    });
  } catch (error) {
    await cancelCommand(session, command, error.code || 'TARGET_INELIGIBLE', {
      autoSelected: true,
      message: error.message,
    });
  }

  await processQueue(session._id);
}

async function selectTarget(participantId, targetParticipantId) {
  if (!mongoose.isValidObjectId(targetParticipantId)) {
    throw gameError(
      GAME_ERRORS.INVALID_PAYLOAD,
      'A valid targetParticipantId is required',
      400
    );
  }

  const participant = await SessionPlayer.findById(participantId);

  if (!participant) {
    throw gameError(GAME_ERRORS.PARTICIPANT_NOT_FOUND, 'Participant not found', 404);
  }

  const command = await SessionCommand.findOne({
    session: participant.session,
    actor: participant._id,
    status: 'AWAITING_TARGET',
  }).sort({ createdAt: 1 });

  if (!command) {
    throw gameError(
      GAME_ERRORS.COMMAND_NOT_ACTIVE,
      'You do not have an active command waiting for a target',
      409
    );
  }

  if (toId(command.actor) !== toId(participantId)) {
    throw gameError(GAME_ERRORS.NOT_COMMAND_OWNER, 'You do not own this command', 403);
  }

  if (toId(command.actor) === targetParticipantId.toString()) {
    throw gameError(GAME_ERRORS.INVALID_TARGET, 'You cannot target yourself', 400);
  }

  const session = await Session.findById(participant.session);

  if (!session || session.status !== 'LIVE') {
    throw gameError(GAME_ERRORS.GAME_NOT_ACTIVE, 'The game is not active', 409);
  }

  if (toId(session.activeCommand) !== command._id.toString()) {
    throw gameError(
      GAME_ERRORS.COMMAND_ALREADY_RESOLVED,
      'This command is no longer active',
      409
    );
  }

  const target = await SessionPlayer.findOne({
    _id: targetParticipantId,
    session: session._id,
  });

  if (!target) {
    throw gameError(GAME_ERRORS.TARGET_INELIGIBLE, 'Target not found', 409);
  }

  if (
    !isEligibleTarget(session, command.actor, target, {
      requirePositiveScore: command.type === 'THIEF',
    })
  ) {
    throw gameError(
      GAME_ERRORS.TARGET_INELIGIBLE,
      'The selected target is no longer eligible',
      409
    );
  }

  const result = await executeTargetCommand(session, command, target, {
    autoSelected: false,
    reason: 'OWNER_SELECTED',
  });

  if (!result) {
    throw gameError(
      GAME_ERRORS.COMMAND_ALREADY_RESOLVED,
      'This command has already been resolved',
      409
    );
  }

  await processQueue(session._id);

  return result;
}

async function startGiftCommand(session, command) {
  const now = new Date();
  const started = await SessionCommand.findOneAndUpdate(
    { _id: command._id, status: 'QUEUED' },
    {
      $set: {
        status: 'PROCESSING',
        startedAt: now,
      },
    },
    { new: true }
  );

  if (!started) {
    return null;
  }

  await Session.findOneAndUpdate(
    { _id: session._id, status: 'LIVE' },
    {
      $set: {
        activeCommand: started._id,
        gameState: 'GIFT',
        phaseStartedAt: now,
        phaseEndsAt: null,
        remainingTimeMs: null,
      },
    }
  );

  emit(sessionRoom(session._id), 'command:started', {
    sessionId: session._id.toString(),
    command: serializeCommand(started),
    actor: {
      participantId: toId(started.actor),
      nickname: command.metadata?.actorNickname || null,
    },
    serverTime: now,
  });

  return started;
}

async function startTargetCommand(session, command, targets) {
  const now = new Date();
  const selectionEndsAt = new Date(
    now.getTime() + COMMAND_SELECTION_TIMEOUT_MS
  );
  const started = await SessionCommand.findOneAndUpdate(
    { _id: command._id, status: 'QUEUED' },
    {
      $set: {
        status: 'AWAITING_TARGET',
        startedAt: now,
        selectionEndsAt,
        remainingSelectionMs: null,
      },
    },
    { new: true }
  );

  if (!started) {
    return null;
  }

  await Session.findOneAndUpdate(
    { _id: session._id, status: 'LIVE' },
    {
      $set: {
        activeCommand: started._id,
        gameState: started.type,
        phaseStartedAt: now,
        phaseEndsAt: null,
        remainingTimeMs: null,
      },
    }
  );

  emit(sessionRoom(session._id), 'command:started', {
    sessionId: session._id.toString(),
    command: serializeCommand(started),
    actor: {
      participantId: toId(started.actor),
      nickname: command.metadata?.actorNickname || null,
    },
    serverTime: now,
  });

  const targetPayload = {
    sessionId: session._id.toString(),
    commandId: started.commandId,
    type: started.type,
    actorId: toId(started.actor),
    questionId: toId(started.question),
    questionIndex: started.questionIndex,
    selectionEndsAt,
    timeoutMs: COMMAND_SELECTION_TIMEOUT_MS,
    targets: targets.map((target) => serializeTarget(target)),
    serverTime: now,
  };

  emit(playerRoom(started.actor), 'command:target-required', targetPayload);
  emit(teacherRoom(session._id), 'command:target-required', targetPayload);

  scheduleSelectionTimer(session._id, started.commandId, selectionEndsAt);

  return started;
}

async function processQueue(sessionId) {
  const key = sessionId.toString();

  if (processingSessions.has(key)) {
    return;
  }

  processingSessions.add(key);

  try {
    while (true) {
      const session = await Session.findById(sessionId);

      if (!session || session.status !== 'LIVE') {
        return;
      }

      const next = await SessionCommand.findOne({
        session: session._id,
        status: 'QUEUED',
      }).sort({ priority: 1, createdAt: 1, _id: 1 });

      if (!next) {
        await Session.updateOne(
          { _id: session._id, activeCommand: { $ne: null } },
          { $set: { activeCommand: null } }
        );
        emit(sessionRoom(session._id), 'commands:completed', {
          sessionId: session._id.toString(),
          questionIndex: session.currentQuestionIndex,
          serverTime: new Date(),
        });
        await engineHooks.advanceAfterCommands(session);
        return;
      }

      if (next.type === 'GIFT') {
        const started = await startGiftCommand(session, next);

        if (!started) {
          continue;
        }

        try {
          const result = await executeGiftCommand(session, started);
          const completed = await markCommandCompleted(
            session,
            started,
            result
          );

          emit(sessionRoom(session._id), 'command:completed', {
            sessionId: session._id.toString(),
            command: serializeCommand(completed),
            result: {
              cards: result.cardDetails || [],
              value: result.value || 0,
            },
            serverTime: new Date(),
          });
        } catch (error) {
          await cancelCommand(session, started, error.code || 'GIFT_FAILED', {
            message: error.message,
          });
        }

        continue;
      }

      const requirePositiveScore = next.type === 'THIEF';
      const targets = await findEligibleTargets(session, next.actor, {
        requirePositiveScore,
      });

      if (targets.length === 0) {
        await cancelCommand(session, next, 'NO_ELIGIBLE_TARGET');
        continue;
      }

      const started = await startTargetCommand(session, next, targets);

      if (!started) {
        continue;
      }

      return;
    }
  } finally {
    processingSessions.delete(key);
  }
}

async function pauseActiveCommand(session) {
  const command = await SessionCommand.findOne({
    session: session._id,
    status: 'AWAITING_TARGET',
  });

  if (!command) {
    return null;
  }

  const now = new Date();
  const remaining = command.selectionEndsAt
    ? Math.max(0, new Date(command.selectionEndsAt).getTime() - now.getTime())
    : command.remainingSelectionMs ?? COMMAND_SELECTION_TIMEOUT_MS;

  clearSelectionTimer(command.commandId);

  command.selectionEndsAt = null;
  command.remainingSelectionMs = remaining;
  await command.save();

  emit(sessionRoom(session._id), 'command:paused', {
    sessionId: session._id.toString(),
    command: serializeCommand(command),
    remainingSelectionMs: remaining,
    serverTime: now,
  });

  return command;
}

async function resumeActiveCommand(session) {
  const command = await SessionCommand.findOne({
    session: session._id,
    status: 'AWAITING_TARGET',
  });

  if (!command) {
    const queued = await SessionCommand.exists({
      session: session._id,
      status: { $in: ['QUEUED', 'PROCESSING'] },
    });

    if (queued) {
      await processQueue(session._id);
    }

    return null;
  }

  const now = new Date();
  const remaining =
    command.remainingSelectionMs ?? COMMAND_SELECTION_TIMEOUT_MS;
  const selectionEndsAt = new Date(now.getTime() + remaining);

  command.selectionEndsAt = selectionEndsAt;
  command.remainingSelectionMs = null;
  await command.save();

  scheduleSelectionTimer(session._id, command.commandId, selectionEndsAt);

  const targets = await findEligibleTargets(session, command.actor, {
    requirePositiveScore: command.type === 'THIEF',
  });

  emit(playerRoom(command.actor), 'command:target-required', {
    sessionId: session._id.toString(),
    commandId: command.commandId,
    type: command.type,
    actorId: toId(command.actor),
    questionId: toId(command.question),
    questionIndex: command.questionIndex,
    selectionEndsAt,
    timeoutMs: remaining,
    targets: targets.map((target) => serializeTarget(target)),
    serverTime: now,
  });

  emit(sessionRoom(session._id), 'command:resumed', {
    sessionId: session._id.toString(),
    command: serializeCommand(command),
    selectionEndsAt,
    remainingSelectionMs: remaining,
    serverTime: now,
  });

  return command;
}

async function recoverSession(session) {
  const active = await SessionCommand.findOne({
    session: session._id,
    status: { $in: ['AWAITING_TARGET', 'PROCESSING'] },
  }).sort({ createdAt: 1 });

  if (!active) {
    const queued = await SessionCommand.exists({
      session: session._id,
      status: 'QUEUED',
    });

    if (queued && session.status === 'LIVE') {
      await processQueue(session._id);
    }

    return null;
  }

  if (session.status === 'PAUSED') {
    clearSelectionTimer(active.commandId);

    if (
      active.status === 'AWAITING_TARGET' &&
      active.selectionEndsAt &&
      (active.remainingSelectionMs === null ||
        active.remainingSelectionMs === undefined)
    ) {
      active.remainingSelectionMs = Math.max(
        0,
        new Date(active.selectionEndsAt).getTime() - Date.now()
      );
      active.selectionEndsAt = null;
      await active.save();
    }

    return active;
  }

  if (active.status === 'PROCESSING') {
    if (active.type === 'GIFT') {
      try {
        const result = await executeGiftCommand(session, active);
        await markCommandCompleted(session, active, result);
      } catch (error) {
        await cancelCommand(session, active, error.code || 'GIFT_FAILED', {
          message: error.message,
        });
      }
    } else {
      await cancelCommand(session, active, 'COMMAND_INTERRUPTED');
    }

    await processQueue(session._id);
    return active;
  }

  if (active.status === 'AWAITING_TARGET') {
    const now = Date.now();
    const endsAt = active.selectionEndsAt
      ? new Date(active.selectionEndsAt).getTime()
      : now + (active.remainingSelectionMs ?? COMMAND_SELECTION_TIMEOUT_MS);

    if (endsAt <= now) {
      await handleSelectionTimeout(session._id, active._id);
    } else {
      active.selectionEndsAt = new Date(endsAt);
      active.remainingSelectionMs = null;
      await active.save();
      scheduleSelectionTimer(session._id, active.commandId, active.selectionEndsAt);
    }
  }

  return active;
}

async function forceResolve(session, reason = 'TEACHER_NEXT') {
  const active = await SessionCommand.findOne({
    session: session._id,
    status: { $in: ['AWAITING_TARGET', 'PROCESSING'] },
  }).sort({ createdAt: 1 });

  if (!active) {
    await processQueue(session._id);
    return null;
  }

  if (active.status === 'AWAITING_TARGET') {
    const targets = await findEligibleTargets(session, active.actor, {
      requirePositiveScore: active.type === 'THIEF',
    });

    if (targets.length === 0) {
      await cancelCommand(session, active, 'NO_ELIGIBLE_TARGET', {
        forcedBy: reason,
      });
      await processQueue(session._id);
      return null;
    }

    try {
      await executeTargetCommand(session, active, targets[0], {
        autoSelected: true,
        reason,
      });
    } catch (error) {
      await cancelCommand(session, active, error.code || 'TARGET_INELIGIBLE', {
        forcedBy: reason,
      });
    }

    await processQueue(session._id);
    return active;
  }

  await processQueue(session._id);
  return active;
}

async function cancelAllForSession(session, reason) {
  const commands = await SessionCommand.find({
    session: session._id,
    status: { $in: ['QUEUED', 'PROCESSING', 'AWAITING_TARGET'] },
  });

  for (const command of commands) {
    clearSelectionTimer(command.commandId);
    await cancelCommand(session, command, reason);
  }

  await Session.updateOne(
    { _id: session._id },
    { $set: { activeCommand: null } }
  );

  return commands.length;
}

async function cancelCommandsForTypes(session, types, reason) {
  if (!Array.isArray(types) || types.length === 0) {
    return 0;
  }

  const commands = await SessionCommand.find({
    session: session._id,
    type: { $in: types },
    status: { $in: ['QUEUED', 'PROCESSING', 'AWAITING_TARGET'] },
  });

  for (const command of commands) {
    clearSelectionTimer(command.commandId);
    await cancelCommand(session, command, reason);
  }

  if (commands.length > 0) {
    await Session.updateOne(
      { _id: session._id },
      { $set: { activeCommand: null } }
    );
  }

  return commands.length;
}

async function getActiveCommand(sessionId) {
  const command = await SessionCommand.findOne({
    session: sessionId,
    status: { $in: ['AWAITING_TARGET', 'PROCESSING'] },
  }).sort({ createdAt: 1 });

  return command;
}

async function getQueuedCommands(sessionId) {
  return SessionCommand.find({
    session: sessionId,
    status: 'QUEUED',
  }).sort({ priority: 1, createdAt: 1, _id: 1 });
}

module.exports = {
  init,
  drawGiftCards,
  isNukeUnlock,
  shouldActivateThief,
  commandKey,
  commandEnabled,
  serializeCommand,
  serializeTarget,
  findEligibleTargets,
  isEligibleTarget,
  enqueueForQuestion,
  processQueue,
  selectTarget,
  handleSelectionTimeout,
  pauseActiveCommand,
  resumeActiveCommand,
  recoverSession,
  forceResolve,
  cancelAllForSession,
  cancelCommandsForTypes,
  getActiveCommand,
  getQueuedCommands,
  applyGiftCardsToPlayer,
  applyLeaderboardStrike,
  executeGiftCommand,
  recordTeacherEvent,
  recordCommandEvent,
};
