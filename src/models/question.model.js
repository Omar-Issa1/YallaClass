const mongoose = require('mongoose');

const optionSchema = require('./option.model');

const questionSchema = new mongoose.Schema(
  {
    quiz: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Quiz',
      required: true,
      index: true,
    },
    text: {
      type: String,
      required: true,
      trim: true,
      maxlength: 1000,
    },
    points: {
      type: Number,
      default: 1000,
      min: 0,
      max: 10000,
    },
    timeLimitSec: {
      type: Number,
      default: 10,
      min: 5,
      max: 120,
    },
    order: {
      type: Number,
      default: 0,
      min: 0,
    },
    options: {
      type: [optionSchema],
      validate: [
        {
          validator: (options) => options.length >= 2 && options.length <= 4,
          message: 'A question must have between 2 and 4 options',
        },
        {
          validator: (options) => options.filter((option) => option.isCorrect).length === 1,
          message: 'Exactly one option must be marked as correct',
        },
      ],
    },
  },
  { timestamps: true }
);

questionSchema.index({ quiz: 1, order: 1 });

module.exports = mongoose.model('Question', questionSchema);
