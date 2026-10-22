const { z } = require('zod');

const updateUserStatusSchema = z.strictObject({
  status: z.enum(['ACTIVE', 'SUSPENDED'], {
    message: 'Status must be ACTIVE or SUSPENDED',
  }),
});

module.exports = { updateUserStatusSchema };
