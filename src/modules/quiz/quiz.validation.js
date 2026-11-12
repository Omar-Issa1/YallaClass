const { z } = require('zod');

const createQuizSchema = z.strictObject({
  title: z.string().trim().min(1, 'Title is required').max(150),
  description: z.string().trim().max(1000).optional().default(''),
});

const updateQuizSchema = z
  .strictObject({
    title: z.string().trim().min(1, 'Title is required').max(150).optional(),
    description: z.string().trim().max(1000).optional(),
  })
  .refine((data) => Object.keys(data).length > 0, {
    message: 'Provide at least one field to update',
  });

const listQuizzesQuerySchema = z.object({
  search: z.string().trim().max(100).optional(),
  status: z.enum(['ACTIVE', 'ARCHIVED', 'ALL']).optional().default('ACTIVE'),
});

module.exports = { createQuizSchema, updateQuizSchema, listQuizzesQuerySchema };
