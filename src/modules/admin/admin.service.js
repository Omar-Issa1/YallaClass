const mongoose = require('mongoose');

const Organization = require('../../models/organization.model');
const User = require('../../models/user.model');
const AppError = require('../../utils/app-error');
const { hashPassword } = require('../../utils/password');
const { serializeUser } = require('../../utils/serializers');
const { transactionsSupported } = require('../../utils/transactions');

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
    status: owner.status || 'ACTIVE',
  };
}

function serializeAdminOrganization(organization, { owner, memberCount = 0 } = {}) {
  return {
    id: organization._id.toString(),
    name: organization.name,
    status: organization.status || 'ACTIVE',
    owner: serializeOwner(owner || organization.owner),
    memberCount,
    createdAt: organization.createdAt,
    updatedAt: organization.updatedAt,
  };
}

async function listOrganizations() {
  const organizations = await Organization.find()
    .populate('owner', 'name email status')
    .sort({ createdAt: -1 })
    .lean();

  const memberCounts = await User.aggregate([
    { $match: { organization: { $ne: null } } },
    { $group: { _id: '$organization', count: { $sum: 1 } } },
  ]);

  const countByOrganizationId = new Map(
    memberCounts.map((item) => [item._id.toString(), item.count])
  );

  return organizations.map((organization) =>
    serializeAdminOrganization(organization, {
      owner: organization.owner,
      memberCount: countByOrganizationId.get(organization._id.toString()) || 0,
    })
  );
}

async function getOrganization(organizationId) {
  const organization = await Organization.findById(organizationId).populate(
    'owner',
    'name email status'
  );

  if (!organization) {
    throw new AppError('Organization not found', 404);
  }

  const memberCount = await User.countDocuments({ organization: organization._id });

  return serializeAdminOrganization(organization, {
    owner: organization.owner,
    memberCount,
  });
}

async function createOrganizationDocuments(input, session, tracker) {
  const options = session ? { session } : {};

  const [createdOwner] = await User.create(
    [
      {
        name: input.owner.name,
        email: input.owner.email,
        passwordHash: input.passwordHash,
        role: 'OWNER',
        organization: null,
        status: 'ACTIVE',
      },
    ],
    options
  );

  tracker.owner = createdOwner;

  const [createdOrganization] = await Organization.create(
    [
      {
        name: input.name,
        owner: createdOwner._id,
        status: 'ACTIVE',
      },
    ],
    options
  );

  tracker.organization = createdOrganization;

  createdOwner.organization = createdOrganization._id;
  await createdOwner.save(options);

  return { createdOwner, createdOrganization };
}

function formatCreatedOrganization({ createdOwner, createdOrganization }) {
  return {
    organization: serializeAdminOrganization(createdOrganization, {
      owner: createdOwner,
      memberCount: 1,
    }),
    owner: serializeUser(createdOwner),
  };
}

function mapDuplicateEmail(error) {
  if (error.code === 11000) {
    return new AppError('Email is already registered', 409);
  }

  return error;
}

async function createOrganization({ name, owner }) {
  const existingUser = await User.exists({ email: owner.email });

  if (existingUser) {
    throw new AppError('Email is already registered', 409);
  }

  const passwordHash = await hashPassword(owner.password);
  const input = { name, owner, passwordHash };

  if (await transactionsSupported()) {
    const session = await mongoose.startSession();

    try {
      const result = await session.withTransaction(() =>
        createOrganizationDocuments(input, session, {})
      );

      return formatCreatedOrganization(result);
    } catch (error) {
      throw mapDuplicateEmail(error);
    } finally {
      await session.endSession();
    }
  }

  /**
   * Standalone MongoDB does not support transactions. Track created
   * documents and remove them if a later step fails so an organization is
   * never left without an owner (or an orphaned owner account).
   */
  const tracker = { owner: null, organization: null };

  try {
    const result = await createOrganizationDocuments(input, null, tracker);
    return formatCreatedOrganization(result);
  } catch (error) {
    if (tracker.organization) {
      await Organization.deleteOne({ _id: tracker.organization._id }).catch(() => {});
    }

    if (tracker.owner) {
      await User.deleteOne({ _id: tracker.owner._id }).catch(() => {});
    }

    throw mapDuplicateEmail(error);
  }
}

async function updateOrganization(organizationId, { name }) {
  const organization = await Organization.findById(organizationId);

  if (!organization) {
    throw new AppError('Organization not found', 404);
  }

  organization.name = name;
  await organization.save();

  return getOrganization(organization._id);
}

async function updateOrganizationStatus(organizationId, status) {
  const organization = await Organization.findById(organizationId);

  if (!organization) {
    throw new AppError('Organization not found', 404);
  }

  organization.status = status;
  await organization.save();

  return getOrganization(organization._id);
}

module.exports = {
  listUsers,
  getUser,
  updateUserStatus,
  listOrganizations,
  getOrganization,
  createOrganization,
  updateOrganization,
  updateOrganizationStatus,
};
