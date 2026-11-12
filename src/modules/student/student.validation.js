const mongoose = require('mongoose');
const { z } = require('zod');

const { AVATAR_PRESET_IDS, AVATAR_COLOR_IDS } = require('../../constants/avatar');

const objectIdSchema = z
  .string()
  .refine((value) => mongoose.isValidObjectId(value), 'Invalid id');

const avatarSchema = z
  .strictObject({
    preset: z.enum(AVATAR_PRESET_IDS).optional(),
    color: z.enum(AVATAR_COLOR_IDS).optional(),
  })
  .refine((data) => Object.keys(data).length > 0, {
    message: 'Provide at least one avatar field',
  });

const studentFields = {
  name: z.string().trim().min(1, 'Student name is required').max(80),
  nickname: z.string().trim().max(50).optional().default(''),
  avatar: avatarSchema.optional(),
};

const createStudentSchema = z.strictObject({
  ...studentFields,
  section: objectIdSchema,
});

const importStudentsSchema = z.strictObject({
  section: objectIdSchema,
  students: z
    .array(z.strictObject(studentFields))
    .min(1, 'Provide at least one student')
    .max(500, 'Import at most 500 students at a time'),
});

const updateStudentSchema = z
  .strictObject({
    name: studentFields.name.optional(),
    nickname: z.string().trim().max(50).optional(),
    section: objectIdSchema.optional(),
    avatar: avatarSchema.optional(),
  })
  .refine((data) => Object.keys(data).length > 0, {
    message: 'Provide at least one field to update',
  });

const updateAvatarSchema = z
  .strictObject({
    preset: z.enum(AVATAR_PRESET_IDS).optional(),
    color: z.enum(AVATAR_COLOR_IDS).optional(),
  })
  .refine((data) => Object.keys(data).length > 0, {
    message: 'Provide at least one avatar field',
  });

const listStudentsQuerySchema = z.object({
  search: z.string().trim().max(100).optional(),
  section: objectIdSchema.optional(),
});

module.exports = {
  createStudentSchema,
  importStudentsSchema,
  updateStudentSchema,
  updateAvatarSchema,
  listStudentsQuerySchema,
};
