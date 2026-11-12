const { sendSuccess } = require('../../utils/api-response');
const studentService = require('./student.service');

async function listStudents(req, res) {
  const students = await studentService.listStudents(req.organizationId, req.validatedQuery);

  return sendSuccess(res, {
    message: 'Students retrieved successfully',
    data: { students },
  });
}

async function getStudent(req, res) {
  const student = await studentService.getStudent(req.organizationId, req.params.id);

  return sendSuccess(res, {
    message: 'Student retrieved successfully',
    data: { student },
  });
}

async function createStudent(req, res) {
  const student = await studentService.createStudent(req.user, req.body);

  return sendSuccess(res, {
    statusCode: 201,
    message: 'Student created successfully',
    data: { student },
  });
}

async function importStudents(req, res) {
  const students = await studentService.importStudents(req.user, req.body);

  return sendSuccess(res, {
    statusCode: 201,
    message: 'Students imported successfully',
    data: {
      importedCount: students.length,
      students,
    },
  });
}

async function updateStudent(req, res) {
  const student = await studentService.updateStudent(req.user, req.params.id, req.body);

  return sendSuccess(res, {
    message: 'Student updated successfully',
    data: { student },
  });
}

async function updateStudentAvatar(req, res) {
  const student = await studentService.updateStudentAvatar(req.user, req.params.id, req.body);

  return sendSuccess(res, {
    message: 'Student avatar updated successfully',
    data: { student },
  });
}

async function deleteStudent(req, res) {
  const id = await studentService.deleteStudent(req.user, req.params.id);

  return sendSuccess(res, {
    message: 'Student deleted successfully',
    data: { id },
  });
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
