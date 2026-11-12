const http = require('node:http');

const app = require('./app');
const env = require('./config/env');
const { connectDatabase, disconnectDatabase } = require('./config/database');
const gameEngine = require('./modules/game/game.engine');
const { createSocketServer } = require('./modules/game/game.socket');

async function start() {
  try {
    await connectDatabase();
  } catch (error) {
    console.error('Could not connect to MongoDB.');
    console.error(`Error: ${error.message}`);
    console.error('Make sure MongoDB is running and MONGODB_URI in .env is correct.');
    process.exit(1);
  }

  const server = http.createServer(app);
  const io = createSocketServer(server);

  try {
    const recovery = await gameEngine.recoverSessions();

    if (recovery.live > 0 || recovery.paused > 0) {
      console.log(
        `Recovered ${recovery.live} live session(s) and ${recovery.paused} paused session(s).`
      );
    }
  } catch (error) {
    console.error(`Could not recover live sessions: ${error.message}`);
  }

  server.listen(env.PORT, () => {
    console.log(`Yalla Class API is running on http://localhost:${env.PORT}`);
    console.log(`Socket.IO is listening on the same server (path /socket.io).`);
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
      await new Promise((resolve) => io.close(resolve));
      await new Promise((resolve, reject) => {
        server.close((error) => {
          if (error && error.code !== 'ERR_SERVER_NOT_RUNNING') {
            reject(error);
            return;
          }

          resolve();
        });
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
