const { sendSuccess } = require('../../utils/api-response');
const attendanceService = require('./attendance.service');

async function getSessionAttendance(req, res) {
  const attendance = await attendanceService.getSessionAttendance(
    req.organizationId,
    req.params.id,
    req.validatedQuery
  );

  return sendSuccess(res, {
    message: 'Session attendance retrieved successfully',
    data: { attendance },
  });
}

async function getSessionReport(req, res) {
  const report = await attendanceService.getSessionReport(
    req.organizationId,
    req.params.id
  );

  return sendSuccess(res, {
    message: 'Session report retrieved successfully',
    data: { report },
  });
}

async function exportSessionReport(req, res) {
  const { buffer, contentType, filename } =
    await attendanceService.exportSessionReport(
      req.organizationId,
      req.params.id
    );

  res.setHeader('Content-Type', contentType);
  res.setHeader(
    'Content-Disposition',
    `attachment; filename="${filename}"`
  );
  res.setHeader('Content-Length', buffer.length);

  return res.status(200).send(buffer);
}

async function getStudentHistory(req, res) {
  const history = await attendanceService.getStudentHistory(
    req.organizationId,
    req.params.id,
    req.validatedQuery
  );

  return sendSuccess(res, {
    message: 'Student history retrieved successfully',
    data: { history },
  });
}

module.exports = {
  getSessionAttendance,
  getSessionReport,
  exportSessionReport,
  getStudentHistory,
};
