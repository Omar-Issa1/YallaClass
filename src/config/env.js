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
  JOIN_BASE_URL: z.string().trim().min(1).default('http://localhost:3000/join'),
  GAME_COUNTDOWN_MS: z.coerce.number().int().min(0).default(3000),
  GAME_REVEAL_MS: z.coerce.number().int().min(0).default(5000),
  GAME_EXPLANATION_MS: z.coerce.number().int().min(0).default(5000),
  GAME_POINTS_MS: z.coerce.number().int().min(0).default(3000),
  GAME_LEADERBOARD_MS: z.coerce.number().int().min(0).default(5000),
  GAME_PHONE_LEADERBOARD_MS: z.coerce.number().int().min(0).default(3000),
  COMMAND_SELECTION_TIMEOUT_MS: z.coerce.number().int().min(100).default(12000),
  COMMAND_THIEF_CHANCE: z.coerce.number().min(0).max(1).default(0.35),
  AUTH_RATE_LIMIT_WINDOW_MS: z.coerce.number().int().min(1000).default(900000),
  AUTH_RATE_LIMIT_MAX: z.coerce.number().int().min(1).default(20),
  JOIN_RATE_LIMIT_WINDOW_MS: z.coerce.number().int().min(1000).default(60000),
  JOIN_RATE_LIMIT_MAX: z.coerce.number().int().min(1).default(120),
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
