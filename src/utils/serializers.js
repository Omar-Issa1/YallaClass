const { DEFAULT_AVATAR } = require('../constants/avatar');
const {
  DEFAULT_COMMAND_SETTINGS,
  DEFAULT_PHASE_SETTINGS,
} = require('../modules/game/game.constants');
const { buildJoinUrl } = require('./session-code');

function toId(value) {
  if (!value) {
    return null;
  }

  return value._id ? value._id.toString() : value.toString();
}

function toPlainObject(value, fallback = {}) {
  if (!value) {
    return { ...fallback };
  }

  return value.toObject ? value.toObject() : { ...value };
}

function serializeUser(user) {
  return {
    id: user._id.toString(),
    name: user.name,
    email: user.email,
    role: user.role,
    status: user.status,
    organization: toId(user.organization),
    avatar: user.avatar || '',
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
  };
}

function serializeOrganization(organization) {
  return {
    id: organization._id.toString(),
    name: organization.name,
    owner: toId(organization.owner),
    status: organization.status || 'ACTIVE',
    createdAt: organization.createdAt,
    updatedAt: organization.updatedAt,
  };
}

function serializeSection(section, studentCount = 0) {
  return {
    id: section._id.toString(),
    name: section.name,
    description: section.description || '',
    organization: toId(section.organization),
    createdBy: toId(section.createdBy),
    studentCount,
    createdAt: section.createdAt,
    updatedAt: section.updatedAt,
  };
}

function serializeStudent(student) {
  return {
    id: student._id.toString(),
    name: student.name,
    nickname: student.nickname || '',
    organization: toId(student.organization),
    section: toId(student.section),
    avatar: {
      preset: student.avatar?.preset || DEFAULT_AVATAR.preset,
      color: student.avatar?.color || DEFAULT_AVATAR.color,
    },
    createdAt: student.createdAt,
    updatedAt: student.updatedAt,
  };
}

function serializeSession(
  session,
  { quiz = null, participantCount = 0, questionCount = 0, estimatedDurationSec = 0 } = {}
) {
  const totalQuestions = session.gameQuestions?.length || 0;
  const currentQuestionIndex = session.currentQuestionIndex ?? -1;

  return {
    id: session._id.toString(),
    quiz: {
      id: toId(session.quiz),
      title: quiz?.title || '',
      description: quiz?.description || '',
      questionCount,
      estimatedDurationSec,
    },
    organization: toId(session.organization),
    createdBy: toId(session.createdBy),
    joinCode: session.joinCode,
    joinUrl: buildJoinUrl(session.joinCode),
    status: session.status,
    joinOpen: session.joinOpen,
    gameState: session.gameState || 'IDLE',
    currentQuestionIndex,
    totalQuestions,
    questionProgress: {
      current: currentQuestionIndex >= 0 ? currentQuestionIndex + 1 : 0,
      total: totalQuestions,
    },
    phaseStartedAt: session.phaseStartedAt || null,
    phaseEndsAt: session.phaseEndsAt || null,
    remainingTimeMs: session.remainingTimeMs ?? null,
    commandSettings: toPlainObject(
      session.commandSettings,
      DEFAULT_COMMAND_SETTINGS
    ),
    phaseSettings: toPlainObject(session.phaseSettings, DEFAULT_PHASE_SETTINGS),
    activeCommand: toId(session.activeCommand),
    participantCount,
    startedAt: session.startedAt,
    endedAt: session.endedAt,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
  };
}

function serializePublicSession(
  session,
  { quiz = null, participantCount = 0, questionCount = 0, estimatedDurationSec = 0 } = {}
) {
  return {
    joinCode: session.joinCode,
    joinUrl: buildJoinUrl(session.joinCode),
    status: session.status,
    joinOpen: session.joinOpen,
    quiz: {
      title: quiz?.title || '',
      questionCount,
      estimatedDurationSec,
    },
    participantCount,
    startedAt: session.startedAt,
    endedAt: session.endedAt,
  };
}

function serializeParticipant(participant, { participantToken } = {}) {
  const serialized = {
    id: participant._id.toString(),
    name: participant.name,
    nickname: participant.nickname,
    student: toId(participant.student),
    section: toId(participant.section),
    avatar: {
      preset: participant.avatar?.preset || DEFAULT_AVATAR.preset,
      color: participant.avatar?.color || DEFAULT_AVATAR.color,
    },
    status: participant.status,
    score: participant.score,
    streak: participant.streak || 0,
    bestStreak: participant.bestStreak || 0,
    answeredCount: participant.answeredCount || 0,
    correctCount: participant.correctCount || 0,
    totalResponseTimeMs: participant.totalResponseTimeMs || 0,
    connected: Boolean(participant.connected),
    doublePointsActive: Boolean(participant.doublePointsActive),
    streakShieldActive: Boolean(participant.streakShieldActive),
    colorShards: participant.colorShards || 0,
    unlockedColors: participant.unlockedColors || [],
    giftsReceived: participant.giftsReceived || 0,
    lastGiftCards: participant.lastGiftCards || [],
    finalRank: participant.finalRank ?? null,
    joinedAt: participant.joinedAt,
    lastSeenAt: participant.lastSeenAt,
    kickedAt: participant.kickedAt,
  };

  if (participantToken) {
    serialized.participantToken = participantToken;
  }

  return serialized;
}

function serializePublicParticipant(participant, { participantToken } = {}) {
  const serialized = {
    id: participant._id.toString(),
    name: participant.name,
    nickname: participant.nickname,
    section: toId(participant.section),
    avatar: {
      preset: participant.avatar?.preset || DEFAULT_AVATAR.preset,
      color: participant.avatar?.color || DEFAULT_AVATAR.color,
    },
    joinedAt: participant.joinedAt,
    lastSeenAt: participant.lastSeenAt,
  };

  if (participantToken) {
    serialized.participantToken = participantToken;
  }

  return serialized;
}

module.exports = {
  serializeUser,
  serializeOrganization,
  serializeSection,
  serializeStudent,
  serializeSession,
  serializePublicSession,
  serializeParticipant,
  serializePublicParticipant,
};
