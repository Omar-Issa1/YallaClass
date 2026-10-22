const { sendSuccess } = require('../../utils/api-response');
const { serializeOrganization } = require('../../utils/serializers');
const organizationService = require('./organization.service');

async function getOrganization(req, res) {
  const organization = await organizationService.getOrganization(req.user);

  return sendSuccess(res, {
    message: 'Organization retrieved successfully',
    data: { organization: serializeOrganization(organization) },
  });
}

async function updateOrganization(req, res) {
  const organization = await organizationService.updateOrganization(req.user, req.body);

  return sendSuccess(res, {
    message: 'Organization updated successfully',
    data: { organization },
  });
}

async function listMembers(req, res) {
  const members = await organizationService.listMembers(req.user);

  return sendSuccess(res, {
    message: 'Members retrieved successfully',
    data: { members },
  });
}

async function addMember(req, res) {
  const member = await organizationService.addMember(req.user, req.body);

  return sendSuccess(res, {
    statusCode: 201,
    message: 'Member created successfully',
    data: { member },
  });
}

async function updateMember(req, res) {
  const member = await organizationService.updateMember(req.user, req.params.id, req.body);

  return sendSuccess(res, {
    message: 'Member updated successfully',
    data: { member },
  });
}

async function removeMember(req, res) {
  const memberId = await organizationService.removeMember(req.user, req.params.id);

  return sendSuccess(res, {
    message: 'Member removed successfully',
    data: { id: memberId },
  });
}

module.exports = {
  getOrganization,
  updateOrganization,
  listMembers,
  addMember,
  updateMember,
  removeMember,
};
