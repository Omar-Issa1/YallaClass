const path = require('path');

require('dotenv').config({ path: path.resolve(__dirname, '..', '..', '.env'), quiet: true });

const { z } = require('zod');

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(4000),
  MONGODB_URI: z.string().min(1, 'MONGODB_URI is required in .env'),
  JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters in .env'),
  JWT_EXPIRES_IN: z
    .string()
    .trim()
    .min(1, 'JWT_EXPIRES_IN is required in .env')
    .default('7d'),
  CORS_ORIGIN: z.string().trim().min(1).default('*'),
});

const result = envSchema.safeParse(process.env);

if (!result.success) {
  const details = result.error.issues
    .map((issue) => `- ${issue.path.join('.')}: ${issue.message}`)
    .join('\n');

  console.error(`Invalid environment variables:\n${details}`);
  process.exit(1);
}

module.exports = result.data;
