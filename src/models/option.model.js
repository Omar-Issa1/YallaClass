const mongoose = require('mongoose');

const optionSchema = new mongoose.Schema({
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
});

module.exports = optionSchema;
