const mongoose = require('mongoose');

const sessionPlayerSchema = new mongoose.Schema(
  {
    session: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Session',
      required: true,
    },
    nickname: {
      type: String,
      required: true,
      trim: true,
    },
    score: {
      type: Number,
      default: 0,
      min: 0,
    },
  },
  { timestamps: true }
);

sessionPlayerSchema.index({ session: 1, nickname: 1 }, { unique: true });

module.exports = mongoose.model('SessionPlayer', sessionPlayerSchema);
