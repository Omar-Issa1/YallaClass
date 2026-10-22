const { z } = require('zod');

const updateOrganizationSchema = z.strictObject({
  name: z
    .string()
    .trim()
    .min(2, 'Organization name must be at least 2 characters')
    .max(100),
});

const addMemberSchema = z.strictObject({
  name: z.string().trim().min(2, 'Name must be at least 2 characters').max(80),
  email: z
    .string()
    .trim()
    .toLowerCase()
    .email('Please provide a valid email address'),
  password: z
    .string()
    .min(8, 'Password must be at least 8 characters')
    .max(72, 'Password must be at most 72 characters'),
  role: z.enum(['TEACHER', 'ASSISTANT'], {
    message: 'Role must be TEACHER or ASSISTANT',
  }),
});

const updateMemberSchema = z
  .strictObject({
    name: z.string().trim().min(2, 'Name must be at least 2 characters').max(80).optional(),
    role: z
      .enum(['TEACHER', 'ASSISTANT'], {
        message: 'Role must be TEACHER or ASSISTANT',
      })
      .optional(),
    status: z.enum(['ACTIVE', 'SUSPENDED']).optional(),
  })
  .refine((data) => Object.keys(data).length > 0, {
    message: 'Provide at least one field to update',
  });

module.exports = { updateOrganizationSchema, addMemberSchema, updateMemberSchema };
