const { z } = require('zod');

const loginSchema = z.strictObject({
  email: z
    .string()
    .trim()
    .toLowerCase()
    .email('Please provide a valid email address'),
  password: z.string().min(1, 'Password is required'),
});

module.exports = { loginSchema };
