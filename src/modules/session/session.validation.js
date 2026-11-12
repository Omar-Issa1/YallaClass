const mongoose = require('mongoose');
const { z } = require('zod');

const { SESSION_STATUSES } = require('../../models/session.model');

const objectIdSchema = z
  .string()
  .refine((value) => mongoose.isValidObjectId(value), 'Invalid id');

const createSessionSchema = z.strictObject({
  quiz: objectIdSchema,
});

const listSessionsQuerySchema = z.object({
  status: z.enum(SESSION_STATUSES).optional(),
  quiz: objectIdSchema.optional(),
  search: z.string().trim().max(100).optional(),
});

const setJoinOpenSchema = z.strictObject({
  joinOpen: z.boolean({ message: 'joinOpen must be a boolean' }),
});

const commandSettingsSchema = z
  .strictObject({
    gift: z.boolean().optional(),
    thief: z.boolean().optional(),
    rocket: z.boolean().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: 'At least one command setting is required',
  });

const phaseDurationSchema = z.number().int().min(0).max(600000);

const phaseSettingsSchema = z
  .strictObject({
    revealMs: phaseDurationSchema.optional(),
    explanationMs: phaseDurationSchema.optional(),
    pointsMs: phaseDurationSchema.optional(),
    leaderboardMs: phaseDurationSchema.optional(),
    phoneLeaderboardMs: phaseDurationSchema.optional(),
    showReveal: z.boolean().optional(),
    showExplanation: z.boolean().optional(),
    showPoints: z.boolean().optional(),
    showLeaderboard: z.boolean().optional(),
    showPhoneLeaderboard: z.boolean().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: 'At least one phase setting is required',
  });

module.exports = {
  createSessionSchema,
  listSessionsQuerySchema,
  setJoinOpenSchema,
  commandSettingsSchema,
  phaseSettingsSchema,
};
