const { parseArgs } = require('node:util');

const { connectDatabase, disconnectDatabase } = require('../src/config/database');
const User = require('../src/models/user.model');
const { hashPassword } = require('../src/utils/password');

const USAGE =
  'Usage: npm run create-admin -- --name "Admin Name" --email admin@example.com --password "password123"';

async function main() {
  const { values } = parseArgs({
    options: {
      name: { type: 'string' },
      email: { type: 'string' },
      password: { type: 'string' },
    },
  });

  if (!values.name || !values.email || !values.password) {
    console.error(USAGE);
    process.exitCode = 1;
    return;
  }

  const name = values.name.trim();
  const email = values.email.trim().toLowerCase();
  const password = values.password;

  if (name.length < 2) {
    throw new Error('Name must be at least 2 characters');
  }

  if (!/^\S+@\S+\.\S+$/.test(email)) {
    throw new Error('Please provide a valid email address');
  }

  if (password.length < 8 || password.length > 72) {
    throw new Error('Password must be between 8 and 72 characters');
  }

  await connectDatabase();

  const existingUser = await User.findOne({ email });

  if (existingUser) {
    throw new Error(`A user with email ${email} already exists (role: ${existingUser.role})`);
  }

  const passwordHash = await hashPassword(password);

  const admin = await User.create({
    name,
    email,
    passwordHash,
    role: 'ADMIN',
    organization: null,
    status: 'ACTIVE',
  });

  console.log(`ADMIN account created: ${admin.email} (${admin._id.toString()})`);
}

main()
  .catch((error) => {
    console.error(`Failed to create admin: ${error.message}`);
    process.exitCode = 1;
  })
  .finally(async () => {
    await disconnectDatabase().catch(() => {});
  });
