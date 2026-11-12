const Organization = require('../../models/organization.model');
const User = require('../../models/user.model');
const AppError = require('../../utils/app-error');
const { serializeUser } = require('../../utils/serializers');
const { signAccessToken } = require('../../utils/token');

async function login({ email, password }) {
  const user = await User.findOne({ email }).select('+passwordHash');

  if (!user) {
    throw new AppError('Invalid email or password', 401);
  }

  const passwordMatches = await user.comparePassword(password);

  if (!passwordMatches) {
    throw new AppError('Invalid email or password', 401);
  }

  if (user.status === 'SUSPENDED') {
    throw new AppError('Your account has been suspended', 403);
  }

  if (user.organization) {
    const organization = await Organization.findById(user.organization).select('status');

    if (!organization) {
      throw new AppError('Your organization is no longer available', 403);
    }

    if (organization.status === 'SUSPENDED') {
      throw new AppError('Your organization has been suspended', 403);
    }
  }

  return {
    token: signAccessToken(user),
    user: serializeUser(user),
  };
}

module.exports = { login };
