const mongoose = require('mongoose');

const optionSchema = require('./option.model');

const questionSchema = new mongoose.Schema(
  {
    quiz: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Quiz',
      required: true,
    },
    text: {
      type: String,
      required: true,
      trim: true,
    },
    points: {
      type: Number,
      default: 1000,
      min: 0,
    },
    timeLimitSec: {
      type: Number,
      default: 10,
      min: 5,
      max: 120,
    },
    options: {
      type: [optionSchema],
      validate: {
        validator: (options) => options.length >= 2 && options.length <= 4,
        message: 'A question must have between 2 and 4 options',
      },
    },
  },
  { timestamps: true }
);

questionSchema.index({ quiz: 1 });

module.exports = mongoose.model('Question', questionSchema);
