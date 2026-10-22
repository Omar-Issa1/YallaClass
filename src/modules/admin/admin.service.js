const Organization = require('../../models/organization.model');
const User = require('../../models/user.model');
const AppError = require('../../utils/app-error');
const { serializeUser } = require('../../utils/serializers');

async function listUsers() {
  const users = await User.find().sort({ createdAt: -1 });

  return users.map(serializeUser);
}

async function getUser(userId) {
  const user = await User.findById(userId);

  if (!user) {
    throw new AppError('User not found', 404);
  }

  return serializeUser(user);
}

async function updateUserStatus(adminUser, userId, status) {
  if (adminUser._id.toString() === userId) {
    throw new AppError('You cannot change your own account status', 400);
  }

  const user = await User.findById(userId);

  if (!user) {
    throw new AppError('User not found', 404);
  }

  user.status = status;
  await user.save();

  return serializeUser(user);
}

function serializeOwner(owner) {
  if (!owner) {
    return null;
  }

  return {
    id: owner._id.toString(),
    name: owner.name,
    email: owner.email,
  };
}

async function listOrganizations() {
  const organizations = await Organization.find()
    .populate('owner', 'name email')
    .sort({ createdAt: -1 })
    .lean();

  const memberCounts = await User.aggregate([
    { $match: { organization: { $ne: null } } },
    { $group: { _id: '$organization', count: { $sum: 1 } } },
  ]);

  const countByOrganizationId = new Map(
    memberCounts.map((item) => [item._id.toString(), item.count])
  );

  return organizations.map((organization) => ({
    id: organization._id.toString(),
    name: organization.name,
    owner: serializeOwner(organization.owner),
    memberCount: countByOrganizationId.get(organization._id.toString()) || 0,
    createdAt: organization.createdAt,
    updatedAt: organization.updatedAt,
  }));
}

async function getOrganization(organizationId) {
  const organization = await Organization.findById(organizationId).populate(
    'owner',
    'name email'
  );

  if (!organization) {
    throw new AppError('Organization not found', 404);
  }

  const memberCount = await User.countDocuments({ organization: organization._id });

  return {
    id: organization._id.toString(),
    name: organization.name,
    owner: serializeOwner(organization.owner),
    memberCount,
    createdAt: organization.createdAt,
    updatedAt: organization.updatedAt,
  };
}

module.exports = {
  listUsers,
  getUser,
  updateUserStatus,
  listOrganizations,
  getOrganization,
};
