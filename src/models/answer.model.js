const mongoose = require('mongoose');

const answerSchema = new mongoose.Schema(
  {
    sessionPlayer: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'SessionPlayer',
      required: true,
    },
    question: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Question',
      required: true,
    },
    selectedOptionId: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
    },
    isCorrect: {
      type: Boolean,
      required: true,
    },
  },
  { timestamps: true }
);

answerSchema.index({ sessionPlayer: 1, question: 1 }, { unique: true });
answerSchema.index({ question: 1 });

module.exports = mongoose.model('Answer', answerSchema);
