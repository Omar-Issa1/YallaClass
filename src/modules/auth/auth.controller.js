const { sendSuccess } = require('../../utils/api-response');
const { serializeUser } = require('../../utils/serializers');
const authService = require('./auth.service');

async function login(req, res) {
  const result = await authService.login(req.body);

  return sendSuccess(res, {
    message: 'Login successful',
    data: result,
  });
}

async function me(req, res) {
  return sendSuccess(res, {
    message: 'Current user',
    data: { user: serializeUser(req.user) },
  });
}

function logout(req, res) {
  return sendSuccess(res, {
    message: 'Logged out. Discard the JWT on the client.',
  });
}

module.exports = { login, me, logout };
