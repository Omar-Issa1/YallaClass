function toId(value) {
  if (!value) {
    return null;
  }

  return value._id ? value._id.toString() : value.toString();
}

function round(value, digits = 2) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function ratio(part, total) {
  return total > 0 ? round(part / total, 4) : 0;
}

function percentage(part, total) {
  return total > 0 ? round((part / total) * 100, 2) : 0;
}

function serializeAttendanceRecord(record) {
  const answeredCount = record.answeredCount || 0;
  const correctCount = record.correctCount || 0;
  const totalResponseTimeMs = record.totalResponseTimeMs || 0;

  return {
    id: toId(record._id),
    session: toId(record.session),
    student: toId(record.student),
    participant: toId(record.participant),
    section: toId(record.section),
    sectionName: record.sectionName || '',
    name: record.name,
    nickname: record.nickname,
    status: record.status,
    guest: Boolean(record.guest),
    rosterMissing: Boolean(record.rosterMissing),
    late: Boolean(record.late),
    connected: Boolean(record.connected),
    joinedAt: record.joinedAt || null,
    leftAt: record.leftAt || null,
    durationMs: record.durationMs || 0,
    answeredCount,
    correctCount,
    incorrectCount: Math.max(0, answeredCount - correctCount),
    totalQuestions: record.totalQuestions || 0,
    accuracy: ratio(correctCount, answeredCount),
    accuracyPercentage: percentage(correctCount, answeredCount),
    score: record.score || 0,
    bestStreak: record.bestStreak || 0,
    finalRank: record.finalRank ?? null,
    totalResponseTimeMs,
    averageResponseTimeMs:
      answeredCount > 0 ? Math.round(totalResponseTimeMs / answeredCount) : 0,
    quizTitle: record.quizTitle || '',
    sessionStartedAt: record.sessionStartedAt || null,
    sessionEndedAt: record.sessionEndedAt || null,
  };
}

function serializeSectionSummary(section) {
  return {
    section: section.section,
    sectionName: section.sectionName,
    registered: section.registered,
    joined: section.joined,
    present: section.present,
    absent: section.absent,
    kicked: section.kicked,
    pending: section.pending,
    guests: section.guests,
    late: section.late,
    attendanceRate: section.attendanceRate,
    attendancePercentage: section.attendancePercentage,
    averageScore: section.averageScore,
    accuracy: section.accuracy,
    accuracyPercentage: section.accuracyPercentage,
  };
}

function serializeCommandLogEntry(command, participantsById) {
  const actor = command.actor ? participantsById.get(toId(command.actor)) : null;
  const target = command.target ? participantsById.get(toId(command.target)) : null;

  return {
    id: toId(command._id),
    commandId: command.commandId,
    type: command.type,
    status: command.status,
    actorId: toId(command.actor),
    actorName: actor?.name || null,
    actorNickname: actor?.nickname || null,
    targetId: toId(command.target),
    targetName: target?.name || null,
    targetNickname: target?.nickname || null,
    questionId: toId(command.question),
    questionIndex: command.questionIndex ?? null,
    value: command.result?.value ?? null,
    result: command.result || {},
    error: command.error || null,
    startedAt: command.startedAt || null,
    completedAt: command.completedAt || null,
    createdAt: command.createdAt,
  };
}

module.exports = {
  serializeAttendanceRecord,
  serializeSectionSummary,
  serializeCommandLogEntry,
  ratio,
  percentage,
  round,
  toId,
};
