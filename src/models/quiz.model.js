const mongoose = require('mongoose');

const QUIZ_STATUSES = ['ACTIVE', 'ARCHIVED'];

const quizSchema = new mongoose.Schema(
  {
    title: {
      type: String,
      required: true,
      trim: true,
      maxlength: 150,
    },
    description: {
      type: String,
      trim: true,
      default: '',
      maxlength: 1000,
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
    status: {
      type: String,
      enum: QUIZ_STATUSES,
      default: 'ACTIVE',
      index: true,
    },
    archivedAt: {
      type: Date,
      default: null,
    },
  },
  { timestamps: true }
);

quizSchema.index({ organization: 1, status: 1, updatedAt: -1 });

const Quiz = mongoose.model('Quiz', quizSchema);

module.exports = Quiz;
module.exports.QUIZ_STATUSES = QUIZ_STATUSES;
