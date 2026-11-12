const { sendSuccess } = require('../../utils/api-response');
const adminService = require('./admin.service');

async function listUsers(req, res) {
  const users = await adminService.listUsers();

  return sendSuccess(res, {
    message: 'Users retrieved successfully',
    data: { users },
  });
}

async function getUser(req, res) {
  const user = await adminService.getUser(req.params.id);

  return sendSuccess(res, {
    message: 'User retrieved successfully',
    data: { user },
  });
}

async function updateUserStatus(req, res) {
  const user = await adminService.updateUserStatus(req.user, req.params.id, req.body.status);

  return sendSuccess(res, {
    message: 'User status updated successfully',
    data: { user },
  });
}

async function createOrganization(req, res) {
  const result = await adminService.createOrganization(req.body);

  return sendSuccess(res, {
    statusCode: 201,
    message: 'Organization and owner created successfully',
    data: result,
  });
}

async function updateOrganization(req, res) {
  const organization = await adminService.updateOrganization(req.params.id, req.body);

  return sendSuccess(res, {
    message: 'Organization updated successfully',
    data: { organization },
  });
}

async function updateOrganizationStatus(req, res) {
  const organization = await adminService.updateOrganizationStatus(
    req.params.id,
    req.body.status
  );

  return sendSuccess(res, {
    message: 'Organization status updated successfully',
    data: { organization },
  });
}

async function listOrganizations(req, res) {
  const organizations = await adminService.listOrganizations();

  return sendSuccess(res, {
    message: 'Organizations retrieved successfully',
    data: { organizations },
  });
}

async function getOrganization(req, res) {
  const organization = await adminService.getOrganization(req.params.id);

  return sendSuccess(res, {
    message: 'Organization retrieved successfully',
    data: { organization },
  });
}

module.exports = {
  listUsers,
  getUser,
  updateUserStatus,
  createOrganization,
  updateOrganization,
  updateOrganizationStatus,
  listOrganizations,
  getOrganization,
};
