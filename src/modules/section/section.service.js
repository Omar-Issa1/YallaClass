const Section = require('../../models/section.model');
const Student = require('../../models/student.model');
const AppError = require('../../utils/app-error');
const { serializeSection, serializeStudent } = require('../../utils/serializers');

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

async function getStudentCounts(organizationId, sectionIds) {
  if (sectionIds.length === 0) {
    return new Map();
  }

  const counts = await Student.aggregate([
    { $match: { organization: organizationId, section: { $in: sectionIds } } },
    { $group: { _id: '$section', count: { $sum: 1 } } },
  ]);

  return new Map(counts.map((item) => [item._id.toString(), item.count]));
}

async function findSection(organizationId, sectionId) {
  const section = await Section.findOne({
    _id: sectionId,
    organization: organizationId,
  });

  if (!section) {
    throw new AppError('Section not found', 404);
  }

  return section;
}

async function assertSectionNameAvailable(organizationId, name, excludeSectionId) {
  const filter = { organization: organizationId, name };

  if (excludeSectionId) {
    filter._id = { $ne: excludeSectionId };
  }

  const existing = await Section.findOne(filter);

  if (existing) {
    throw new AppError('A section with this name already exists', 409);
  }
}

async function listSections(organizationId, { search } = {}) {
  const filter = { organization: organizationId };

  if (search) {
    const searchPattern = new RegExp(escapeRegex(search), 'i');
    filter.$or = [{ name: searchPattern }, { description: searchPattern }];
  }

  const sections = await Section.find(filter).sort({ name: 1 });
  const countsBySectionId = await getStudentCounts(
    organizationId,
    sections.map((section) => section._id)
  );

  return sections.map((section) =>
    serializeSection(section, countsBySectionId.get(section._id.toString()) || 0)
  );
}

async function getSection(organizationId, sectionId) {
  const section = await findSection(organizationId, sectionId);
  const students = await Student.find({
    organization: organizationId,
    section: section._id,
  }).sort({ name: 1 });

  return {
    ...serializeSection(section, students.length),
    students: students.map(serializeStudent),
  };
}

async function createSection(user, { name, description }) {
  await assertSectionNameAvailable(user.organization, name);

  const section = await Section.create({
    name,
    description,
    organization: user.organization,
    createdBy: user._id,
  });

  return serializeSection(section);
}

async function updateSection(user, sectionId, updates) {
  const section = await findSection(user.organization, sectionId);

  if (updates.name !== undefined && updates.name !== section.name) {
    await assertSectionNameAvailable(user.organization, updates.name, section._id);
    section.name = updates.name;
  }

  if (updates.description !== undefined) {
    section.description = updates.description;
  }

  await section.save();

  const studentCount = await Student.countDocuments({
    organization: user.organization,
    section: section._id,
  });

  return serializeSection(section, studentCount);
}

async function deleteSection(user, sectionId) {
  const section = await findSection(user.organization, sectionId);
  const studentCount = await Student.countDocuments({
    organization: user.organization,
    section: section._id,
  });

  if (studentCount > 0) {
    throw new AppError(
      'Section cannot be deleted while it contains students. Move or delete its students first.',
      409
    );
  }

  await section.deleteOne();

  return section._id.toString();
}

module.exports = {
  findSection,
  listSections,
  getSection,
  createSection,
  updateSection,
  deleteSection,
};
