const mongoose = require('mongoose');

const answerSchema = new mongoose.Schema(
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
    sessionPlayer: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'SessionPlayer',
      required: true,
      index: true,
    },
    question: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Question',
      required: true,
      index: true,
    },
    selectedOptionId: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
    },
    isCorrect: {
      type: Boolean,
      required: true,
    },
    responseTimeMs: {
      type: Number,
      required: true,
      min: 0,
    },
    pointsAwarded: {
      type: Number,
      required: true,
      min: 0,
      default: 0,
    },
    basePointsAwarded: {
      type: Number,
      default: 0,
      min: 0,
    },
    // Full configured question points for a correct answer, zero otherwise.
    // Unlike `basePointsAwarded`, this is not reduced by response speed.
    rawScoreAwarded: {
      type: Number,
      default: 0,
      min: 0,
    },
    doublePointsApplied: {
      type: Boolean,
      default: false,
    },
    streakShieldApplied: {
      type: Boolean,
      default: false,
    },
    streakAfter: {
      type: Number,
      default: 0,
      min: 0,
    },
    applied: {
      type: Boolean,
      default: false,
      index: true,
    },
    submittedAt: {
      type: Date,
      default: Date.now,
    },
  },
  { timestamps: true }
);

answerSchema.index({ sessionPlayer: 1, question: 1 }, { unique: true });
answerSchema.index({ session: 1, question: 1 });
answerSchema.index({ session: 1, applied: 1 });

module.exports = mongoose.model('Answer', answerSchema);
