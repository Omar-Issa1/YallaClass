const Organization = require('../../models/organization.model');
const User = require('../../models/user.model');
const AppError = require('../../utils/app-error');
const { hashPassword } = require('../../utils/password');
const {
  serializeOrganization,
  serializeUser,
} = require('../../utils/serializers');
const { signAccessToken } = require('../../utils/token');

async function register({ name, email, password, organizationName }) {
  const existingUser = await User.exists({ email });

  if (existingUser) {
    throw new AppError('Email is already registered', 409);
  }

  const passwordHash = await hashPassword(password);

  let user;
  let organization;

  try {
    user = await User.create({
      name,
      email,
      passwordHash,
      role: 'OWNER',
      status: 'ACTIVE',
    });

    organization = await Organization.create({
      name: organizationName,
      owner: user._id,
    });

    user.organization = organization._id;
    await user.save();
  } catch (error) {
    if (organization) {
      await Organization.deleteOne({ _id: organization._id }).catch(() => {});
    }

    if (user) {
      await User.deleteOne({ _id: user._id }).catch(() => {});
    }

    throw error;
  }

  return {
    token: signAccessToken(user),
    user: serializeUser(user),
    organization: serializeOrganization(organization),
  };
}

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

  return {
    token: signAccessToken(user),
    user: serializeUser(user),
  };
}

module.exports = { register, login };
