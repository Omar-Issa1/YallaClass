const mongoose = require('mongoose');

let cachedSupport = null;

/**
 * Transactions require a replica set or a sharded cluster. Standalone
 * MongoDB (the default local setup) does not support them, so callers use
 * a manual rollback path instead.
 */
async function transactionsSupported() {
  if (cachedSupport !== null) {
    return cachedSupport;
  }

  const db = mongoose.connection.db;

  if (!db) {
    cachedSupport = false;
    return cachedSupport;
  }

  try {
    let hello;

    try {
      hello = await db.admin().command({ hello: 1 });
    } catch (error) {
      hello = await db.admin().command({ isMaster: 1 });
    }

    cachedSupport = Boolean(hello.setName || hello.msg === 'isdbgrid');
  } catch (error) {
    cachedSupport = false;
  }

  return cachedSupport;
}

module.exports = { transactionsSupported };
