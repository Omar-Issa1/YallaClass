const mongoose = require('mongoose');

const avatarSchema = require('./avatar.schema');

const PARTICIPANT_STATUSES = ['ACTIVE', 'KICKED'];

const sessionPlayerSchema = new mongoose.Schema(
  {
    session: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Session',
      required: true,
      index: true,
    },
    organization: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Organization',
      required: true,
      index: true,
    },
    student: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Student',
      default: null,
    },
    section: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Section',
      default: null,
    },
    name: {
      type: String,
      required: true,
      trim: true,
      maxlength: 80,
    },
    nickname: {
      type: String,
      required: true,
      trim: true,
      maxlength: 50,
    },
    nicknameKey: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
      maxlength: 50,
      select: false,
    },
    avatar: {
      type: avatarSchema,
      default: () => ({}),
    },
    tokenHash: {
      type: String,
      required: true,
      unique: true,
      select: false,
    },
    status: {
      type: String,
      enum: PARTICIPANT_STATUSES,
      default: 'ACTIVE',
      index: true,
    },
    score: {
      type: Number,
      default: 0,
      min: 0,
    },
    // Academic score: sum of the configured base points of correctly answered
    // questions. Gameplay bonuses and commands never touch this field.
    rawScore: {
      type: Number,
      default: 0,
      min: 0,
    },
    streak: {
      type: Number,
      default: 0,
      min: 0,
    },
    bestStreak: {
      type: Number,
      default: 0,
      min: 0,
    },
    answeredCount: {
      type: Number,
      default: 0,
      min: 0,
    },
    correctCount: {
      type: Number,
      default: 0,
      min: 0,
    },
    totalResponseTimeMs: {
      type: Number,
      default: 0,
      min: 0,
    },
    answeredQuestions: {
      type: [
        {
          type: mongoose.Schema.Types.ObjectId,
          ref: 'Question',
        },
      ],
      default: [],
    },
    doublePointsActive: {
      type: Boolean,
      default: false,
    },
    streakShieldActive: {
      type: Boolean,
      default: false,
    },
    colorShards: {
      type: Number,
      default: 0,
      min: 0,
    },
    unlockedColors: {
      type: [String],
      default: [],
    },
    giftsReceived: {
      type: Number,
      default: 0,
      min: 0,
    },
    lastGiftCards: {
      type: [String],
      default: [],
    },
    appliedCommandIds: {
      type: [String],
      default: [],
    },
    connected: {
      type: Boolean,
      default: false,
    },
    connectionCount: {
      type: Number,
      default: 0,
      min: 0,
    },
    lastConnectedQuestionIndex: {
      type: Number,
      default: null,
    },
    offlineSinceQuestionIndex: {
      type: Number,
      default: null,
    },
    lastConnectedAt: {
      type: Date,
      default: null,
    },
    lastDisconnectedAt: {
      type: Date,
      default: null,
    },
    lastAnswerAt: {
      type: Date,
      default: null,
    },
    finalRank: {
      type: Number,
      default: null,
      min: 1,
    },
    joinedAt: {
      type: Date,
      default: Date.now,
    },
    lastSeenAt: {
      type: Date,
      default: Date.now,
    },
    kickedAt: {
      type: Date,
      default: null,
    },
  },
  { timestamps: true }
);

sessionPlayerSchema.index({ session: 1, nicknameKey: 1 }, { unique: true });
sessionPlayerSchema.index(
  { session: 1, student: 1 },
  { unique: true, partialFilterExpression: { student: { $type: 'objectId' } } }
);
sessionPlayerSchema.index({ session: 1, status: 1, joinedAt: 1 });

const SessionPlayer = mongoose.model('SessionPlayer', sessionPlayerSchema);

module.exports = SessionPlayer;
module.exports.PARTICIPANT_STATUSES = PARTICIPANT_STATUSES;
