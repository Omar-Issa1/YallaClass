const mongoose = require('mongoose');

const {
  GAME_STATES,
  DEFAULT_PHASE_SETTINGS,
  DEFAULT_COMMAND_SETTINGS,
} = require('../modules/game/game.constants');

const SESSION_STATUSES = ['LOBBY', 'LIVE', 'PAUSED', 'FINISHED'];

const gameOptionSchema = new mongoose.Schema(
  {
    optionId: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
    },
    text: {
      type: String,
      required: true,
      trim: true,
      maxlength: 500,
    },
    isCorrect: {
      type: Boolean,
      default: false,
    },
  },
  { _id: false }
);

const gameQuestionSchema = new mongoose.Schema(
  {
    question: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Question',
      required: true,
    },
    text: {
      type: String,
      required: true,
      trim: true,
      maxlength: 1000,
    },
    points: {
      type: Number,
      required: true,
      min: 0,
      max: 10000,
    },
    timeLimitSec: {
      type: Number,
      required: true,
      min: 1,
      max: 120,
    },
    order: {
      type: Number,
      default: 0,
      min: 0,
    },
    explanation: {
      type: String,
      default: null,
      maxlength: 2000,
    },
    options: {
      type: [gameOptionSchema],
      default: [],
    },
  },
  { _id: false }
);

const commandSettingsSchema = new mongoose.Schema(
  {
    gift: {
      type: Boolean,
      default: DEFAULT_COMMAND_SETTINGS.gift,
    },
    thief: {
      type: Boolean,
      default: DEFAULT_COMMAND_SETTINGS.thief,
    },
    rocket: {
      type: Boolean,
      default: DEFAULT_COMMAND_SETTINGS.rocket,
    },
  },
  { _id: false }
);

const phaseSettingsSchema = new mongoose.Schema(
  {
    revealMs: {
      type: Number,
      default: DEFAULT_PHASE_SETTINGS.revealMs,
      min: 0,
      max: 600000,
    },
    explanationMs: {
      type: Number,
      default: DEFAULT_PHASE_SETTINGS.explanationMs,
      min: 0,
      max: 600000,
    },
    pointsMs: {
      type: Number,
      default: DEFAULT_PHASE_SETTINGS.pointsMs,
      min: 0,
      max: 600000,
    },
    leaderboardMs: {
      type: Number,
      default: DEFAULT_PHASE_SETTINGS.leaderboardMs,
      min: 0,
      max: 600000,
    },
    phoneLeaderboardMs: {
      type: Number,
      default: DEFAULT_PHASE_SETTINGS.phoneLeaderboardMs,
      min: 0,
      max: 600000,
    },
    showReveal: {
      type: Boolean,
      default: DEFAULT_PHASE_SETTINGS.showReveal,
    },
    showExplanation: {
      type: Boolean,
      default: DEFAULT_PHASE_SETTINGS.showExplanation,
    },
    showPoints: {
      type: Boolean,
      default: DEFAULT_PHASE_SETTINGS.showPoints,
    },
    showLeaderboard: {
      type: Boolean,
      default: DEFAULT_PHASE_SETTINGS.showLeaderboard,
    },
    showPhoneLeaderboard: {
      type: Boolean,
      default: DEFAULT_PHASE_SETTINGS.showPhoneLeaderboard,
    },
  },
  { _id: false }
);

const sessionSchema = new mongoose.Schema(
  {
    quiz: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Quiz',
      required: true,
      index: true,
    },
    organization: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Organization',
      required: true,
      index: true,
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    joinCode: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      uppercase: true,
      minlength: 6,
      maxlength: 6,
    },
    status: {
      type: String,
      enum: SESSION_STATUSES,
      default: 'LOBBY',
      index: true,
    },
    joinOpen: {
      type: Boolean,
      default: true,
    },
    startedAt: {
      type: Date,
      default: null,
    },
    endedAt: {
      type: Date,
      default: null,
    },
    gameState: {
      type: String,
      enum: GAME_STATES,
      default: 'IDLE',
      index: true,
    },
    gameQuestions: {
      type: [gameQuestionSchema],
      default: [],
    },
    currentQuestionIndex: {
      type: Number,
      default: -1,
    },
    phaseStartedAt: {
      type: Date,
      default: null,
    },
    phaseEndsAt: {
      type: Date,
      default: null,
    },
    remainingTimeMs: {
      type: Number,
      default: null,
      min: 0,
    },
    pausedAt: {
      type: Date,
      default: null,
    },
    commandSettings: {
      type: commandSettingsSchema,
      default: () => ({ ...DEFAULT_COMMAND_SETTINGS }),
    },
    phaseSettings: {
      type: phaseSettingsSchema,
      default: () => ({ ...DEFAULT_PHASE_SETTINGS }),
    },
    activeCommand: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'SessionCommand',
      default: null,
    },
    attendanceThreshold: {
      type: Number,
      default: 0.5,
      min: 0,
      max: 1,
    },
    attendanceFinalizedAt: {
      type: Date,
      default: null,
    },
  },
  { timestamps: true }
);

sessionSchema.index({ organization: 1, status: 1, createdAt: -1 });
sessionSchema.index({ status: 1, gameState: 1 });

const Session = mongoose.model('Session', sessionSchema);

module.exports = Session;
module.exports.SESSION_STATUSES = SESSION_STATUSES;
module.exports.GAME_STATES = GAME_STATES;
