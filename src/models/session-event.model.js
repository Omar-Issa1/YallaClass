const mongoose = require('mongoose');

const SESSION_EVENT_ACTOR_TYPES = ['PLAYER', 'TEACHER', 'SYSTEM'];

const sessionEventSchema = new mongoose.Schema(
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
    type: {
      type: String,
      required: true,
      trim: true,
      maxlength: 80,
      index: true,
    },
    actorType: {
      type: String,
      enum: SESSION_EVENT_ACTOR_TYPES,
      default: 'SYSTEM',
    },
    actorId: {
      type: mongoose.Schema.Types.ObjectId,
      default: null,
      index: true,
    },
    targetId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'SessionPlayer',
      default: null,
      index: true,
    },
    value: {
      type: Number,
      default: 0,
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
    timestamp: {
      type: Date,
      default: Date.now,
      index: true,
    },
    metadata: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
    dedupeKey: {
      type: String,
      default: null,
    },
  },
  { timestamps: true }
);

sessionEventSchema.index({ session: 1, timestamp: 1 });
sessionEventSchema.index({ session: 1, type: 1 });
sessionEventSchema.index(
  { dedupeKey: 1 },
  { unique: true, partialFilterExpression: { dedupeKey: { $type: 'string' } } }
);

const SessionEvent = mongoose.model('SessionEvent', sessionEventSchema);

module.exports = SessionEvent;
module.exports.SESSION_EVENT_ACTOR_TYPES = SESSION_EVENT_ACTOR_TYPES;
