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

  let shuttingDown = false;

  async function shutdown(signal) {
    if (shuttingDown) {
      return;
    }

    shuttingDown = true;
    console.log(`\n${signal} received. Shutting down...`);

    const forceExitTimer = setTimeout(() => {
      console.error('Shutdown timed out. Forcing exit.');
      process.exit(1);
    }, 10000);

    forceExitTimer.unref();

    try {
      await new Promise((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
      await disconnectDatabase();
      clearTimeout(forceExitTimer);
      process.exit(0);
    } catch (error) {
      console.error(`Error during shutdown: ${error.message}`);
      process.exit(1);
    }
  }

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

start();
