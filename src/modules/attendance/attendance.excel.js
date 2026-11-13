const ExcelJS = require('exceljs');

const WORKSHEET_NAMES = {
  summary: 'Session Summary',
  attendance: 'Attendance',
  results: 'Student Results',
  questions: 'Question Analysis',
  commands: 'Commands',
};

const HEADER_FILL = {
  type: 'pattern',
  pattern: 'solid',
  fgColor: { argb: 'FF1F4E78' },
};

const HEADER_FONT = {
  bold: true,
  color: { argb: 'FFFFFFFF' },
};

// Excel/LibreOffice can interpret cells that start with these characters as
// formulas. User-provided text (names, nicknames, question text, etc.) must be
// neutralised before it is written to a workbook.
const FORMULA_PREFIX = /^[=+\-@\t\r]/;

function sanitizeCellText(value) {
  if (typeof value !== 'string' || value.length === 0) {
    return value;
  }

  return FORMULA_PREFIX.test(value) ? `'${value}` : value;
}

function toDate(value) {
  if (!value) {
    return null;
  }

  const date = value instanceof Date ? value : new Date(value);

  return Number.isNaN(date.getTime()) ? null : date;
}

function round(value, digits = 2) {
  const factor = 10 ** digits;
  return Math.round((Number(value) || 0) * factor) / factor;
}

function percentage(part, total) {
  return total > 0 ? round((part / total) * 100, 2) : 0;
}

function formatDuration(ms) {
  const totalSeconds = Math.max(0, Math.floor((Number(ms) || 0) / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  return [hours, minutes, seconds]
    .map((value) => String(value).padStart(2, '0'))
    .join(':');
}

function pad2(value) {
  return String(value).padStart(2, '0');
}

function safeFilenameSegment(value, fallback = 'session') {
  const cleaned = String(value || '')
    .replace(/[^A-Za-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '');

  return cleaned || fallback;
}

function buildExportFilename(session = {}) {
  const date = new Date(session.endedAt || session.startedAt || Date.now());
  const stamp = `${date.getUTCFullYear()}${pad2(date.getUTCMonth() + 1)}${pad2(
    date.getUTCDate()
  )}-${pad2(date.getUTCHours())}${pad2(date.getUTCMinutes())}${pad2(
    date.getUTCSeconds()
  )}`;

  return `yalla-class-report-${safeFilenameSegment(
    session.joinCode
  )}-${stamp}.xlsx`;
}

function styleHeaderRow(worksheet) {
  const headerRow = worksheet.getRow(1);
  headerRow.height = 20;

  headerRow.eachCell((cell) => {
    cell.font = HEADER_FONT;
    cell.fill = HEADER_FILL;
    cell.alignment = { vertical: 'middle', horizontal: 'left' };
  });
}

function addTabularWorksheet(workbook, name, columns) {
  const worksheet = workbook.addWorksheet(name, {
    views: [{ state: 'frozen', ySplit: 1 }],
  });

  worksheet.columns = columns.map(({ header, key, width }) => ({
    header,
    key,
    width,
  }));

  styleHeaderRow(worksheet);

  worksheet.autoFilter = {
    from: { row: 1, column: 1 },
    to: { row: 1, column: columns.length },
  };

  return worksheet;
}

function applyColumnNumberFormat(worksheet, columnNumber, numFmt) {
  worksheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    if (rowNumber === 1) {
      return;
    }

    const cell = row.getCell(columnNumber);

    if (cell.value !== null && cell.value !== undefined && cell.value !== '') {
      cell.numFmt = numFmt;
    }
  });
}

function addSummarySheet(workbook, { report, organizationName, teacherName }) {
  const worksheet = workbook.addWorksheet(WORKSHEET_NAMES.summary, {
    views: [{ state: 'frozen', ySplit: 1 }],
  });

  worksheet.columns = [{ width: 34 }, { width: 60 }];
  worksheet.addRow(['Field', 'Value']);
  styleHeaderRow(worksheet);

  const summary = report.summary;
  const session = report.session;
  const sessionDate =
    toDate(session.startedAt) || toDate(session.endedAt) || toDate(report.generatedAt);

  const rows = [
    ['Organization Name', sanitizeCellText(organizationName || '')],
    ['Quiz Title', sanitizeCellText(session.quiz?.title || '')],
    ['Session Date', sessionDate, 'yyyy-mm-dd hh:mm:ss'],
    ['Teacher Name', sanitizeCellText(teacherName || '')],
    ['Total Questions', session.totalQuestions || 0, '0'],
    ['Total Registered Participants', summary.registeredParticipants || 0, '0'],
    ['Actual Attendees', summary.actualAttendees || 0, '0'],
    ['Absentees', summary.absentees || 0, '0'],
    ['Kicked Participants', summary.kicked || 0, '0'],
    ['Average Accuracy (%)', summary.averageAccuracyPercentage || 0, '0.00'],
    ['Average Response Time (ms)', summary.averageResponseTimeMs || 0, '#,##0'],
    ['Session Duration', formatDuration(summary.gameDurationMs)],
  ];

  for (const [label, value, numFmt] of rows) {
    const row = worksheet.addRow([label, value]);

    if (numFmt) {
      row.getCell(2).numFmt = numFmt;
    }
  }

  worksheet.getColumn(1).font = { bold: true };
  worksheet.getColumn(2).alignment = { wrapText: true, vertical: 'top' };
  worksheet.getColumn(1).alignment = { vertical: 'top' };

  return worksheet;
}

function buildAttendanceRows(report) {
  return report.studentAnalysis.map((record) => ({
    name: sanitizeCellText(record.name || ''),
    nickname: sanitizeCellText(record.nickname || ''),
    section: sanitizeCellText(record.sectionName || ''),
    status: record.status,
    joinedAt: toDate(record.joinedAt),
    leftAt: toDate(record.leftAt),
    duration: formatDuration(record.durationMs),
    answeredCount: record.answeredCount || 0,
    correctCount: record.correctCount || 0,
    attendancePercentage: percentage(
      record.answeredCount || 0,
      record.totalQuestions || 0
    ),
  }));
}

function addAttendanceSheet(workbook, report) {
  const worksheet = addTabularWorksheet(workbook, WORKSHEET_NAMES.attendance, [
    { header: 'Student Name', key: 'name', width: 30 },
    { header: 'Nickname', key: 'nickname', width: 22 },
    { header: 'Section', key: 'section', width: 24 },
    { header: 'Attendance Status', key: 'status', width: 18 },
    { header: 'Join Time', key: 'joinedAt', width: 22 },
    { header: 'Leave Time', key: 'leftAt', width: 22 },
    { header: 'Participation Duration', key: 'duration', width: 22 },
    { header: 'Answered Questions', key: 'answeredCount', width: 20 },
    { header: 'Correct Answers', key: 'correctCount', width: 18 },
    { header: 'Attendance Percentage', key: 'attendancePercentage', width: 22 },
  ]);

  worksheet.addRows(buildAttendanceRows(report));
  applyColumnNumberFormat(worksheet, 5, 'yyyy-mm-dd hh:mm:ss');
  applyColumnNumberFormat(worksheet, 6, 'yyyy-mm-dd hh:mm:ss');
  applyColumnNumberFormat(worksheet, 8, '0');
  applyColumnNumberFormat(worksheet, 9, '0');
  applyColumnNumberFormat(worksheet, 10, '0.00');

  return worksheet;
}

function buildResultRows(report) {
  return report.studentAnalysis.map((record) => ({
    name: sanitizeCellText(record.name || ''),
    nickname: sanitizeCellText(record.nickname || ''),
    section: sanitizeCellText(record.sectionName || ''),
    rawScore: record.rawScore || 0,
    gameScore: record.gameScore ?? record.score ?? 0,
    finalRank: record.finalRank ?? '',
    correctCount: record.correctCount || 0,
    incorrectCount: record.incorrectCount || 0,
    accuracyPercentage: record.accuracyPercentage || 0,
    averageResponseTimeMs: record.averageResponseTimeMs || 0,
    bestStreak: record.academicBestStreak ?? record.bestStreak ?? 0,
  }));
}

function addResultsSheet(workbook, report) {
  const worksheet = addTabularWorksheet(workbook, WORKSHEET_NAMES.results, [
    { header: 'Student Name', key: 'name', width: 30 },
    { header: 'Nickname', key: 'nickname', width: 22 },
    { header: 'Section', key: 'section', width: 24 },
    { header: 'Raw Score', key: 'rawScore', width: 14 },
    { header: 'Game Score', key: 'gameScore', width: 14 },
    { header: 'Final Rank', key: 'finalRank', width: 12 },
    { header: 'Correct Answers', key: 'correctCount', width: 18 },
    { header: 'Incorrect Answers', key: 'incorrectCount', width: 18 },
    { header: 'Accuracy Percentage', key: 'accuracyPercentage', width: 20 },
    { header: 'Average Response Time (ms)', key: 'averageResponseTimeMs', width: 26 },
    { header: 'Best Streak', key: 'bestStreak', width: 14 },
  ]);

  worksheet.addRows(buildResultRows(report));
  applyColumnNumberFormat(worksheet, 4, '#,##0');
  applyColumnNumberFormat(worksheet, 5, '#,##0');
  applyColumnNumberFormat(worksheet, 6, '0');
  applyColumnNumberFormat(worksheet, 7, '0');
  applyColumnNumberFormat(worksheet, 8, '0');
  applyColumnNumberFormat(worksheet, 9, '0.00');
  applyColumnNumberFormat(worksheet, 10, '#,##0');
  applyColumnNumberFormat(worksheet, 11, '0');

  return worksheet;
}

function addQuestionAnalysisSheet(workbook, report) {
  const worksheet = addTabularWorksheet(workbook, WORKSHEET_NAMES.questions, [
    { header: 'Question Order', key: 'order', width: 16 },
    { header: 'Question Text', key: 'text', width: 60 },
    { header: 'Total Answers', key: 'totalAnswers', width: 16 },
    { header: 'Correct Answers', key: 'correctAnswers', width: 18 },
    { header: 'Incorrect Answers', key: 'incorrectAnswers', width: 18 },
    { header: 'Correct Answer Percentage', key: 'accuracyPercentage', width: 26 },
    { header: 'Average Response Time (ms)', key: 'averageResponseTimeMs', width: 26 },
  ]);

  worksheet.addRows(
    report.questionAnalysis.map((question) => ({
      order: question.index + 1,
      text: sanitizeCellText(question.text || ''),
      totalAnswers: question.totalAnswers || 0,
      correctAnswers: question.correctAnswers || 0,
      incorrectAnswers: question.incorrectAnswers || 0,
      accuracyPercentage: question.accuracyPercentage || 0,
      averageResponseTimeMs: question.averageResponseTimeMs || 0,
    }))
  );

  worksheet.getColumn(2).alignment = { wrapText: true, vertical: 'top' };
  applyColumnNumberFormat(worksheet, 1, '0');
  applyColumnNumberFormat(worksheet, 3, '0');
  applyColumnNumberFormat(worksheet, 4, '0');
  applyColumnNumberFormat(worksheet, 5, '0');
  applyColumnNumberFormat(worksheet, 6, '0.00');
  applyColumnNumberFormat(worksheet, 7, '#,##0');

  return worksheet;
}

function addCommandsSheet(workbook, report) {
  const worksheet = addTabularWorksheet(workbook, WORKSHEET_NAMES.commands, [
    { header: 'Command Type', key: 'type', width: 16 },
    { header: 'Actor', key: 'actor', width: 26 },
    { header: 'Target', key: 'target', width: 26 },
    { header: 'Value / Effect', key: 'value', width: 18 },
    { header: 'Question', key: 'question', width: 14 },
    { header: 'Timestamp', key: 'timestamp', width: 22 },
  ]);

  worksheet.addRows(
    report.commands.log.map((command) => ({
      type: command.type,
      actor: sanitizeCellText(
        command.actorName || command.actorNickname || command.actorId || ''
      ),
      target: sanitizeCellText(
        command.targetName || command.targetNickname || command.targetId || ''
      ),
      value:
        typeof command.value === 'number'
          ? command.value
          : sanitizeCellText(command.value == null ? '' : String(command.value)),
      question:
        command.questionIndex !== null && command.questionIndex >= 0
          ? `Q${command.questionIndex + 1}`
          : '',
      timestamp: toDate(
        command.createdAt || command.startedAt || command.completedAt
      ),
    }))
  );

  applyColumnNumberFormat(worksheet, 4, '#,##0');
  applyColumnNumberFormat(worksheet, 6, 'yyyy-mm-dd hh:mm:ss');

  return worksheet;
}

async function buildSessionReportWorkbook({
  report,
  organizationName = '',
  teacherName = '',
}) {
  const workbook = new ExcelJS.Workbook();

  workbook.creator = 'Yalla Class';
  workbook.lastModifiedBy = 'Yalla Class';
  workbook.created = new Date();
  workbook.modified = new Date();

  addSummarySheet(workbook, { report, organizationName, teacherName });
  addAttendanceSheet(workbook, report);
  addResultsSheet(workbook, report);
  addQuestionAnalysisSheet(workbook, report);
  addCommandsSheet(workbook, report);

  const buffer = await workbook.xlsx.writeBuffer();

  return Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);
}

module.exports = {
  WORKSHEET_NAMES,
  buildExportFilename,
  buildSessionReportWorkbook,
  formatDuration,
  sanitizeCellText,
};
