const mongoose = require('mongoose');
const { Server } = require('socket.io');

const env = require('../../config/env');
const Organization = require('../../models/organization.model');
const Session = require('../../models/session.model');
const SessionPlayer = require('../../models/session-player.model');
const User = require('../../models/user.model');
const { verifyAccessToken } = require('../../utils/token');
const { hashParticipantToken } = require('../../utils/session-code');
const sessionService = require('../session/session.service');
const {
  commandSettingsSchema,
  phaseSettingsSchema,
} = require('../session/session.validation');
const gameEngine = require('./game.engine');
const gameCommands = require('./game.commands');
const { GAME_ERRORS } = require('./game.constants');
const { gameError, normalizeSocketError } = require('./game.errors');
const {
  playerRoom,
  playersRoom,
  sessionRoom,
  teacherRoom,
} = require('./game.rooms');

const TEACHER_READ_ROLES = ['OWNER', 'TEACHER', 'ASSISTANT'];
const TEACHER_WRITE_ROLES = ['OWNER', 'TEACHER'];
const participantSockets = new Map();

let ioServer = null;

function addParticipantSocket(participantId, socketId) {
  const key = participantId.toString();
  const sockets = participantSockets.get(key) || new Set();

  sockets.add(socketId);
  participantSockets.set(key, sockets);

  return sockets.size;
}

function removeParticipantSocket(participantId, socketId) {
  const key = participantId.toString();
  const sockets = participantSockets.get(key);

  if (!sockets) {
    return 0;
  }

  sockets.delete(socketId);

  if (sockets.size === 0) {
    participantSockets.delete(key);
  }

  return sockets.size;
}

function bearerToken(value) {
  if (!value || typeof value !== 'string') {
    return '';
  }

  return value.startsWith('Bearer ') ? value.slice('Bearer '.length).trim() : value.trim();
}

async function authenticateTeacher(socket, auth) {
  const token = bearerToken(
    auth.token || socket.handshake.headers.authorization || ''
  );

  if (!token) {
    throw gameError(GAME_ERRORS.UNAUTHORIZED, 'Authentication required', 401);
  }

  let payload;

  try {
    payload = verifyAccessToken(token);
  } catch (error) {
    throw gameError(GAME_ERRORS.UNAUTHORIZED, 'Invalid or expired token', 401);
  }

  if (!payload.sub || !mongoose.isValidObjectId(payload.sub)) {
    throw gameError(GAME_ERRORS.UNAUTHORIZED, 'Invalid token', 401);
  }

  if (!auth.sessionId || !mongoose.isValidObjectId(auth.sessionId)) {
    throw gameError(GAME_ERRORS.INVALID_PAYLOAD, 'A valid sessionId is required', 400);
  }

  const [user, session] = await Promise.all([
    User.findById(payload.sub),
    Session.findById(auth.sessionId),
  ]);

  if (!user) {
    throw gameError(GAME_ERRORS.UNAUTHORIZED, 'User no longer exists', 401);
  }

  if (user.status === 'SUSPENDED') {
    throw gameError(GAME_ERRORS.FORBIDDEN, 'Your account has been suspended', 403);
  }

  if (!TEACHER_READ_ROLES.includes(user.role) || !user.organization) {
    throw gameError(
      GAME_ERRORS.FORBIDDEN,
      'You do not have permission to view this session',
      403
    );
  }

  if (!session) {
    throw gameError(GAME_ERRORS.SESSION_NOT_FOUND, 'Session not found', 404);
  }

  const organization = await Organization.findById(user.organization).select('status');

  if (!organization) {
    throw gameError(GAME_ERRORS.FORBIDDEN, 'Your organization is no longer available', 403);
  }

  if (organization.status === 'SUSPENDED') {
    throw gameError(GAME_ERRORS.FORBIDDEN, 'Your organization has been suspended', 403);
  }

  if (session.organization.toString() !== user.organization.toString()) {
    throw gameError(GAME_ERRORS.SESSION_NOT_FOUND, 'Session not found', 404);
  }

  socket.data.role = 'teacher';
  socket.data.user = user;
  socket.data.sessionId = session._id.toString();
  socket.data.sessionOrganization = session.organization.toString();
}

async function authenticatePlayer(socket, auth) {
  if (!auth.joinCode || typeof auth.joinCode !== 'string') {
    throw gameError(GAME_ERRORS.INVALID_PAYLOAD, 'A game code is required', 400);
  }

  if (!auth.participantToken || typeof auth.participantToken !== 'string') {
    throw gameError(GAME_ERRORS.UNAUTHORIZED, 'A participant token is required', 401);
  }

  const session = await Session.findOne({
    joinCode: auth.joinCode.trim().toUpperCase(),
  });

  if (!session) {
    throw gameError(GAME_ERRORS.SESSION_NOT_FOUND, 'Session not found', 404);
  }

  const organization = await Organization.findById(session.organization).select('status');

  if (!organization) {
    throw gameError(GAME_ERRORS.SESSION_NOT_FOUND, 'Session not found', 404);
  }

  if (organization.status === 'SUSPENDED') {
    throw gameError(GAME_ERRORS.FORBIDDEN, 'This organization has been suspended', 403);
  }

  const participant = await SessionPlayer.findOne({
    session: session._id,
    tokenHash: hashParticipantToken(auth.participantToken.trim()),
  });

  if (!participant) {
    throw gameError(
      GAME_ERRORS.INVALID_PARTICIPANT_TOKEN,
      'Invalid participant token',
      401
    );
  }

  if (participant.status === 'KICKED') {
    throw gameError(
      GAME_ERRORS.PARTICIPANT_KICKED,
      'You were removed from this session',
      403
    );
  }

  socket.data.role = 'player';
  socket.data.participantId = participant._id.toString();
  socket.data.sessionId = session._id.toString();
}

async function authenticateSocket(socket) {
  const auth = socket.handshake.auth || {};

  if (auth.role === 'teacher') {
    return authenticateTeacher(socket, auth);
  }

  if (auth.role === 'player') {
    return authenticatePlayer(socket, auth);
  }

  if (auth.token) {
    return authenticateTeacher(socket, auth);
  }

  if (auth.participantToken) {
    return authenticatePlayer(socket, auth);
  }

  throw gameError(GAME_ERRORS.UNAUTHORIZED, 'Authentication required', 401);
}

async function loadSession(socket) {
  const session = await Session.findById(socket.data.sessionId);

  if (!session) {
    throw gameError(GAME_ERRORS.SESSION_NOT_FOUND, 'Session not found', 404);
  }

  return session;
}

async function buildStateForSocket(socket) {
  const session = await loadSession(socket);
  const participant =
    socket.data.role === 'player'
      ? await SessionPlayer.findById(socket.data.participantId)
      : null;

  if (socket.data.role === 'player' && !participant) {
    throw gameError(GAME_ERRORS.PARTICIPANT_NOT_FOUND, 'Participant not found', 404);
  }

  return gameEngine.getGameState(session, {
    participant,
    includeAnswerCounts: socket.data.role === 'teacher',
  });
}

async function sendState(socket) {
  const state = await buildStateForSocket(socket);
  socket.emit('game:state', state);
  return state;
}

function requireTeacherWrite(socket) {
  if (socket.data.role !== 'teacher') {
    throw gameError(GAME_ERRORS.FORBIDDEN, 'Teacher access required', 403);
  }

  if (!TEACHER_WRITE_ROLES.includes(socket.data.user.role)) {
    throw gameError(
      GAME_ERRORS.FORBIDDEN,
      'You do not have permission to control this session',
      403
    );
  }
}

function registerHandler(socket, event, handler) {
  socket.on(event, async (...args) => {
    let payload = {};
    let acknowledge = () => {};

    if (typeof args[0] === 'function') {
      acknowledge = args[0];
    } else {
      payload = args[0] || {};

      if (typeof args[1] === 'function') {
        acknowledge = args[1];
      }
    }

    try {
      const data = await handler(payload);
      acknowledge({ success: true, data: data === undefined ? null : data });
    } catch (error) {
      const normalized = normalizeSocketError(error);

      socket.emit('game:error', normalized);
      acknowledge({ success: false, error: normalized });
    }
  });
}

async function handlePlayerConnected(socket) {
  const participant = await SessionPlayer.findById(socket.data.participantId);

  if (!participant || participant.status === 'KICKED') {
    socket.disconnect(true);
    return;
  }

  const session = await Session.findById(socket.data.sessionId);

  if (!session) {
    socket.disconnect(true);
    return;
  }

  const wasOffline =
    !participantSockets.has(participant._id.toString()) ||
    participantSockets.get(participant._id.toString()).size === 0;
  addParticipantSocket(participant._id, socket.id);
  const now = new Date();

  participant.connected = true;
  participant.lastSeenAt = now;
  participant.lastConnectedAt = now;
  participant.lastConnectedQuestionIndex =
    session.currentQuestionIndex >= 0 ? session.currentQuestionIndex : null;
  participant.offlineSinceQuestionIndex = null;
  participant.connectionCount += 1;
  await participant.save();

  socket.join(sessionRoom(session._id));
  socket.join(playersRoom(session._id));
  socket.join(playerRoom(participant._id));

  await sendState(socket);

  if (wasOffline && participant.connectionCount > 1) {
    gameEngine.notifyPlayerReconnected(session, participant);
  }
}

async function handleTeacherConnected(socket) {
  const session = await loadSession(socket);

  socket.join(sessionRoom(session._id));
  socket.join(teacherRoom(session._id));

  await sendState(socket);
}

async function handleDisconnect(socket) {
  if (socket.data.role !== 'player') {
    return;
  }

  const remaining = removeParticipantSocket(
    socket.data.participantId,
    socket.id
  );

  if (remaining > 0) {
    return;
  }

  const participant = await SessionPlayer.findById(socket.data.participantId);

  if (!participant) {
    return;
  }

  const session = await Session.findById(participant.session);
  const now = new Date();

  participant.connected = false;
  participant.lastSeenAt = now;
  participant.lastDisconnectedAt = now;

  if (
    session &&
    session.currentQuestionIndex >= 0 &&
    (participant.offlineSinceQuestionIndex === null ||
      participant.offlineSinceQuestionIndex === undefined)
  ) {
    participant.offlineSinceQuestionIndex = session.currentQuestionIndex;
  }

  await participant.save();

  if (participant.status === 'KICKED') {
    return;
  }

  if (session && ioServer) {
    ioServer.to(sessionRoom(session._id)).emit('player:left', {
      sessionId: session._id.toString(),
      participantId: participant._id.toString(),
      nickname: participant.nickname,
      reason: 'disconnect',
      at: now,
    });
  }
}

async function handleConnection(socket) {
  registerHandler(socket, 'game:sync', () => sendState(socket));

  registerHandler(socket, 'answer:submit', async (payload) => {
    if (socket.data.role !== 'player') {
      throw gameError(GAME_ERRORS.FORBIDDEN, 'Player access required', 403);
    }

    return gameEngine.submitAnswer(socket.data.participantId, payload);
  });

  registerHandler(socket, 'game:start', async () => {
    requireTeacherWrite(socket);

    const session = await sessionService.startSession(
      socket.data.user,
      socket.data.sessionId
    );

    return { session };
  });

  registerHandler(socket, 'game:pause', async () => {
    requireTeacherWrite(socket);

    const session = await sessionService.pauseSession(
      socket.data.user,
      socket.data.sessionId
    );

    return { session };
  });

  registerHandler(socket, 'game:resume', async () => {
    requireTeacherWrite(socket);

    const session = await sessionService.resumeSession(
      socket.data.user,
      socket.data.sessionId
    );

    return { session };
  });

  registerHandler(socket, 'game:finish', async () => {
    requireTeacherWrite(socket);

    const session = await sessionService.finishSession(
      socket.data.user,
      socket.data.sessionId
    );

    return { session };
  });

  registerHandler(socket, 'game:join-lock', async (payload) => {
    requireTeacherWrite(socket);

    if (typeof payload.joinOpen !== 'boolean') {
      throw gameError(
        GAME_ERRORS.INVALID_PAYLOAD,
        'joinOpen must be a boolean',
        400
      );
    }

    const session = await sessionService.setJoinOpen(
      socket.data.user,
      socket.data.sessionId,
      { joinOpen: payload.joinOpen }
    );

    return { session };
  });

  registerHandler(socket, 'game:reveal', async () => {
    requireTeacherWrite(socket);

    const session = await sessionService.revealSession(
      socket.data.user,
      socket.data.sessionId
    );

    return { session };
  });

  registerHandler(socket, 'game:next', async () => {
    requireTeacherWrite(socket);

    const session = await sessionService.nextSession(
      socket.data.user,
      socket.data.sessionId
    );

    return { session };
  });

  registerHandler(socket, 'game:skip', async () => {
    requireTeacherWrite(socket);

    const session = await sessionService.skipSession(
      socket.data.user,
      socket.data.sessionId
    );

    return { session };
  });

  registerHandler(socket, 'game:command-settings', async (payload) => {
    requireTeacherWrite(socket);

    const parsed = commandSettingsSchema.safeParse(
      payload.commandSettings || payload
    );

    if (!parsed.success) {
      throw gameError(
        GAME_ERRORS.INVALID_PAYLOAD,
        parsed.error.issues[0]?.message || 'Invalid command settings',
        400
      );
    }

    const session = await sessionService.updateCommandSettings(
      socket.data.user,
      socket.data.sessionId,
      parsed.data
    );

    return { session };
  });

  registerHandler(socket, 'game:phase-settings', async (payload) => {
    requireTeacherWrite(socket);

    const parsed = phaseSettingsSchema.safeParse(
      payload.phaseSettings || payload
    );

    if (!parsed.success) {
      throw gameError(
        GAME_ERRORS.INVALID_PAYLOAD,
        parsed.error.issues[0]?.message || 'Invalid phase settings',
        400
      );
    }

    const session = await sessionService.updatePhaseSettings(
      socket.data.user,
      socket.data.sessionId,
      parsed.data
    );

    return { session };
  });

  registerHandler(socket, 'participant:kick', async (payload) => {
    requireTeacherWrite(socket);

    const participantId = payload.participantId || payload.id;

    if (!mongoose.isValidObjectId(participantId)) {
      throw gameError(
        GAME_ERRORS.INVALID_PAYLOAD,
        'A valid participantId is required',
        400
      );
    }

    const id = await sessionService.kickParticipant(
      socket.data.user,
      socket.data.sessionId,
      participantId
    );

    return { participantId: id };
  });

  registerHandler(socket, 'command:select-target', async (payload) => {
    if (socket.data.role !== 'player') {
      throw gameError(GAME_ERRORS.FORBIDDEN, 'Player access required', 403);
    }

    const targetParticipantId =
      payload.targetParticipantId || payload.targetId;

    if (!mongoose.isValidObjectId(targetParticipantId)) {
      throw gameError(
        GAME_ERRORS.INVALID_PAYLOAD,
        'A valid targetParticipantId is required',
        400
      );
    }

    const result = await gameCommands.selectTarget(
      socket.data.participantId,
      targetParticipantId
    );

    return { result };
  });

  socket.on('disconnect', () => {
    handleDisconnect(socket).catch((error) => {
      console.error(`[socket] disconnect cleanup failed: ${error.message}`);
    });
  });

  if (socket.data.role === 'teacher') {
    await handleTeacherConnected(socket);
  } else {
    await handlePlayerConnected(socket);
  }
}

function createSocketServer(httpServer) {
  const corsOrigin =
    env.CORS_ORIGIN === '*'
      ? '*'
      : env.CORS_ORIGIN.split(',').map((origin) => origin.trim());

  const io = new Server(httpServer, {
    cors: {
      origin: corsOrigin,
      methods: ['GET', 'POST'],
    },
  });

  ioServer = io;
  gameEngine.init(io);

  io.use(async (socket, next) => {
    try {
      await authenticateSocket(socket);
      next();
    } catch (error) {
      const normalized = normalizeSocketError(error);
      const socketError = new Error(normalized.message);

      socketError.data = normalized;
      next(socketError);
    }
  });

  io.on('connection', (socket) => {
    handleConnection(socket).catch((error) => {
      console.error(`[socket] connection setup failed: ${error.message}`);
      socket.disconnect(true);
    });
  });

  return io;
}

module.exports = {
  createSocketServer,
  sessionRoom,
  teacherRoom,
  playersRoom,
  playerRoom,
};
