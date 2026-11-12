const { sendSuccess } = require('../../utils/api-response');
const joinService = require('./join.service');

async function getSession(req, res) {
  const session = await joinService.getPublicSession(req.validatedParams.code);

  return sendSuccess(res, {
    message: 'Session retrieved successfully',
    data: { session },
  });
}

async function joinSession(req, res) {
  const result = await joinService.joinSession(req.validatedParams.code, req.body);

  return sendSuccess(res, {
    statusCode: 201,
    message: 'Joined session successfully',
    data: result,
  });
}

async function reconnect(req, res) {
  const result = await joinService.reconnectParticipant(
    req.validatedParams.code,
    req.body.participantToken
  );

  return sendSuccess(res, {
    message: 'Participant reconnected successfully',
    data: result,
  });
}

module.exports = {
  getSession,
  joinSession,
  reconnect,
};
