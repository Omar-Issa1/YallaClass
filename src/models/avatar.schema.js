const mongoose = require('mongoose');

const {
  AVATAR_PRESET_IDS,
  AVATAR_COLOR_IDS,
  DEFAULT_AVATAR,
} = require('../constants/avatar');

const avatarSchema = new mongoose.Schema(
  {
    preset: {
      type: String,
      enum: AVATAR_PRESET_IDS,
      default: DEFAULT_AVATAR.preset,
    },
    color: {
      type: String,
      enum: AVATAR_COLOR_IDS,
      default: DEFAULT_AVATAR.color,
    },
  },
  { _id: false }
);

module.exports = avatarSchema;
