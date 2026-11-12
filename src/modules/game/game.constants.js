const env = require('../../config/env');

const GAME_STATES = [
  'IDLE',
  'COUNTDOWN',
  'QUESTION',
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

const PHASE_DURATIONS = {
  COUNTDOWN: env.GAME_COUNTDOWN_MS,
  REVEAL: env.GAME_REVEAL_MS,
  EXPLANATION: env.GAME_EXPLANATION_MS,
  POINTS: env.GAME_POINTS_MS,
  LEADERBOARD: env.GAME_LEADERBOARD_MS,
  PHONE_LEADERBOARD: env.GAME_PHONE_LEADERBOARD_MS,
};

const DEFAULT_PHASE_SETTINGS = {
  revealMs: env.GAME_REVEAL_MS,
  explanationMs: env.GAME_EXPLANATION_MS,
  pointsMs: env.GAME_POINTS_MS,
  leaderboardMs: env.GAME_LEADERBOARD_MS,
  phoneLeaderboardMs: env.GAME_PHONE_LEADERBOARD_MS,
  showReveal: true,
  showExplanation: true,
  showPoints: true,
  showLeaderboard: true,
  showPhoneLeaderboard: true,
};

/**
 * Commands are opt-in per session. This keeps existing Phase 5 sessions
 * deterministic until a teacher explicitly enables a command.
 */
const DEFAULT_COMMAND_SETTINGS = {
  gift: false,
  thief: false,
  rocket: false,
};

const COMMAND_TYPES = ['GIFT', 'THIEF', 'ROCKET'];
const COMMAND_PRIORITIES = {
  GIFT: 1,
  THIEF: 2,
  ROCKET: 3,
};
const COMMAND_STATUSES = [
  'QUEUED',
  'PROCESSING',
  'AWAITING_TARGET',
  'COMPLETED',
  'CANCELLED',
];

const COMMAND_SELECTION_TIMEOUT_MS = env.COMMAND_SELECTION_TIMEOUT_MS;
const THIEF_ACTIVATION_CHANCE = env.COMMAND_THIEF_CHANCE;
const THIEF_UNLOCK_STREAK = 1;
const GIFT_UNLOCK_STREAK = 2;
const ROCKET_UNLOCK_MULTIPLE = 5;
const GIFT_DRAW_COUNT = 3;
const COLOR_SHARDS_PER_UNLOCK = 3;
const POINTS_BONUS_POINTS = 100;
const LEADERBOARD_STRIKE_POINTS = 100;

const CARD_RARITIES = {
  COMMON: 'COMMON',
  UNCOMMON: 'UNCOMMON',
  RARE: 'RARE',
};

/**
 * Card rarity is independent per card: each card owns a rarity and a draw
 * weight. Cards are drawn without replacement from the weighted pool.
 */
const GIFT_CARDS = [
  {
    id: 'DOUBLE_POINTS',
    name: 'Double Points',
    rarity: CARD_RARITIES.COMMON,
    weight: 35,
    description: 'Doubles the points of the next answered question, then is consumed.',
  },
  {
    id: 'STREAK_SHIELD',
    name: 'Streak Shield',
    rarity: CARD_RARITIES.UNCOMMON,
    weight: 25,
    description: 'Protects the streak from one incorrect answer.',
  },
  {
    id: 'LEADERBOARD_STRIKE',
    name: 'Leaderboard Strike',
    rarity: CARD_RARITIES.RARE,
    weight: 10,
    description:
      'Steals points from the player immediately above; first place receives a bonus instead.',
  },
  {
    id: 'POINTS_BONUS',
    name: 'Points Bonus',
    rarity: CARD_RARITIES.COMMON,
    weight: 35,
    description: 'Grants instant bonus points.',
  },
  {
    id: 'COLOR_SHARDS',
    name: 'Color Shards',
    rarity: CARD_RARITIES.UNCOMMON,
    weight: 20,
    description: 'Adds a shard and unlocks a color every three shards.',
  },
];

const GAME_ERRORS = {
  UNAUTHORIZED: 'UNAUTHORIZED',
  FORBIDDEN: 'FORBIDDEN',
  SESSION_NOT_FOUND: 'SESSION_NOT_FOUND',
  PARTICIPANT_NOT_FOUND: 'PARTICIPANT_NOT_FOUND',
  PARTICIPANT_KICKED: 'PARTICIPANT_KICKED',
  INVALID_PARTICIPANT_TOKEN: 'INVALID_PARTICIPANT_TOKEN',
  GAME_NOT_ACTIVE: 'GAME_NOT_ACTIVE',
  GAME_ALREADY_STARTED: 'GAME_ALREADY_STARTED',
  INVALID_GAME_STATE: 'INVALID_GAME_STATE',
  NO_ACTIVE_QUESTION: 'NO_ACTIVE_QUESTION',
  QUESTION_MISMATCH: 'QUESTION_MISMATCH',
  INVALID_OPTION: 'INVALID_OPTION',
  DEADLINE_PASSED: 'DEADLINE_PASSED',
  ALREADY_ANSWERED: 'ALREADY_ANSWERED',
  INVALID_PAYLOAD: 'INVALID_PAYLOAD',
  COMMAND_DISABLED: 'COMMAND_DISABLED',
  COMMAND_NOT_ACTIVE: 'COMMAND_NOT_ACTIVE',
  COMMAND_NOT_FOUND: 'COMMAND_NOT_FOUND',
  COMMAND_ALREADY_RESOLVED: 'COMMAND_ALREADY_RESOLVED',
  NOT_COMMAND_OWNER: 'NOT_COMMAND_OWNER',
  INVALID_TARGET: 'INVALID_TARGET',
  TARGET_INELIGIBLE: 'TARGET_INELIGIBLE',
  NO_ELIGIBLE_TARGET: 'NO_ELIGIBLE_TARGET',
  PHASE_NOT_CONTROLLABLE: 'PHASE_NOT_CONTROLLABLE',
};

module.exports = {
  GAME_STATES,
  PHASE_DURATIONS,
  DEFAULT_PHASE_SETTINGS,
  DEFAULT_COMMAND_SETTINGS,
  COMMAND_TYPES,
  COMMAND_PRIORITIES,
  COMMAND_STATUSES,
  COMMAND_SELECTION_TIMEOUT_MS,
  THIEF_ACTIVATION_CHANCE,
  THIEF_UNLOCK_STREAK,
  GIFT_UNLOCK_STREAK,
  ROCKET_UNLOCK_MULTIPLE,
  GIFT_DRAW_COUNT,
  COLOR_SHARDS_PER_UNLOCK,
  POINTS_BONUS_POINTS,
  LEADERBOARD_STRIKE_POINTS,
  CARD_RARITIES,
  GIFT_CARDS,
  GAME_ERRORS,
};
