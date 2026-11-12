const mongoose = require('mongoose');

const ATTENDANCE_STATUSES = ['PRESENT', 'ABSENT', 'KICKED', 'PENDING'];

const attendanceSchema = new mongoose.Schema(
  {
    session: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Session',
      required: true,
      index: true,
    },
    organization: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Organization',
      required: true,
      index: true,
    },
    student: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Student',
      default: null,
      index: true,
    },
    participant: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'SessionPlayer',
      default: null,
      index: true,
    },
    section: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Section',
      default: null,
      index: true,
    },
    sectionName: {
      type: String,
      trim: true,
      default: '',
      maxlength: 100,
    },
    name: {
      type: String,
      required: true,
      trim: true,
      maxlength: 80,
    },
    nickname: {
      type: String,
      required: true,
      trim: true,
      maxlength: 50,
    },
    quiz: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Quiz',
      default: null,
      index: true,
    },
    quizTitle: {
      type: String,
      trim: true,
      default: '',
      maxlength: 150,
    },
    sessionStartedAt: {
      type: Date,
      default: null,
    },
    sessionEndedAt: {
      type: Date,
      default: null,
      index: true,
    },
    status: {
      type: String,
      enum: ATTENDANCE_STATUSES,
      default: 'PENDING',
      index: true,
    },
    guest: {
      type: Boolean,
      default: false,
    },
    rosterMissing: {
      type: Boolean,
      default: false,
    },
    late: {
      type: Boolean,
      default: false,
    },
    connected: {
      type: Boolean,
      default: false,
    },
    joinedAt: {
      type: Date,
      default: null,
    },
    leftAt: {
      type: Date,
      default: null,
    },
    durationMs: {
      type: Number,
      default: 0,
      min: 0,
    },
    answeredCount: {
      type: Number,
      default: 0,
      min: 0,
    },
    correctCount: {
      type: Number,
      default: 0,
      min: 0,
    },
    totalQuestions: {
      type: Number,
      default: 0,
      min: 0,
    },
    score: {
      type: Number,
      default: 0,
      min: 0,
    },
    bestStreak: {
      type: Number,
      default: 0,
      min: 0,
    },
    finalRank: {
      type: Number,
      default: null,
      min: 1,
    },
    totalResponseTimeMs: {
      type: Number,
      default: 0,
      min: 0,
    },
    finalizedAt: {
      type: Date,
      default: null,
    },
  },
  { timestamps: true }
);

// A roster student can only have one attendance record per session.
attendanceSchema.index(
  { session: 1, student: 1 },
  {
    unique: true,
    partialFilterExpression: { student: { $type: 'objectId' } },
  }
);

// A participant (including a guest without a Student) can only have one record.
attendanceSchema.index(
  { session: 1, participant: 1 },
  {
    unique: true,
    partialFilterExpression: { participant: { $type: 'objectId' } },
  }
);

attendanceSchema.index({ organization: 1, session: 1, status: 1 });
attendanceSchema.index({ organization: 1, student: 1, sessionEndedAt: -1 });
attendanceSchema.index({ organization: 1, student: 1, createdAt: -1 });

const Attendance = mongoose.model('Attendance', attendanceSchema);

module.exports = Attendance;
module.exports.ATTENDANCE_STATUSES = ATTENDANCE_STATUSES;
