const crypto = require('node:crypto');

const env = require('../config/env');

const JOIN_CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const JOIN_CODE_LENGTH = 6;

function generateJoinCode() {
  let code = '';

  for (let index = 0; index < JOIN_CODE_LENGTH; index += 1) {
    code += JOIN_CODE_ALPHABET[crypto.randomInt(0, JOIN_CODE_ALPHABET.length)];
  }

  return code;
}

function buildJoinUrl(joinCode) {
  const baseUrl = env.JOIN_BASE_URL.replace(/\/+$/, '');

  return `${baseUrl}/${joinCode}`;
}

function generateParticipantToken() {
  return crypto.randomBytes(32).toString('hex');
}

function hashParticipantToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

module.exports = {
  JOIN_CODE_LENGTH,
  generateJoinCode,
  buildJoinUrl,
  generateParticipantToken,
  hashParticipantToken,
};
