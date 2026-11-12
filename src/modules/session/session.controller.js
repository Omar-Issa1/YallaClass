const { sendSuccess } = require('../../utils/api-response');
const sessionService = require('./session.service');

async function listSessions(req, res) {
  const sessions = await sessionService.listSessions(req.organizationId, req.validatedQuery);

  return sendSuccess(res, {
    message: 'Sessions retrieved successfully',
    data: { sessions },
  });
}

async function createSession(req, res) {
  const session = await sessionService.createSession(req.user, req.body);

  return sendSuccess(res, {
    statusCode: 201,
    message: 'Session created successfully',
    data: { session },
  });
}

async function getSession(req, res) {
  const session = await sessionService.getSession(req.organizationId, req.params.id);

  return sendSuccess(res, {
    message: 'Session retrieved successfully',
    data: { session },
  });
}

async function getLobby(req, res) {
  const session = await sessionService.getLobby(req.organizationId, req.params.id);

  return sendSuccess(res, {
    message: 'Session lobby retrieved successfully',
    data: { session },
  });
}

async function setJoinOpen(req, res) {
  const session = await sessionService.setJoinOpen(req.user, req.params.id, req.body);

  return sendSuccess(res, {
    message: req.body.joinOpen ? 'Session joining opened' : 'Session joining closed',
    data: { session },
  });
}

async function startSession(req, res) {
  const session = await sessionService.startSession(req.user, req.params.id);

  return sendSuccess(res, {
    message: 'Session started successfully',
    data: { session },
  });
}

async function pauseSession(req, res) {
  const session = await sessionService.pauseSession(req.user, req.params.id);

  return sendSuccess(res, {
    message: 'Session paused successfully',
    data: { session },
  });
}

async function resumeSession(req, res) {
  const session = await sessionService.resumeSession(req.user, req.params.id);

  return sendSuccess(res, {
    message: 'Session resumed successfully',
    data: { session },
  });
}

async function finishSession(req, res) {
  const session = await sessionService.finishSession(req.user, req.params.id);

  return sendSuccess(res, {
    message: 'Session finished successfully',
    data: { session },
  });
}

async function kickParticipant(req, res) {
  const id = await sessionService.kickParticipant(
    req.user,
    req.params.id,
    req.params.participantId
  );

  return sendSuccess(res, {
    message: 'Participant removed successfully',
    data: { id },
  });
}

async function revealSession(req, res) {
  const session = await sessionService.revealSession(req.user, req.params.id);

  return sendSuccess(res, {
    message: 'Question revealed successfully',
    data: { session },
  });
}

async function nextSession(req, res) {
  const session = await sessionService.nextSession(req.user, req.params.id);

  return sendSuccess(res, {
    message: 'Game advanced successfully',
    data: { session },
  });
}

async function skipSession(req, res) {
  const session = await sessionService.skipSession(req.user, req.params.id);

  return sendSuccess(res, {
    message: 'Question skipped successfully',
    data: { session },
  });
}

async function updateCommandSettings(req, res) {
  const session = await sessionService.updateCommandSettings(
    req.user,
    req.params.id,
    req.body
  );

  return sendSuccess(res, {
    message: 'Command settings updated successfully',
    data: { session },
  });
}

async function updatePhaseSettings(req, res) {
  const session = await sessionService.updatePhaseSettings(
    req.user,
    req.params.id,
    req.body
  );

  return sendSuccess(res, {
    message: 'Phase settings updated successfully',
    data: { session },
  });
}

module.exports = {
  listSessions,
  createSession,
  getSession,
  getLobby,
  setJoinOpen,
  startSession,
  pauseSession,
  resumeSession,
  finishSession,
  kickParticipant,
  revealSession,
  nextSession,
  skipSession,
  updateCommandSettings,
  updatePhaseSettings,
};
