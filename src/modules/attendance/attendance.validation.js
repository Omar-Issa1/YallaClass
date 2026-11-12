const mongoose = require('mongoose');
const { z } = require('zod');

const { ATTENDANCE_STATUSES } = require('../../models/attendance.model');

const objectIdSchema = z
  .string()
  .refine((value) => mongoose.isValidObjectId(value), 'Invalid id');

const dateSchema = z
  .string()
  .trim()
  .refine((value) => !Number.isNaN(Date.parse(value)), 'Invalid date')
  .transform((value) => new Date(value));

const sessionAttendanceQuerySchema = z.object({
  section: objectIdSchema.optional(),
  status: z.enum(ATTENDANCE_STATUSES).optional(),
});

const studentHistoryQuerySchema = z
  .object({
    from: dateSchema.optional(),
    to: dateSchema.optional(),
    session: objectIdSchema.optional(),
    quiz: objectIdSchema.optional(),
    status: z.enum(ATTENDANCE_STATUSES).optional(),
    limit: z.coerce.number().int().min(1).max(100).default(50),
    offset: z.coerce.number().int().min(0).default(0),
  })
  .refine((data) => !data.from || !data.to || data.from <= data.to, {
    message: 'from must be before or equal to to',
    path: ['from'],
  });

module.exports = {
  sessionAttendanceQuerySchema,
  studentHistoryQuerySchema,
};
