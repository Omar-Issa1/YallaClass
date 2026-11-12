const { DEFAULT_AVATAR } = require('../../constants/avatar');

function toId(value) {
  if (!value) {
    return null;
  }

  return value._id ? value._id.toString() : value.toString();
}

function serializeGameOption(option, { includeCorrect = false } = {}) {
  const serialized = {
    id: toId(option.optionId),
    text: option.text,
  };

  if (includeCorrect) {
    serialized.isCorrect = Boolean(option.isCorrect);
  }

  return serialized;
}

function serializeGameQuestion(question, { includeCorrect = false } = {}) {
  if (!question) {
    return null;
  }

  return {
    id: toId(question.question),
    text: question.text,
    points: question.points,
    timeLimitSec: question.timeLimitSec,
    order: question.order,
    options: (question.options || []).map((option) =>
      serializeGameOption(option, { includeCorrect })
    ),
  };
}

function serializeLeaderboardEntry(player, { rank, position }) {
  return {
    rank,
    position,
    participantId: toId(player._id),
    nickname: player.nickname,
    name: player.name,
    avatar: {
      preset: player.avatar?.preset || DEFAULT_AVATAR.preset,
      color: player.avatar?.color || DEFAULT_AVATAR.color,
    },
    score: player.score || 0,
    streak: player.streak || 0,
    bestStreak: player.bestStreak || 0,
    answeredCount: player.answeredCount || 0,
    correctCount: player.correctCount || 0,
    totalResponseTimeMs: player.totalResponseTimeMs || 0,
  };
}

module.exports = {
  serializeGameQuestion,
  serializeLeaderboardEntry,
};
