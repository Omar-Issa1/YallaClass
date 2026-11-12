const mongoose = require('mongoose');
const { z } = require('zod');

const { AVATAR_PRESET_IDS, AVATAR_COLOR_IDS } = require('../../constants/avatar');

const GAME_CODE_REGEX = /^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{6}$/i;

const objectIdSchema = z
  .string()
  .refine((value) => mongoose.isValidObjectId(value), 'Invalid id');

const gameCodeParamsSchema = z.object({
  code: z
    .string()
    .trim()
    .regex(GAME_CODE_REGEX, 'Invalid game code')
    .transform((value) => value.toUpperCase()),
});

const avatarSchema = z
  .strictObject({
    preset: z.enum(AVATAR_PRESET_IDS).optional(),
    color: z.enum(AVATAR_COLOR_IDS).optional(),
  })
  .refine((data) => Object.keys(data).length > 0, {
    message: 'Provide at least one avatar field',
  });

const joinSessionSchema = z
  .strictObject({
    nickname: z.string().trim().min(1, 'Nickname is required').max(50).optional(),
    name: z.string().trim().min(1, 'Name is required').max(80).optional(),
    studentId: objectIdSchema.optional(),
    section: objectIdSchema.optional(),
    avatar: avatarSchema.optional(),
    participantToken: z.string().trim().min(20).max(200).optional(),
  })
  .refine((data) => data.nickname || data.studentId || data.participantToken, {
    message: 'Provide a nickname, a studentId, or a participantToken',
    path: ['nickname'],
  });

const reconnectSchema = z.strictObject({
  participantToken: z
    .string()
    .trim()
    .min(20, 'participantToken is required')
    .max(200),
});

module.exports = {
  gameCodeParamsSchema,
  joinSessionSchema,
  reconnectSchema,
};
