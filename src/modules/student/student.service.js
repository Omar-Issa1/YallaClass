const Student = require('../../models/student.model');
const AppError = require('../../utils/app-error');
const { DEFAULT_AVATAR } = require('../../constants/avatar');
const { serializeStudent } = require('../../utils/serializers');
const { findSection } = require('../section/section.service');

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function buildAvatar(avatar = {}) {
  return {
    preset: avatar.preset || DEFAULT_AVATAR.preset,
    color: avatar.color || DEFAULT_AVATAR.color,
  };
}

async function findStudent(organizationId, studentId) {
  const student = await Student.findOne({
    _id: studentId,
    organization: organizationId,
  });

  if (!student) {
    throw new AppError('Student not found', 404);
  }

  return student;
}

async function listStudents(organizationId, { search, section } = {}) {
  const filter = { organization: organizationId };

  if (section) {
    filter.section = section;
  }

  if (search) {
    const searchPattern = new RegExp(escapeRegex(search), 'i');
    filter.$or = [{ name: searchPattern }, { nickname: searchPattern }];
  }

  const students = await Student.find(filter).sort({ name: 1 });

  return students.map(serializeStudent);
}

async function getStudent(organizationId, studentId) {
  const student = await findStudent(organizationId, studentId);

  return serializeStudent(student);
}

async function createStudent(user, { name, nickname, section, avatar }) {
  const targetSection = await findSection(user.organization, section);

  const student = await Student.create({
    name,
    nickname,
    organization: user.organization,
    section: targetSection._id,
    avatar: buildAvatar(avatar),
  });

  return serializeStudent(student);
}

async function importStudents(user, { section, students }) {
  const targetSection = await findSection(user.organization, section);

  const documents = students.map((student) => ({
    name: student.name,
    nickname: student.nickname,
    organization: user.organization,
    section: targetSection._id,
    avatar: buildAvatar(student.avatar),
  }));

  const created = await Student.insertMany(documents);

  return created.map(serializeStudent);
}

async function updateStudent(user, studentId, updates) {
  const student = await findStudent(user.organization, studentId);

  if (updates.section !== undefined) {
    const targetSection = await findSection(user.organization, updates.section);
    student.section = targetSection._id;
  }

  if (updates.name !== undefined) {
    student.name = updates.name;
  }

  if (updates.nickname !== undefined) {
    student.nickname = updates.nickname;
  }

  if (updates.avatar !== undefined) {
    if (!student.avatar) {
      student.avatar = {};
    }

    if (updates.avatar.preset !== undefined) {
      student.avatar.preset = updates.avatar.preset;
    }

    if (updates.avatar.color !== undefined) {
      student.avatar.color = updates.avatar.color;
    }
  }

  await student.save();

  return serializeStudent(student);
}

async function updateStudentAvatar(user, studentId, { preset, color }) {
  const student = await findStudent(user.organization, studentId);

  if (!student.avatar) {
    student.avatar = {};
  }

  if (preset !== undefined) {
    student.avatar.preset = preset;
  }

  if (color !== undefined) {
    student.avatar.color = color;
  }

  await student.save();

  return serializeStudent(student);
}

async function deleteStudent(user, studentId) {
  const student = await findStudent(user.organization, studentId);

  await student.deleteOne();

  return student._id.toString();
}

module.exports = {
  listStudents,
  getStudent,
  createStudent,
  importStudents,
  updateStudent,
  updateStudentAvatar,
  deleteStudent,
};
