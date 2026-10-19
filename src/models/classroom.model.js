const mongoose = require('mongoose');

const classroomSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
    },
    teacher: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
  },
  { timestamps: true }
);

classroomSchema.index({ teacher: 1, name: 1 }, { unique: true });

module.exports = mongoose.model('Classroom', classroomSchema);
