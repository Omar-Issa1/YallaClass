const { z } = require('zod');

const optionSchema = z.strictObject({
  text: z.string().trim().min(1, 'Option text is required').max(500),
  isCorrect: z.boolean().optional().default(false),
});

const optionsSchema = z
  .array(optionSchema)
  .min(2, 'A question must have at least 2 options')
  .max(4, 'A question must have at most 4 options')
  .refine((options) => options.filter((option) => option.isCorrect).length === 1, {
    message: 'Exactly one option must be marked as correct',
  });

const createQuestionSchema = z.strictObject({
  text: z.string().trim().min(1, 'Question text is required').max(1000),
  options: optionsSchema,
  points: z.number().int().min(0).max(10000).optional().default(1000),
  timeLimitSec: z.number().int().min(5).max(120).optional().default(10),
  order: z.number().int().min(0).optional(),
});

const updateQuestionSchema = z
  .strictObject({
    text: z.string().trim().min(1, 'Question text is required').max(1000).optional(),
    options: optionsSchema.optional(),
    points: z.number().int().min(0).max(10000).optional(),
    timeLimitSec: z.number().int().min(5).max(120).optional(),
    order: z.number().int().min(0).optional(),
  })
  .refine((data) => Object.keys(data).length > 0, {
    message: 'Provide at least one field to update',
  });

module.exports = { createQuestionSchema, updateQuestionSchema };
