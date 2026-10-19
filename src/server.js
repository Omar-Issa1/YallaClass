const app = require('./app');
const env = require('./config/env');
const { connectDatabase, disconnectDatabase } = require('./config/database');

async function start() {
  try {
    await connectDatabase();
  } catch (error) {
    console.error('Could not connect to MongoDB.');
    console.error(`Error: ${error.message}`);
    console.error('Make sure MongoDB is running and MONGODB_URI in .env is correct.');
    process.exit(1);
  }

  const server = app.listen(env.PORT, () => {
    console.log(`Yalla Class API is running on http://localhost:${env.PORT}`);
  });

  async function shutdown(signal) {
    console.log(`\n${signal} received. Shutting down...`);
    server.close();
    await disconnectDatabase();
    process.exit(0);
  }

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

start();
