const { sendSuccess } = require('../../utils/api-response');
const sectionService = require('./section.service');

async function listSections(req, res) {
  const sections = await sectionService.listSections(req.organizationId, req.validatedQuery);

  return sendSuccess(res, {
    message: 'Sections retrieved successfully',
    data: { sections },
  });
}

async function getSection(req, res) {
  const section = await sectionService.getSection(req.organizationId, req.params.id);

  return sendSuccess(res, {
    message: 'Section retrieved successfully',
    data: { section },
  });
}

async function createSection(req, res) {
  const section = await sectionService.createSection(req.user, req.body);

  return sendSuccess(res, {
    statusCode: 201,
    message: 'Section created successfully',
    data: { section },
  });
}

async function updateSection(req, res) {
  const section = await sectionService.updateSection(req.user, req.params.id, req.body);

  return sendSuccess(res, {
    message: 'Section updated successfully',
    data: { section },
  });
}

async function deleteSection(req, res) {
  const id = await sectionService.deleteSection(req.user, req.params.id);

  return sendSuccess(res, {
    message: 'Section deleted successfully',
    data: { id },
  });
}

module.exports = {
  listSections,
  getSection,
  createSection,
  updateSection,
  deleteSection,
};
