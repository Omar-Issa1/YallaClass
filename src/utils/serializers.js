function toId(value) {
  if (!value) {
    return null;
  }

  return value._id ? value._id.toString() : value.toString();
}

function serializeUser(user) {
  return {
    id: user._id.toString(),
    name: user.name,
    email: user.email,
    role: user.role,
    status: user.status,
    organization: toId(user.organization),
    avatar: user.avatar || '',
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
  };
}

function serializeOrganization(organization) {
  return {
    id: organization._id.toString(),
    name: organization.name,
    owner: toId(organization.owner),
    createdAt: organization.createdAt,
    updatedAt: organization.updatedAt,
  };
}

module.exports = { serializeUser, serializeOrganization };
