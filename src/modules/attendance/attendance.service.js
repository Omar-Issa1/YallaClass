const mongoose = require('mongoose');

const Answer = require('../../models/answer.model');
const Attendance = require('../../models/attendance.model');
const Organization = require('../../models/organization.model');
const Quiz = require('../../models/quiz.model');
const Section = require('../../models/section.model');
const Session = require('../../models/session.model');
const SessionCommand = require('../../models/session-command.model');
const SessionPlayer = require('../../models/session-player.model');
const Student = require('../../models/student.model');
const User = require('../../models/user.model');
const AppError = require('../../utils/app-error');
const { serializeStudent } = require('../../utils/serializers');
const { COMMAND_TYPES } = require('../game/game.constants');
const {
  serializeAttendanceRecord,
  serializeCommandLogEntry,
  serializeSectionSummary,
  percentage,
  ratio,
  round,
  toId,
} = require('./attendance.serializers');
const {
  buildExportFilename,
  buildSessionReportWorkbook,
} = require('./attendance.excel');

const DEFAULT_ATTENDANCE_THRESHOLD = 0.5;
const MAX_TOP_PLAYERS = 5;

function getSessionThreshold(session) {
  return typeof session.attendanceThreshold === 'number'
    ? session.attendanceThreshold
    : DEFAULT_ATTENDANCE_THRESHOLD;
}

async function findOrganizationSession(organizationId, sessionId) {
  const session = await Session.findOne({
    _id: sessionId,
    organization: organizationId,
  });

  if (!session) {
    throw new AppError('Session not found', 404);
  }

  return session;
}

function computeAttendanceStatus({
  answeredCount,
  questionCount,
  threshold,
  kicked,
  finished,
}) {
  if (kicked) {
    return 'KICKED';
  }

  if (!finished) {
    return 'PENDING';
  }

  if (questionCount <= 0) {
    return 'PRESENT';
  }

  return answeredCount / questionCount >= threshold ? 'PRESENT' : 'ABSENT';
}

function isLateJoin(participant, session) {
  if (!participant.joinedAt || !session.startedAt) {
    return false;
  }

  return (
    new Date(participant.joinedAt).getTime() >
    new Date(session.startedAt).getTime()
  );
}

function resolveLeaveTime(participant, session) {
  if (participant.status === 'KICKED' && participant.kickedAt) {
    return participant.kickedAt;
  }

  if (session.status === 'FINISHED') {
    if (!participant.connected && participant.lastDisconnectedAt) {
      return participant.lastDisconnectedAt;
    }

    return session.endedAt || participant.lastSeenAt || null;
  }

  if (!participant.connected) {
    return participant.lastDisconnectedAt || participant.lastSeenAt || null;
  }

  return null;
}

function resolveDurationMs(participant, session, leftAt) {
  if (!participant.joinedAt) {
    return 0;
  }

  let end = leftAt;

  if (!end) {
    if (session.status === 'FINISHED') {
      end = session.endedAt || participant.lastSeenAt || new Date();
    } else if (participant.connected) {
      end = new Date();
    } else {
      end = participant.lastSeenAt || new Date();
    }
  }

  return Math.max(
    0,
    new Date(end).getTime() - new Date(participant.joinedAt).getTime()
  );
}

function buildAnswerIndex(answers) {
  const byParticipant = new Map();
  const byQuestion = new Map();

  for (const answer of answers) {
    const participantId = answer.sessionPlayer.toString();
    const questionId = answer.question.toString();

    if (!byParticipant.has(participantId)) {
      byParticipant.set(participantId, []);
    }

    byParticipant.get(participantId).push(answer);

    if (!byQuestion.has(questionId)) {
      byQuestion.set(questionId, []);
    }

    byQuestion.get(questionId).push(answer);
  }

  return { byParticipant, byQuestion };
}

function summarizeAnswers(answers) {
  let correctCount = 0;
  let totalResponseTimeMs = 0;

  for (const answer of answers) {
    if (answer.isCorrect) {
      correctCount += 1;
    }

    totalResponseTimeMs += answer.responseTimeMs || 0;
  }

  return {
    answeredCount: answers.length,
    correctCount,
    totalResponseTimeMs,
  };
}

function buildAttendanceRecord({
  session,
  quiz,
  participant,
  student,
  section,
  sectionName,
  stats,
  status,
  now,
}) {
  const leftAt = resolveLeaveTime(participant, session);

  return {
    session: session._id,
    organization: session.organization,
    student: participant.student || null,
    participant: participant._id,
    section: section || null,
    sectionName: sectionName || '',
    name: participant.name,
    nickname: participant.nickname,
    quiz: session.quiz,
    quizTitle: quiz?.title || '',
    sessionStartedAt: session.startedAt || null,
    sessionEndedAt: session.endedAt || null,
    status,
    guest: !participant.student,
    rosterMissing: Boolean(participant.student && !student),
    late: isLateJoin(participant, session),
    connected: Boolean(participant.connected),
    joinedAt: participant.joinedAt || null,
    leftAt,
    durationMs: resolveDurationMs(participant, session, leftAt),
    answeredCount: stats.answeredCount,
    correctCount: stats.correctCount,
    totalQuestions: session.gameQuestions?.length || 0,
    score: participant.score || 0,
    bestStreak: participant.bestStreak || 0,
    finalRank: participant.finalRank ?? null,
    totalResponseTimeMs: stats.totalResponseTimeMs,
    finalizedAt: now,
  };
}

function buildAbsenteeRecord({ session, quiz, student, section, sectionName }) {
  return {
    session: session._id,
    organization: session.organization,
    student: student._id,
    participant: null,
    section: section || null,
    sectionName: sectionName || '',
    name: student.name,
    nickname: student.nickname || student.name,
    quiz: session.quiz,
    quizTitle: quiz?.title || '',
    sessionStartedAt: session.startedAt || null,
    sessionEndedAt: session.endedAt || null,
    status: 'ABSENT',
    guest: false,
    rosterMissing: false,
    late: false,
    connected: false,
    joinedAt: null,
    leftAt: null,
    durationMs: 0,
    answeredCount: 0,
    correctCount: 0,
    totalQuestions: session.gameQuestions?.length || 0,
    score: 0,
    bestStreak: 0,
    finalRank: null,
    totalResponseTimeMs: 0,
    finalizedAt: new Date(),
  };
}

function buildSectionSummaries(records) {
  const map = new Map();

  for (const record of records) {
    const key = toId(record.section) || 'unassigned';
    const entry =
      map.get(key) ||
      {
        section: toId(record.section),
        sectionName: record.sectionName || 'Unassigned',
        registered: 0,
        joined: 0,
        present: 0,
        absent: 0,
        kicked: 0,
        pending: 0,
        guests: 0,
        late: 0,
        attendedSessions: 0,
        totalScore: 0,
        answeredCount: 0,
        correctCount: 0,
      };

    if (record.guest) {
      entry.guests += 1;
    } else {
      entry.registered += 1;
    }

    if (record.participant) {
      entry.joined += 1;
      entry.attendedSessions += 1;
      entry.totalScore += record.score || 0;
    }

    if (record.status === 'PRESENT') {
      entry.present += 1;
    } else if (record.status === 'ABSENT') {
      entry.absent += 1;
    } else if (record.status === 'KICKED') {
      entry.kicked += 1;
    } else {
      entry.pending += 1;
    }

    if (record.late) {
      entry.late += 1;
    }

    entry.answeredCount += record.answeredCount || 0;
    entry.correctCount += record.correctCount || 0;

    map.set(key, entry);
  }

  return [...map.values()]
    .map((entry) => {
      const averageScore = entry.attendedSessions
        ? round(entry.totalScore / entry.attendedSessions, 2)
        : 0;
      const attendanceRate = entry.registered
        ? round(entry.present / entry.registered, 4)
        : 0;

      return serializeSectionSummary({
        ...entry,
        averageScore,
        attendanceRate,
        attendancePercentage: round(attendanceRate * 100, 2),
        accuracy: ratio(entry.correctCount, entry.answeredCount),
        accuracyPercentage: percentage(entry.correctCount, entry.answeredCount),
      });
    })
    .sort((a, b) => a.sectionName.localeCompare(b.sectionName));
}

function summarizeRecords(records) {
  const counts = {
    registered: 0,
    joined: 0,
    present: 0,
    absent: 0,
    kicked: 0,
    pending: 0,
    guests: 0,
    late: 0,
  };

  for (const record of records) {
    if (record.guest) {
      counts.guests += 1;
    } else {
      counts.registered += 1;
    }

    if (record.participant) {
      counts.joined += 1;
    }

    if (record.status === 'PRESENT') {
      counts.present += 1;
    } else if (record.status === 'ABSENT') {
      counts.absent += 1;
    } else if (record.status === 'KICKED') {
      counts.kicked += 1;
    } else {
      counts.pending += 1;
    }

    if (record.late) {
      counts.late += 1;
    }
  }

  const rosterPresent = records.filter(
    (record) => !record.guest && record.status === 'PRESENT'
  ).length;
  const attendanceRate = counts.registered
    ? round(rosterPresent / counts.registered, 4)
    : 0;
  const participationRate =
    counts.registered + counts.guests > 0
      ? round(counts.joined / (counts.registered + counts.guests), 4)
      : 0;

  return {
    counts: {
      ...counts,
      attendanceRate,
      attendancePercentage: round(attendanceRate * 100, 2),
      participationRate,
      participationPercentage: round(participationRate * 100, 2),
    },
    sections: buildSectionSummaries(records),
  };
}

function compareRecords(a, b) {
  const aRank = a.finalRank ?? Number.MAX_SAFE_INTEGER;
  const bRank = b.finalRank ?? Number.MAX_SAFE_INTEGER;

  if (aRank !== bRank) {
    return aRank - bRank;
  }

  if ((b.score || 0) !== (a.score || 0)) {
    return (b.score || 0) - (a.score || 0);
  }

  if (Boolean(a.participant) !== Boolean(b.participant)) {
    return a.participant ? -1 : 1;
  }

  return a.name.localeCompare(b.name);
}

function buildSessionInfo(session, quiz) {
  return {
    id: session._id.toString(),
    organization: toId(session.organization),
    createdBy: toId(session.createdBy),
    status: session.status,
    joinCode: session.joinCode,
    startedAt: session.startedAt || null,
    endedAt: session.endedAt || null,
    totalQuestions: session.gameQuestions?.length || 0,
    attendanceThreshold: getSessionThreshold(session),
    attendanceFinalizedAt: session.attendanceFinalizedAt || null,
    quiz: {
      id: toId(session.quiz),
      title: quiz?.title || '',
      description: quiz?.description || '',
    },
  };
}

async function upsertAttendanceRecord(filter, record) {
  try {
    await Attendance.updateOne(filter, { $set: record }, { upsert: true });
  } catch (error) {
    if (error?.code === 11000) {
      await Attendance.updateOne(filter, { $set: record });
      return;
    }

    throw error;
  }
}

async function finalizeSessionAttendance(session, { force = false } = {}) {
  if (!session || session.status !== 'FINISHED') {
    throw new AppError(
      'Attendance can only be finalized for finished sessions',
      409
    );
  }

  if (session.attendanceFinalizedAt && !force) {
    return { finalized: true, session };
  }

  const [participants, answers, students, sections, quiz] = await Promise.all([
    SessionPlayer.find({ session: session._id }).sort({
      joinedAt: 1,
      _id: 1,
    }),
    Answer.find({ session: session._id }),
    Student.find({ organization: session.organization }),
    Section.find({ organization: session.organization }),
    Quiz.findOne({ _id: session.quiz, organization: session.organization }),
  ]);

  const studentsById = new Map(
    students.map((student) => [student._id.toString(), student])
  );
  const sectionsById = new Map(
    sections.map((section) => [section._id.toString(), section])
  );
  const { byParticipant } = buildAnswerIndex(answers);
  const threshold = getSessionThreshold(session);
  const questionCount = session.gameQuestions?.length || 0;
  const now = new Date();
  const attendeeStudentIds = new Set();
  const records = [];

  for (const participant of participants) {
    const student = participant.student
      ? studentsById.get(participant.student.toString())
      : null;

    if (participant.student) {
      attendeeStudentIds.add(participant.student.toString());
    }

    const section = participant.section || student?.section || null;
    const sectionName = section
      ? sectionsById.get(section.toString())?.name || ''
      : '';
    const stats = summarizeAnswers(
      byParticipant.get(participant._id.toString()) || []
    );
    const status = computeAttendanceStatus({
      answeredCount: stats.answeredCount,
      questionCount,
      threshold,
      kicked: participant.status === 'KICKED',
      finished: true,
    });
    const record = buildAttendanceRecord({
      session,
      quiz,
      participant,
      student,
      section,
      sectionName,
      stats,
      status,
      now,
    });

    records.push({
      filter: participant.student
        ? { session: session._id, student: participant.student }
        : { session: session._id, participant: participant._id },
      record,
    });
  }

  for (const student of students) {
    if (attendeeStudentIds.has(student._id.toString())) {
      continue;
    }

    const sectionName = student.section
      ? sectionsById.get(student.section.toString())?.name || ''
      : '';

    records.push({
      filter: { session: session._id, student: student._id },
      record: buildAbsenteeRecord({
        session,
        quiz,
        student,
        section: student.section,
        sectionName,
      }),
    });
  }

  // If a student joined after an earlier (forced) finalization, remove the
  // stale absentee row before upserting the attendee row.
  if (attendeeStudentIds.size > 0) {
    await Attendance.deleteMany({
      session: session._id,
      participant: null,
      student: {
        $in: [...attendeeStudentIds].map(
          (id) => new mongoose.Types.ObjectId(id)
        ),
      },
    });
  }

  for (const entry of records) {
    await upsertAttendanceRecord(entry.filter, entry.record);
  }

  const finalizedAt = session.endedAt || now;
  await Session.updateOne(
    { _id: session._id },
    { $set: { attendanceFinalizedAt: finalizedAt } }
  );
  session.attendanceFinalizedAt = finalizedAt;

  return { finalized: true, session };
}

async function ensureSessionAttendance(session) {
  if (session.status !== 'FINISHED') {
    return false;
  }

  if (session.attendanceFinalizedAt) {
    return true;
  }

  await finalizeSessionAttendance(session);
  return true;
}

async function buildLiveRecords(session, quiz) {
  const [participants, answers, students, sections] = await Promise.all([
    SessionPlayer.find({ session: session._id }).sort({
      joinedAt: 1,
      _id: 1,
    }),
    Answer.find({ session: session._id }),
    Student.find({ organization: session.organization }),
    Section.find({ organization: session.organization }),
  ]);

  const studentsById = new Map(
    students.map((student) => [student._id.toString(), student])
  );
  const sectionsById = new Map(
    sections.map((section) => [section._id.toString(), section])
  );
  const { byParticipant } = buildAnswerIndex(answers);
  const threshold = getSessionThreshold(session);
  const questionCount = session.gameQuestions?.length || 0;
  const now = new Date();
  const attendeeStudentIds = new Set();
  const records = [];

  for (const participant of participants) {
    const student = participant.student
      ? studentsById.get(participant.student.toString())
      : null;

    if (participant.student) {
      attendeeStudentIds.add(participant.student.toString());
    }

    const section = participant.section || student?.section || null;
    const sectionName = section
      ? sectionsById.get(section.toString())?.name || ''
      : '';
    const stats = summarizeAnswers(
      byParticipant.get(participant._id.toString()) || []
    );
    const status = computeAttendanceStatus({
      answeredCount: stats.answeredCount,
      questionCount,
      threshold,
      kicked: participant.status === 'KICKED',
      finished: false,
    });

    records.push(
      buildAttendanceRecord({
        session,
        quiz,
        participant,
        student,
        section,
        sectionName,
        stats,
        status,
        now,
      })
    );
  }

  for (const student of students) {
    if (attendeeStudentIds.has(student._id.toString())) {
      continue;
    }

    const sectionName = student.section
      ? sectionsById.get(student.section.toString())?.name || ''
      : '';
    const record = buildAbsenteeRecord({
      session,
      quiz,
      student,
      section: student.section,
      sectionName,
    });

    records.push({ ...record, status: 'PENDING' });
  }

  return records;
}

async function getSessionAttendance(
  organizationId,
  sessionId,
  { section, status } = {}
) {
  const session = await findOrganizationSession(organizationId, sessionId);
  const quiz = await Quiz.findOne({
    _id: session.quiz,
    organization: organizationId,
  });
  const finalized = session.status === 'FINISHED';
  let records;

  if (finalized) {
    await ensureSessionAttendance(session);

    const filter = { organization: organizationId, session: session._id };

    if (section) {
      filter.section = section;
    }

    if (status) {
      filter.status = status;
    }

    records = await Attendance.find(filter);
    records.sort(compareRecords);
  } else {
    records = await buildLiveRecords(session, quiz);

    if (section) {
      records = records.filter(
        (record) => toId(record.section) === section.toString()
      );
    }

    if (status) {
      records = records.filter((record) => record.status === status);
    }

    records.sort(compareRecords);
  }

  const summary = summarizeRecords(records);

  return {
    session: buildSessionInfo(session, quiz),
    finalized,
    filters: {
      section: section || null,
      status: status || null,
    },
    counts: summary.counts,
    sections: summary.sections,
    records: records.map(serializeAttendanceRecord),
  };
}

function buildQuestionAnalysis(session, answersByQuestion, joinedCount) {
  return (session.gameQuestions || []).map((question, index) => {
    const questionId = question.question.toString();
    const questionAnswers = answersByQuestion.get(questionId) || [];
    const totalAnswers = questionAnswers.length;
    const correctAnswers = questionAnswers.filter(
      (answer) => answer.isCorrect
    ).length;
    const responseTimeTotal = questionAnswers.reduce(
      (sum, answer) => sum + (answer.responseTimeMs || 0),
      0
    );
    const answerDistribution = (question.options || []).map((option) => {
      const optionId = option.optionId.toString();
      const count = questionAnswers.filter(
        (answer) => answer.selectedOptionId.toString() === optionId
      ).length;

      return {
        optionId,
        text: option.text,
        isCorrect: Boolean(option.isCorrect),
        count,
        percentage: percentage(count, totalAnswers),
      };
    });
    const correctOption = answerDistribution.find(
      (option) => option.isCorrect
    );
    const mostCommonWrongOption =
      answerDistribution
        .filter((option) => !option.isCorrect && option.count > 0)
        .sort((a, b) => b.count - a.count || a.text.localeCompare(b.text))[0] ||
      null;

    return {
      index,
      questionId,
      text: question.text,
      points: question.points,
      timeLimitSec: question.timeLimitSec,
      order: question.order ?? index,
      correctOptionId: correctOption?.optionId || null,
      totalAnswers,
      correctAnswers,
      incorrectAnswers: totalAnswers - correctAnswers,
      skippedCount: Math.max(0, joinedCount - totalAnswers),
      accuracy: ratio(correctAnswers, totalAnswers),
      accuracyPercentage: percentage(correctAnswers, totalAnswers),
      averageResponseTimeMs:
        totalAnswers > 0 ? Math.round(responseTimeTotal / totalAnswers) : 0,
      answerDistribution,
      mostCommonWrongOption: mostCommonWrongOption
        ? {
            optionId: mostCommonWrongOption.optionId,
            text: mostCommonWrongOption.text,
            count: mostCommonWrongOption.count,
            percentage: mostCommonWrongOption.percentage,
          }
        : null,
    };
  });
}

function buildStudentAnalysis(session, records, answersByParticipant) {
  return records.map((record) => {
    const participantAnswers = record.participant
      ? answersByParticipant.get(record.participant) || []
      : [];
    const answersByQuestion = new Map(
      participantAnswers.map((answer) => [
        answer.question.toString(),
        answer,
      ])
    );
    const wrongQuestions = [];
    const unansweredQuestions = [];

    for (const [index, question] of (session.gameQuestions || []).entries()) {
      const questionId = question.question.toString();
      const answer = answersByQuestion.get(questionId);

      if (!answer) {
        if (record.participant) {
          unansweredQuestions.push({
            index,
            questionId,
            text: question.text,
          });
        }
      } else if (!answer.isCorrect) {
        wrongQuestions.push({
          index,
          questionId,
          text: question.text,
          selectedOptionId: answer.selectedOptionId?.toString() || null,
          responseTimeMs: answer.responseTimeMs || 0,
        });
      }
    }

    const answeredCount = participantAnswers.length;
    const correctCount = participantAnswers.filter(
      (answer) => answer.isCorrect
    ).length;
    const accuracy = ratio(correctCount, answeredCount);
    const followUpReasons = [];

    if (record.status === 'ABSENT') {
      followUpReasons.push('ABSENT');
    }

    if (record.status === 'KICKED') {
      followUpReasons.push('KICKED');
    }

    if (answeredCount > 0 && accuracy < 0.5) {
      followUpReasons.push('LOW_ACCURACY');
    }

    if (record.participant && unansweredQuestions.length > 0) {
      followUpReasons.push('UNANSWERED_QUESTIONS');
    }

    return {
      student: record.student,
      participant: record.participant,
      section: record.section,
      sectionName: record.sectionName,
      name: record.name,
      nickname: record.nickname,
      status: record.status,
      guest: record.guest,
      rosterMissing: record.rosterMissing,
      late: record.late,
      joinedAt: record.joinedAt,
      leftAt: record.leftAt,
      durationMs: record.durationMs,
      answeredCount,
      correctCount,
      incorrectCount: Math.max(0, answeredCount - correctCount),
      totalQuestions: session.gameQuestions?.length || 0,
      accuracy,
      accuracyPercentage: percentage(correctCount, answeredCount),
      score: record.score,
      finalRank: record.finalRank,
      bestStreak: record.bestStreak || 0,
      totalResponseTimeMs: record.totalResponseTimeMs,
      averageResponseTimeMs:
        answeredCount > 0
          ? Math.round(record.totalResponseTimeMs / answeredCount)
          : 0,
      wrongQuestionCount: wrongQuestions.length,
      unansweredCount: unansweredQuestions.length,
      wrongQuestions,
      unansweredQuestions,
      needsFollowUp: followUpReasons.length > 0,
      followUpReasons,
    };
  });
}

function buildCommandStats(commands, participantsById) {
  const byType = {};
  const byStatus = {};

  for (const type of COMMAND_TYPES) {
    byType[type] = {
      total: 0,
      completed: 0,
      cancelled: 0,
      pending: 0,
    };
  }

  for (const command of commands) {
    if (!byType[command.type]) {
      byType[command.type] = {
        total: 0,
        completed: 0,
        cancelled: 0,
        pending: 0,
      };
    }

    byType[command.type].total += 1;

    if (command.status === 'COMPLETED') {
      byType[command.type].completed += 1;
    } else if (command.status === 'CANCELLED') {
      byType[command.type].cancelled += 1;
    } else {
      byType[command.type].pending += 1;
    }

    byStatus[command.status] = (byStatus[command.status] || 0) + 1;
  }

  return {
    total: commands.length,
    byType,
    byStatus,
    log: commands.map((command) =>
      serializeCommandLogEntry(command, participantsById)
    ),
  };
}

async function getSessionReport(organizationId, sessionId) {
  const session = await findOrganizationSession(organizationId, sessionId);

  if (session.status !== 'FINISHED') {
    throw new AppError(
      'Reports are only available for finished sessions',
      409
    );
  }

  await ensureSessionAttendance(session);

  const [attendanceRecords, answers, commands, quiz] = await Promise.all([
    Attendance.find({ organization: organizationId, session: session._id }),
    Answer.find({ organization: organizationId, session: session._id }),
    SessionCommand.find({
      organization: organizationId,
      session: session._id,
    }).sort({ createdAt: 1, _id: 1 }),
    Quiz.findOne({ _id: session.quiz, organization: organizationId }),
  ]);

  attendanceRecords.sort(compareRecords);

  const records = attendanceRecords.map(serializeAttendanceRecord);
  const joinedRecords = records.filter((record) => record.participant);
  const { byParticipant, byQuestion } = buildAnswerIndex(answers);
  const summary = summarizeRecords(attendanceRecords);
  const totalAnswers = answers.length;
  const correctAnswers = answers.filter((answer) => answer.isCorrect).length;
  const incorrectAnswers = totalAnswers - correctAnswers;
  const totalResponseTimeMs = answers.reduce(
    (sum, answer) => sum + (answer.responseTimeMs || 0),
    0
  );
  const questionAnalysis = buildQuestionAnalysis(
    session,
    byQuestion,
    joinedRecords.length
  );
  const hardestQuestionEntry = [...questionAnalysis]
    .filter((question) => question.totalAnswers > 0)
    .sort(
      (a, b) =>
        a.accuracy - b.accuracy || b.totalAnswers - a.totalAnswers
    )[0];
  const participantsById = new Map();

  for (const record of attendanceRecords) {
    if (record.participant) {
      participantsById.set(record.participant.toString(), {
        name: record.name,
        nickname: record.nickname,
      });
    }
  }

  const averageScore =
    joinedRecords.length > 0
      ? round(
          joinedRecords.reduce((sum, record) => sum + record.score, 0) /
            joinedRecords.length,
          2
        )
      : 0;
  const averageCorrectAnswers =
    joinedRecords.length > 0
      ? round(
          joinedRecords.reduce(
            (sum, record) => sum + record.correctCount,
            0
          ) / joinedRecords.length,
          2
        )
      : 0;
  const recordsWithAnswers = joinedRecords.filter(
    (record) => record.answeredCount > 0
  );
  const averageAccuracy =
    recordsWithAnswers.length > 0
      ? round(
          recordsWithAnswers.reduce(
            (sum, record) => sum + record.accuracy,
            0
          ) / recordsWithAnswers.length,
          4
        )
      : 0;
  const gameDurationMs =
    session.startedAt && session.endedAt
      ? Math.max(
          0,
          new Date(session.endedAt).getTime() -
            new Date(session.startedAt).getTime()
        )
      : 0;
  const topPlayers = joinedRecords
    .filter((record) => record.status !== 'KICKED')
    .sort(
      (a, b) =>
        b.score - a.score ||
        a.averageResponseTimeMs - b.averageResponseTimeMs ||
        (a.finalRank ?? Number.MAX_SAFE_INTEGER) -
          (b.finalRank ?? Number.MAX_SAFE_INTEGER) ||
        a.name.localeCompare(b.name)
    )
    .slice(0, MAX_TOP_PLAYERS)
    .map((record, index) => ({
      position: index + 1,
      rank: record.finalRank,
      student: record.student,
      participant: record.participant,
      name: record.name,
      nickname: record.nickname,
      section: record.section,
      sectionName: record.sectionName,
      score: record.score,
      answeredCount: record.answeredCount,
      correctCount: record.correctCount,
      accuracy: record.accuracy,
      accuracyPercentage: record.accuracyPercentage,
      averageResponseTimeMs: record.averageResponseTimeMs,
    }));

  return {
    generatedAt: new Date(),
    session: buildSessionInfo(session, quiz),
    attendance: {
      finalized: true,
      counts: summary.counts,
      sections: summary.sections,
    },
    summary: {
      registeredParticipants: summary.counts.registered,
      joinedParticipants: summary.counts.joined,
      actualAttendees: summary.counts.present,
      absentees: summary.counts.absent,
      present: summary.counts.present,
      kicked: summary.counts.kicked,
      guests: summary.counts.guests,
      late: summary.counts.late,
      attendanceRate: summary.counts.attendanceRate,
      attendancePercentage: summary.counts.attendancePercentage,
      participationRate: summary.counts.participationRate,
      participationPercentage: summary.counts.participationPercentage,
      totalAnswers,
      correctAnswers,
      incorrectAnswers,
      accuracy: ratio(correctAnswers, totalAnswers),
      accuracyPercentage: percentage(correctAnswers, totalAnswers),
      averageScore,
      averageCorrectAnswers,
      averageAccuracy,
      averageAccuracyPercentage: round(averageAccuracy * 100, 2),
      averageResponseTimeMs:
        totalAnswers > 0
          ? Math.round(totalResponseTimeMs / totalAnswers)
          : 0,
      gameDurationMs,
      topPlayers,
      hardestQuestion: hardestQuestionEntry
        ? {
            questionId: hardestQuestionEntry.questionId,
            text: hardestQuestionEntry.text,
            accuracy: hardestQuestionEntry.accuracy,
            accuracyPercentage:
              hardestQuestionEntry.accuracyPercentage,
            totalAnswers: hardestQuestionEntry.totalAnswers,
            correctAnswers: hardestQuestionEntry.correctAnswers,
          }
        : null,
    },
    questionAnalysis,
    studentAnalysis: buildStudentAnalysis(
      session,
      records,
      byParticipant
    ),
    commands: buildCommandStats(commands, participantsById),
  };
}

async function exportSessionReport(organizationId, sessionId) {
  // Reuse the report service as the single source of truth so the workbook
  // always matches the JSON report (including finished-session and
  // organization-isolation checks).
  const report = await getSessionReport(organizationId, sessionId);

  const [organization, teacher] = await Promise.all([
    Organization.findOne({ _id: organizationId }).select('name'),
    report.session.createdBy
      ? User.findOne({
          _id: report.session.createdBy,
          organization: organizationId,
        }).select('name')
      : null,
  ]);

  const buffer = await buildSessionReportWorkbook({
    report,
    organizationName: organization?.name || '',
    teacherName: teacher?.name || '',
  });

  return {
    filename: buildExportFilename(report.session),
    contentType:
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    buffer,
    report,
  };
}

async function getStudentHistory(
  organizationId,
  studentId,
  { from, to, session: sessionFilter, quiz: quizFilter, status, limit, offset } = {}
) {
  const student = await Student.findOne({
    _id: studentId,
    organization: organizationId,
  });

  if (!student) {
    throw new AppError('Student not found', 404);
  }

  if (sessionFilter) {
    const session = await Session.findOne({
      _id: sessionFilter,
      organization: organizationId,
    });

    if (!session) {
      throw new AppError('Session not found', 404);
    }
  }

  if (quizFilter) {
    const quiz = await Quiz.findOne({
      _id: quizFilter,
      organization: organizationId,
    });

    if (!quiz) {
      throw new AppError('Quiz not found', 404);
    }
  }

  const filter = { organization: organizationId, student: student._id };

  if (sessionFilter) {
    filter.session = new mongoose.Types.ObjectId(sessionFilter);
  }

  if (quizFilter) {
    filter.quiz = new mongoose.Types.ObjectId(quizFilter);
  }

  if (status) {
    filter.status = status;
  }

  if (from || to) {
    filter.sessionEndedAt = {};

    if (from) {
      filter.sessionEndedAt.$gte = from;
    }

    if (to) {
      filter.sessionEndedAt.$lte = to;
    }
  }

  const pageLimit = limit ?? 50;
  const pageOffset = offset ?? 0;

  const [total, records, aggregate] = await Promise.all([
    Attendance.countDocuments(filter),
    Attendance.find(filter)
      .sort({ sessionEndedAt: -1, createdAt: -1, _id: -1 })
      .skip(pageOffset)
      .limit(pageLimit),
    Attendance.aggregate([
      { $match: filter },
      {
        $group: {
          _id: null,
          present: {
            $sum: { $cond: [{ $eq: ['$status', 'PRESENT'] }, 1, 0] },
          },
          absent: {
            $sum: { $cond: [{ $eq: ['$status', 'ABSENT'] }, 1, 0] },
          },
          kicked: {
            $sum: { $cond: [{ $eq: ['$status', 'KICKED'] }, 1, 0] },
          },
          late: { $sum: { $cond: ['$late', 1, 0] } },
          attendedSessions: {
            $sum: { $cond: [{ $ne: ['$participant', null] }, 1, 0] },
          },
          totalAnswered: { $sum: '$answeredCount' },
          totalCorrect: { $sum: '$correctCount' },
          totalResponseTimeMs: { $sum: '$totalResponseTimeMs' },
          totalScore: {
            $sum: {
              $cond: [{ $ne: ['$participant', null] }, '$score', 0],
            },
          },
          bestScore: {
            $max: {
              $cond: [{ $ne: ['$participant', null] }, '$score', null],
            },
          },
        },
      },
    ]),
  ]);

  const stats = aggregate[0] || {
    present: 0,
    absent: 0,
    kicked: 0,
    late: 0,
    attendedSessions: 0,
    totalAnswered: 0,
    totalCorrect: 0,
    totalResponseTimeMs: 0,
    totalScore: 0,
    bestScore: 0,
  };
  const totalAnswered = stats.totalAnswered || 0;
  const totalCorrect = stats.totalCorrect || 0;
  const attendedSessions = stats.attendedSessions || 0;
  const history = records.map((record) => {
    const serialized = serializeAttendanceRecord(record);

    return {
      ...serialized,
      session: {
        id: serialized.session,
        startedAt: record.sessionStartedAt || null,
        endedAt: record.sessionEndedAt || null,
      },
      quiz: {
        id: toId(record.quiz),
        title: record.quizTitle || '',
      },
    };
  });

  return {
    student: serializeStudent(student),
    filters: {
      from: from || null,
      to: to || null,
      session: sessionFilter || null,
      quiz: quizFilter || null,
      status: status || null,
    },
    pagination: {
      total,
      limit: pageLimit,
      offset: pageOffset,
      hasMore: pageOffset + records.length < total,
    },
    summary: {
      sessions: total,
      attendedSessions,
      present: stats.present || 0,
      absent: stats.absent || 0,
      kicked: stats.kicked || 0,
      late: stats.late || 0,
      totalAnswered,
      totalCorrect,
      accuracy: ratio(totalCorrect, totalAnswered),
      accuracyPercentage: percentage(totalCorrect, totalAnswered),
      averageScore:
        attendedSessions > 0
          ? round((stats.totalScore || 0) / attendedSessions, 2)
          : 0,
      bestScore: stats.bestScore || 0,
      averageResponseTimeMs:
        totalAnswered > 0
          ? Math.round((stats.totalResponseTimeMs || 0) / totalAnswered)
          : 0,
    },
    history,
  };
}

module.exports = {
  DEFAULT_ATTENDANCE_THRESHOLD,
  computeAttendanceStatus,
  ensureSessionAttendance,
  finalizeSessionAttendance,
  getSessionAttendance,
  getSessionReport,
  getStudentHistory,
  exportSessionReport,
};
