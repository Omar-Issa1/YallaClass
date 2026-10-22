const jwt = require('jsonwebtoken');

const env = require('../config/env');

function signAccessToken(user) {
  return jwt.sign({ sub: user._id.toString() }, env.JWT_SECRET, {
    expiresIn: env.JWT_EXPIRES_IN,
  });
}

function verifyAccessToken(token) {
  return jwt.verify(token, env.JWT_SECRET);
}

module.exports = { signAccessToken, verifyAccessToken };
