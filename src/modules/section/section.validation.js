const { z } = require('zod');

const createSectionSchema = z.strictObject({
  name: z.string().trim().min(1, 'Section name is required').max(100),
  description: z.string().trim().max(500).optional().default(''),
});

const updateSectionSchema = z
  .strictObject({
    name: z.string().trim().min(1, 'Section name is required').max(100).optional(),
    description: z.string().trim().max(500).optional(),
  })
  .refine((data) => Object.keys(data).length > 0, {
    message: 'Provide at least one field to update',
  });

const listSectionsQuerySchema = z.object({
  search: z.string().trim().max(100).optional(),
});

module.exports = {
  createSectionSchema,
  updateSectionSchema,
  listSectionsQuerySchema,
};
