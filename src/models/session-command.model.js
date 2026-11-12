const mongoose = require('mongoose');

const { COMMAND_TYPES, COMMAND_STATUSES } = require('../modules/game/game.constants');

const sessionCommandSchema = new mongoose.Schema(
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
    commandId: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    type: {
      type: String,
      enum: COMMAND_TYPES,
      required: true,
      index: true,
    },
    priority: {
      type: Number,
      required: true,
      min: 1,
    },
    actor: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'SessionPlayer',
      required: true,
      index: true,
    },
    target: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'SessionPlayer',
      default: null,
    },
    question: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Question',
      default: null,
    },
    questionIndex: {
      type: Number,
      default: -1,
    },
    status: {
      type: String,
      enum: COMMAND_STATUSES,
      default: 'QUEUED',
      index: true,
    },
    selectionEndsAt: {
      type: Date,
      default: null,
    },
    remainingSelectionMs: {
      type: Number,
      default: null,
      min: 0,
    },
    startedAt: {
      type: Date,
      default: null,
    },
    completedAt: {
      type: Date,
      default: null,
    },
    result: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
    metadata: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
    error: {
      type: String,
      default: null,
    },
  },
  { timestamps: true }
);

sessionCommandSchema.index({ session: 1, status: 1, priority: 1, createdAt: 1 });
sessionCommandSchema.index({ session: 1, type: 1, questionIndex: 1 });

const SessionCommand = mongoose.model('SessionCommand', sessionCommandSchema);

module.exports = SessionCommand;
module.exports.COMMAND_TYPES = COMMAND_TYPES;
module.exports.COMMAND_STATUSES = COMMAND_STATUSES;
