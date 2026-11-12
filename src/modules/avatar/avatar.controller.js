const { sendSuccess } = require('../../utils/api-response');
const {
  AVATAR_PRESETS,
  AVATAR_COLORS,
  DEFAULT_AVATAR,
} = require('../../constants/avatar');

async function getAvatarOptions(req, res) {
  return sendSuccess(res, {
    message: 'Avatar options retrieved successfully',
    data: {
      presets: AVATAR_PRESETS,
      colors: AVATAR_COLORS,
      default: DEFAULT_AVATAR,
    },
  });
}

module.exports = { getAvatarOptions };
