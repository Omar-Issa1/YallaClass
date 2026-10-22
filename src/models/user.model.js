const mongoose = require('mongoose');

const { verifyPassword } = require('../utils/password');

const ROLES = ['OWNER', 'TEACHER', 'ASSISTANT', 'ADMIN'];
const STATUSES = ['ACTIVE', 'SUSPENDED'];

const userSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
      maxlength: 80,
    },
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
      match: [/^\S+@\S+\.\S+$/, 'Please provide a valid email address'],
    },
    passwordHash: {
      type: String,
      required: true,
      select: false,
    },
    role: {
      type: String,
      enum: ROLES,
      required: true,
    },
    organization: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Organization',
      default: null,
      index: true,
    },
    status: {
      type: String,
      enum: STATUSES,
      default: 'ACTIVE',
    },
    avatar: {
      type: String,
      trim: true,
      default: '',
      maxlength: 500,
    },
  },
  { timestamps: true }
);

userSchema.index({ role: 1 });

userSchema.methods.comparePassword = function comparePassword(candidatePassword) {
  return verifyPassword(candidatePassword, this.passwordHash);
};

userSchema.set('toJSON', {
  transform: (document, returned) => {
    delete returned.passwordHash;
    delete returned.__v;
    return returned;
  },
});

const User = mongoose.model('User', userSchema);

module.exports = User;
module.exports.ROLES = ROLES;
module.exports.STATUSES = STATUSES;
