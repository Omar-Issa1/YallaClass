const { z } = require('zod');

const updateUserStatusSchema = z.strictObject({
  status: z.enum(['ACTIVE', 'SUSPENDED'], {
    message: 'Status must be ACTIVE or SUSPENDED',
  }),
});

const organizationNameSchema = z
  .string()
  .trim()
  .min(2, 'Organization name must be at least 2 characters')
  .max(100);

const ownerNameSchema = z
  .string()
  .trim()
  .min(2, 'Name must be at least 2 characters')
  .max(80);

const ownerEmailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .email('Please provide a valid email address');

const ownerPasswordSchema = z
  .string()
  .min(8, 'Password must be at least 8 characters')
  .max(72, 'Password must be at most 72 characters');

const createOrganizationSchema = z.strictObject({
  name: organizationNameSchema,
  owner: z.strictObject({
    name: ownerNameSchema,
    email: ownerEmailSchema,
    password: ownerPasswordSchema,
  }),
});

const updateOrganizationSchema = z
  .strictObject({
    name: organizationNameSchema.optional(),
  })
  .refine((data) => Object.keys(data).length > 0, {
    message: 'Provide at least one field to update',
  });

const updateOrganizationStatusSchema = z.strictObject({
  status: z.enum(['ACTIVE', 'SUSPENDED'], {
    message: 'Status must be ACTIVE or SUSPENDED',
  }),
});

module.exports = {
  updateUserStatusSchema,
  createOrganizationSchema,
  updateOrganizationSchema,
  updateOrganizationStatusSchema,
};
