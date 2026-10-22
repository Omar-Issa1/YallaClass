const Organization = require('../../models/organization.model');
const User = require('../../models/user.model');
const AppError = require('../../utils/app-error');
const { hashPassword } = require('../../utils/password');
const {
  serializeOrganization,
  serializeUser,
} = require('../../utils/serializers');

async function getOrganization(user) {
  const organization = await Organization.findById(user.organization);

  if (!organization) {
    throw new AppError('Organization not found', 404);
  }

  return organization;
}

async function updateOrganization(user, { name }) {
  const organization = await getOrganization(user);

  organization.name = name;
  await organization.save();

  return serializeOrganization(organization);
}

async function listMembers(user) {
  const members = await User.find({ organization: user.organization }).sort({ createdAt: 1 });

  return members.map(serializeUser);
}

async function findMemberInOrganization(user, memberId) {
  const member = await User.findOne({
    _id: memberId,
    organization: user.organization,
  });

  if (!member) {
    throw new AppError('Member not found', 404);
  }

  return member;
}

function assertMemberIsManageable(member) {
  if (member.role === 'OWNER' || member.role === 'ADMIN') {
    throw new AppError(
      'The organization owner or a platform admin cannot be managed through this endpoint',
      403
    );
  }
}

async function addMember(user, { name, email, password, role }) {
  if (!['TEACHER', 'ASSISTANT'].includes(role)) {
    throw new AppError('Role must be TEACHER or ASSISTANT', 400);
  }

  const existingUser = await User.exists({ email });

  if (existingUser) {
    throw new AppError('Email is already registered', 409);
  }

  const passwordHash = await hashPassword(password);

  const member = await User.create({
    name,
    email,
    passwordHash,
    role,
    organization: user.organization,
    status: 'ACTIVE',
  });

  return serializeUser(member);
}

async function updateMember(user, memberId, updates) {
  const member = await findMemberInOrganization(user, memberId);

  assertMemberIsManageable(member);

  if (updates.role !== undefined && !['TEACHER', 'ASSISTANT'].includes(updates.role)) {
    throw new AppError('Role must be TEACHER or ASSISTANT', 400);
  }

  if (updates.name !== undefined) {
    member.name = updates.name;
  }

  if (updates.role !== undefined) {
    member.role = updates.role;
  }

  if (updates.status !== undefined) {
    member.status = updates.status;
  }

  await member.save();

  return serializeUser(member);
}

async function removeMember(user, memberId) {
  const member = await findMemberInOrganization(user, memberId);

  assertMemberIsManageable(member);

  await member.deleteOne();

  return member._id.toString();
}

module.exports = {
  getOrganization,
  updateOrganization,
  listMembers,
  addMember,
  updateMember,
  removeMember,
};
