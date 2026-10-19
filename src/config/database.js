const mongoose = require('mongoose');

const env = require('./env');

const STATE_NAMES = {
  0: 'disconnected',
  1: 'connected',
  2: 'connecting',
  3: 'disconnecting',
};

mongoose.connection.on('error', (error) => {
  console.error('MongoDB connection error:', error.message);
});

mongoose.connection.on('disconnected', () => {
  console.warn('MongoDB disconnected');
});

async function connectDatabase() {
  await mongoose.connect(env.MONGODB_URI, { serverSelectionTimeoutMS: 5000 });
  console.log(`MongoDB connected: ${mongoose.connection.host}/${mongoose.connection.name}`);
}

async function disconnectDatabase() {
  await mongoose.disconnect();
}

function getDatabaseStatus() {
  return STATE_NAMES[mongoose.connection.readyState] || 'unknown';
}

module.exports = {
  connectDatabase,
  disconnectDatabase,
  getDatabaseStatus,
};
