const mongoose = require('mongoose');

const avatarSchema = require('./avatar.schema');

const studentSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
      maxlength: 80,
    },
    nickname: {
      type: String,
      trim: true,
      maxlength: 50,
      default: '',
    },
    organization: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Organization',
      required: true,
      index: true,
    },
    section: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Section',
      required: true,
      index: true,
    },
    avatar: {
      type: avatarSchema,
      default: () => ({}),
    },
  },
  { timestamps: true }
);

studentSchema.index({ organization: 1, section: 1, name: 1 });
studentSchema.index({ organization: 1, name: 1 });

module.exports = mongoose.model('Student', studentSchema);
