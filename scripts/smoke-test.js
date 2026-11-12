const assert = require('node:assert/strict');
const { execFile, spawn } = require('node:child_process');
const { once } = require('node:events');
const path = require('node:path');
const ExcelJS = require('exceljs');
const { io: createSocketClient } = require('socket.io-client');

const PORT = 4100;
const BASE_URL = `http://127.0.0.1:${PORT}/api`;
const SOCKET_URL = `http://127.0.0.1:${PORT}`;
const TEST_MONGODB_URI =
  process.env.SMOKE_MONGODB_URI || 'mongodb://127.0.0.1:27017/yalla_class_smoke';
const PROJECT_ROOT = path.resolve(__dirname, '..');

process.env.MONGODB_URI = TEST_MONGODB_URI;
process.env.PORT = String(PORT);
process.env.NODE_ENV = 'test';
process.env.GAME_COUNTDOWN_MS = process.env.GAME_COUNTDOWN_MS || '150';
process.env.GAME_REVEAL_MS = process.env.GAME_REVEAL_MS || '250';
process.env.GAME_EXPLANATION_MS = process.env.GAME_EXPLANATION_MS || '250';
process.env.GAME_POINTS_MS = process.env.GAME_POINTS_MS || '100';
process.env.GAME_LEADERBOARD_MS = process.env.GAME_LEADERBOARD_MS || '1000';
process.env.GAME_PHONE_LEADERBOARD_MS =
  process.env.GAME_PHONE_LEADERBOARD_MS || '100';
process.env.COMMAND_SELECTION_TIMEOUT_MS =
  process.env.COMMAND_SELECTION_TIMEOUT_MS || '3000';
process.env.COMMAND_THIEF_CHANCE = process.env.COMMAND_THIEF_CHANCE || '1';

const mongoose = require('mongoose');

const { connectDatabase, disconnectDatabase } = require('../src/config/database');
const Answer = require('../src/models/answer.model');
const Attendance = require('../src/models/attendance.model');
const Question = require('../src/models/question.model');
const Quiz = require('../src/models/quiz.model');
const Section = require('../src/models/section.model');
const Session = require('../src/models/session.model');
const SessionCommand = require('../src/models/session-command.model');
const SessionEvent = require('../src/models/session-event.model');
const SessionPlayer = require('../src/models/session-player.model');
const Organization = require('../src/models/organization.model');
const Student = require('../src/models/student.model');
const User = require('../src/models/user.model');
const adminService = require('../src/modules/admin/admin.service');
const attendanceService = require('../src/modules/attendance/attendance.service');
const { AVATAR_COLOR_IDS } = require('../src/constants/avatar');
const gameCommands = require('../src/modules/game/game.commands');
const gameEngine = require('../src/modules/game/game.engine');
const {
  CARD_RARITIES,
  COMMAND_SELECTION_TIMEOUT_MS,
  GIFT_CARDS,
  GIFT_DRAW_COUNT,
  THIEF_ACTIVATION_CHANCE,
} = require('../src/modules/game/game.constants');
const { hashPassword, verifyPassword } = require('../src/utils/password');
const {
  generateJoinCode,
  hashParticipantToken,
} = require('../src/utils/session-code');

let passed = 0;
let serverProcess;
let serverOutput = '';

function pass(message) {
  passed += 1;
  console.log(`  ok - ${message}`);
}

function check(condition, message) {
  assert.ok(condition, message);
  pass(message);
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function execFileAsync(file, args, options = {}) {
  return new Promise((resolve, reject) => {
    execFile(file, args, options, (error, stdout, stderr) => {
      if (error) {
        reject(
          new Error(
            `${error.message}${stderr ? `\n${stderr}` : ''}${
              stdout ? `\n${stdout}` : ''
            }`
          )
        );
        return;
      }

      resolve({ stdout, stderr });
    });
  });
}

async function request(method, endpoint, { token, body, rawBody } = {}) {
  const headers = {};

  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  if (body !== undefined || rawBody !== undefined) {
    headers['Content-Type'] = 'application/json';
  }

  const response = await fetch(`${BASE_URL}${endpoint}`, {
    method,
    headers,
    body: rawBody !== undefined ? rawBody : body !== undefined ? JSON.stringify(body) : undefined,
  });

  const text = await response.text();
  let parsed = null;

  try {
    parsed = text ? JSON.parse(text) : null;
  } catch (error) {
    parsed = { raw: text };
  }

  return { status: response.status, body: parsed };
}

async function requestBuffer(method, endpoint, { token } = {}) {
  const headers = {};

  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  const response = await fetch(`${BASE_URL}${endpoint}`, { method, headers });
  const arrayBuffer = await response.arrayBuffer();

  return {
    status: response.status,
    headers: response.headers,
    buffer: Buffer.from(arrayBuffer),
  };
}

function expectStatus(response, expectedStatus, label) {
  assert.equal(
    response.status,
    expectedStatus,
    `${label}: expected ${expectedStatus}, got ${response.status} -> ${JSON.stringify(
      response.body
    )}`
  );
  pass(`${label} -> ${expectedStatus}`);
  return response.body;
}

function hasKeyDeep(value, key) {
  if (!value || typeof value !== 'object') {
    return false;
  }

  if (Array.isArray(value)) {
    return value.some((item) => hasKeyDeep(item, key));
  }

  return (
    Object.prototype.hasOwnProperty.call(value, key) ||
    Object.values(value).some((item) => hasKeyDeep(item, key))
  );
}

function expectNoPasswordHash(response, label) {
  check(!hasKeyDeep(response.body, 'passwordHash'), `${label} does not expose passwordHash`);
}

async function waitForServer() {
  const deadline = Date.now() + 20000;

  while (Date.now() < deadline) {
    if (serverProcess.exitCode !== null) {
      throw new Error(`Server exited early with code ${serverProcess.exitCode}:\n${serverOutput}`);
    }

    try {
      const response = await fetch(`${BASE_URL}/health`);

      if (response.ok) {
        return;
      }
    } catch (error) {
      // Server is not accepting connections yet.
    }

    await delay(300);
  }

  throw new Error(`Server did not become ready:\n${serverOutput}`);
}

async function startServer() {
  serverProcess = spawn(process.execPath, ['src/server.js'], {
    cwd: PROJECT_ROOT,
    env: {
      ...process.env,
      MONGODB_URI: TEST_MONGODB_URI,
      PORT: String(PORT),
      NODE_ENV: 'test',
      GAME_COUNTDOWN_MS: '150',
      GAME_REVEAL_MS: '250',
      GAME_EXPLANATION_MS: '250',
      GAME_POINTS_MS: '100',
      GAME_LEADERBOARD_MS: '1000',
      GAME_PHONE_LEADERBOARD_MS: '100',
      COMMAND_SELECTION_TIMEOUT_MS: '3000',
      COMMAND_THIEF_CHANCE: '1',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  serverProcess.stdout.on('data', (chunk) => {
    serverOutput += chunk.toString();
  });

  serverProcess.stderr.on('data', (chunk) => {
    serverOutput += chunk.toString();
  });

  await waitForServer();
}

function forceKillProcessTree(pid) {
  return new Promise((resolve) => {
    if (process.platform === 'win32') {
      execFile('taskkill', ['/PID', String(pid), '/T', '/F'], () => resolve());
      return;
    }

    try {
      process.kill(-pid, 'SIGKILL');
    } catch (error) {
      // Process already exited.
    }

    resolve();
  });
}

async function stopServer() {
  if (!serverProcess || serverProcess.exitCode !== null) {
    return;
  }

  const pid = serverProcess.pid;

  serverProcess.kill('SIGTERM');
  await Promise.race([once(serverProcess, 'exit'), delay(2000)]);

  if (serverProcess.exitCode === null) {
    await forceKillProcessTree(pid);
  }

  serverProcess.stdout.destroy();
  serverProcess.stderr.destroy();
  serverProcess.unref();
}

function expectValidationError(response, label) {
  const body = expectStatus(response, 400, label);
  check(body.success === false, `${label} has success=false`);
  check(Array.isArray(body.errors) && body.errors.length > 0, `${label} returns validation details`);
}

function connectGameSocket(auth, { expectState = true, timeout = 6000 } = {}) {
  const socket = createSocketClient(SOCKET_URL, {
    auth,
    transports: ['websocket'],
    forceNew: true,
    reconnection: false,
  });

  return new Promise((resolve, reject) => {
    let settled = false;
    let state = null;
    const timer = setTimeout(() => {
      if (settled) {
        return;
      }

      settled = true;
      socket.close();
      reject(new Error(`Socket connection timed out for ${auth.role}`));
    }, timeout);

    function finish() {
      if (settled) {
        return;
      }

      settled = true;
      clearTimeout(timer);
      resolve({ socket, state });
    }

    socket.on('game:state', (payload) => {
      state = payload;

      if (expectState) {
        finish();
      }
    });

    socket.once('connect', () => {
      if (!expectState) {
        finish();
      }
    });

    socket.once('connect_error', (error) => {
      if (settled) {
        return;
      }

      settled = true;
      clearTimeout(timer);
      socket.close();
      reject(error);
    });
  });
}

function waitForSocketEvent(socket, event, predicate = () => true, timeout = 6000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.off(event, handler);
      reject(new Error(`Timed out waiting for socket event ${event}`));
    }, timeout);

    function handler(payload) {
      let matches = false;

      try {
        matches = predicate(payload);
      } catch (error) {
        clearTimeout(timer);
        socket.off(event, handler);
        reject(error);
        return;
      }

      if (!matches) {
        return;
      }

      clearTimeout(timer);
      socket.off(event, handler);
      resolve(payload);
    }

    socket.on(event, handler);
  });
}

function emitWithAck(socket, event, payload = {}, timeout = 6000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`Timed out waiting for acknowledgement of ${event}`));
    }, timeout);

    socket.emit(event, payload, (response) => {
      clearTimeout(timer);
      resolve(response);
    });
  });
}

function expectSocketConnectError(auth, expectedCode, label) {
  const socket = createSocketClient(SOCKET_URL, {
    auth,
    transports: ['websocket'],
    forceNew: true,
    reconnection: false,
  });

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.close();
      reject(new Error(`${label}: connection was not rejected`));
    }, 6000);

    socket.once('connect', () => {
      clearTimeout(timer);
      socket.close();
      reject(new Error(`${label}: socket unexpectedly connected`));
    });

    socket.once('connect_error', (error) => {
      clearTimeout(timer);
      socket.close();
      check(
        error.data?.code === expectedCode,
        `${label} -> ${expectedCode} (got ${error.data?.code || error.message})`
      );
      resolve();
    });
  });
}

function closeSocket(socket) {
  if (!socket) {
    return;
  }

  if (socket.connected) {
    socket.disconnect();
  } else {
    socket.close();
  }
}

async function runPhase5Tests({
  suffix,
  tokenTeacher,
  tokenAssistant,
  tokenB,
  orgAId,
  teacherId,
}) {
  console.log('\nPhase 5 real-time game engine smoke tests\n');

  check(
    gameEngine.calculatePoints(1000, 0, 10000) === 1000,
    'scoring awards full points at zero response time'
  );
  check(
    gameEngine.calculatePoints(1000, 10000, 10000) === 500,
    'scoring awards half points at the deadline'
  );
  check(
    gameEngine.calculatePoints(1000, 5000, 10000) === 750,
    'scoring decreases linearly with response time'
  );

  const quizResponse = await request('POST', '/quizzes', {
    token: tokenTeacher,
    body: {
      title: `Realtime Quiz ${suffix}`,
      description: 'Phase 5 game engine smoke quiz',
    },
  });
  const quizBody = expectStatus(quizResponse, 201, 'POST /quizzes for realtime game');
  const quizId = quizBody.data.quiz.id;

  const q1Response = await request('POST', `/quizzes/${quizId}/questions`, {
    token: tokenTeacher,
    body: {
      text: 'Realtime question one',
      points: 1000,
      timeLimitSec: 5,
      options: [
        { text: 'Correct one', isCorrect: true },
        { text: 'Wrong one A', isCorrect: false },
        { text: 'Wrong one B', isCorrect: false },
      ],
    },
  });
  const q1Body = expectStatus(q1Response, 201, 'POST realtime question one');
  const q1Id = q1Body.data.question.id;
  const q1CorrectId = q1Body.data.question.options.find((option) => option.isCorrect).id;

  const q2Response = await request('POST', `/quizzes/${quizId}/questions`, {
    token: tokenTeacher,
    body: {
      text: 'Realtime question two',
      points: 2000,
      timeLimitSec: 5,
      options: [
        { text: 'Wrong two A', isCorrect: false },
        { text: 'Correct two', isCorrect: true },
        { text: 'Wrong two B', isCorrect: false },
      ],
    },
  });
  const q2Body = expectStatus(q2Response, 201, 'POST realtime question two');
  const q2Id = q2Body.data.question.id;
  const q2CorrectId = q2Body.data.question.options.find((option) => option.isCorrect).id;
  const q2WrongId = q2Body.data.question.options.find((option) => !option.isCorrect).id;

  const createSessionResponse = await request('POST', '/sessions', {
    token: tokenTeacher,
    body: { quiz: quizId },
  });
  const createSessionBody = expectStatus(
    createSessionResponse,
    201,
    'POST /sessions for realtime game'
  );
  const sessionId = createSessionBody.data.session.id;
  const joinCode = createSessionBody.data.session.joinCode;
  check(createSessionBody.data.session.gameState === 'IDLE', 'new session game state is IDLE');
  check(createSessionBody.data.session.totalQuestions === 0, 'lobby session has no game snapshot');

  const teacher = await connectGameSocket({
    role: 'teacher',
    token: tokenTeacher,
    sessionId,
  });
  const teacherSocket = teacher.socket;
  check(teacher.state.sessionId === sessionId, 'teacher socket joins the session room');
  check(teacher.state.status === 'LOBBY', 'teacher socket receives lobby game state');
  check(teacher.state.question === null, 'lobby game state has no current question');

  const assistant = await connectGameSocket({
    role: 'teacher',
    token: tokenAssistant,
    sessionId,
  });
  const assistantPause = await emitWithAck(assistant.socket, 'game:pause');
  check(assistantPause.success === false, 'assistant cannot control the game');
  check(assistantPause.error.code === 'FORBIDDEN', 'assistant control is rejected with FORBIDDEN');

  await expectSocketConnectError(
    { role: 'teacher', token: tokenB, sessionId },
    'SESSION_NOT_FOUND',
    'cross-organization teacher socket is rejected'
  );

  await expectSocketConnectError(
    { role: 'player', joinCode, participantToken: 'a'.repeat(64) },
    'INVALID_PARTICIPANT_TOKEN',
    'player socket rejects an invalid participant token'
  );

  const p1Nickname = `RT P1 ${suffix}`.slice(0, 50);
  const p2Nickname = `RT P2 ${suffix}`.slice(0, 50);
  const p1JoinedPromise = waitForSocketEvent(
    teacherSocket,
    'player:joined',
    (payload) => payload.participant.nickname === p1Nickname
  );
  const p2JoinedPromise = waitForSocketEvent(
    teacherSocket,
    'player:joined',
    (payload) => payload.participant.nickname === p2Nickname
  );

  const p1Join = await request('POST', `/join/${joinCode}`, {
    body: { nickname: p1Nickname },
  });
  const p1JoinBody = expectStatus(p1Join, 201, 'POST /join realtime player one');
  const p1Id = p1JoinBody.data.participant.id;
  const p1Token = p1JoinBody.data.participant.participantToken;
  const p1Joined = await p1JoinedPromise;
  check(p1Joined.participant.id === p1Id, 'teacher receives player:joined for player one');

  const p2Join = await request('POST', `/join/${joinCode}`, {
    body: { nickname: p2Nickname },
  });
  const p2JoinBody = expectStatus(p2Join, 201, 'POST /join realtime player two');
  const p2Id = p2JoinBody.data.participant.id;
  const p2Token = p2JoinBody.data.participant.participantToken;
  const p2Joined = await p2JoinedPromise;
  check(p2Joined.participant.id === p2Id, 'teacher receives player:joined for player two');

  const p1 = await connectGameSocket({
    role: 'player',
    joinCode,
    participantToken: p1Token,
  });
  const p2 = await connectGameSocket({
    role: 'player',
    joinCode,
    participantToken: p2Token,
  });
  check(p1.state.you.participantId === p1Id, 'player socket receives its participant identity');
  check(p1.state.you.score === 0, 'player starts with zero score');
  check(p2.state.status === 'LOBBY', 'player socket receives lobby state');

  const playerPause = await emitWithAck(p1.socket, 'game:pause');
  check(playerPause.success === false, 'player cannot control the game');
  check(playerPause.error.code === 'FORBIDDEN', 'player control is rejected with FORBIDDEN');

  const gameStartedPromise = waitForSocketEvent(teacherSocket, 'game:started');
  const q1StartedPromise = waitForSocketEvent(
    teacherSocket,
    'question:started',
    (payload) => payload.index === 0
  );
  const q2StartedPromise = waitForSocketEvent(
    teacherSocket,
    'question:started',
    (payload) => payload.index === 1
  );
  const startAck = await emitWithAck(teacherSocket, 'game:start');
  check(startAck.success === true, 'teacher can start the game over Socket.IO');
  check(startAck.data.session.gameState === 'COUNTDOWN', 'game starts in COUNTDOWN');

  const gameStarted = await gameStartedPromise;
  check(gameStarted.totalQuestions === 2, 'game:started reports the question count');
  check(Boolean(gameStarted.phaseEndsAt), 'game:started includes the countdown deadline');

  const q1Started = await q1StartedPromise;
  check(q1Started.question.id === q1Id, 'question:started sends the first question');
  check(q1Started.question.points === 1000, 'question payload includes points');
  check(q1Started.question.options.length === 3, 'question payload includes options');
  check(
    q1Started.question.options.every((option) => !('isCorrect' in option)),
    'question payload hides correct answers'
  );
  check(
    new Date(q1Started.phaseEndsAt).getTime() > Date.now(),
    'question payload includes a future deadline'
  );

  const q1EndedPromise = waitForSocketEvent(
    teacherSocket,
    'question:ended',
    (payload) => payload.questionId === q1Id
  );
  const q1RevealedPromise = waitForSocketEvent(
    teacherSocket,
    'answer:revealed',
    (payload) => payload.questionId === q1Id
  );
  const q1LeaderboardPromise = waitForSocketEvent(
    teacherSocket,
    'leaderboard:updated',
    (payload) => payload.questionId === q1Id
  );
  const q1ExplanationPromise = waitForSocketEvent(
    teacherSocket,
    'explanation:shown',
    (payload) => payload.questionId === q1Id
  );
  const p1Q1ResultPromise = waitForSocketEvent(
    p1.socket,
    'answer:result',
    (payload) => payload.questionId === q1Id
  );
  const p2Q1ResultPromise = waitForSocketEvent(
    p2.socket,
    'answer:result',
    (payload) => payload.questionId === q1Id
  );
  const p1Q1PointsPromise = waitForSocketEvent(
    p1.socket,
    'points:updated',
    (payload) => payload.questionId === q1Id
  );

  const wrongQuestionAck = await emitWithAck(p1.socket, 'answer:submit', {
    questionId: q2Id,
    optionId: q1CorrectId,
  });
  check(wrongQuestionAck.success === false, 'answer for a non-current question is rejected');
  check(
    wrongQuestionAck.error.code === 'QUESTION_MISMATCH',
    'non-current question is rejected with QUESTION_MISMATCH'
  );

  const invalidOptionAck = await emitWithAck(p1.socket, 'answer:submit', {
    questionId: q1Id,
    optionId: '64b000000000000000000000',
  });
  check(invalidOptionAck.success === false, 'answer with an unknown option is rejected');
  check(
    invalidOptionAck.error.code === 'INVALID_OPTION',
    'unknown option is rejected with INVALID_OPTION'
  );

  const p1Q1Ack = await emitWithAck(p1.socket, 'answer:submit', {
    questionId: q1Id,
    optionId: q1CorrectId,
  });
  check(
    p1Q1Ack.success === true,
    `player one submits a correct answer (${JSON.stringify(p1Q1Ack)})`
  );
  check(p1Q1Ack.data.selectedOptionId === q1CorrectId, 'answer acknowledgement echoes the option');
  check(
    !('isCorrect' in p1Q1Ack.data) && !('pointsAwarded' in p1Q1Ack.data),
    'answer acknowledgement does not reveal correctness'
  );

  const duplicateAck = await emitWithAck(p1.socket, 'answer:submit', {
    questionId: q1Id,
    optionId: q1CorrectId,
  });
  check(duplicateAck.success === false, 'duplicate answer submission is rejected');
  check(
    duplicateAck.error.code === 'ALREADY_ANSWERED',
    'duplicate answer is rejected with ALREADY_ANSWERED'
  );

  await delay(400);

  const p2Q1Ack = await emitWithAck(p2.socket, 'answer:submit', {
    questionId: q1Id,
    optionId: q1CorrectId,
    score: 999999,
    isCorrect: true,
    pointsAwarded: 999999,
  });
  check(p2Q1Ack.success === true, 'player two submits a correct answer with spoofed score fields');

  const q1Ended = await q1EndedPromise;
  check(q1Ended.answeredCount === 2, 'question:ended reports both answers');
  check(q1Ended.totalPlayers === 2, 'question:ended reports the active player count');

  const q1Revealed = await q1RevealedPromise;
  check(q1Revealed.correctOptionId === q1CorrectId, 'answer:revealed includes the correct option');
  check(q1Revealed.answeredCount === 2, 'answer:revealed reports the answer count');
  const correctCount = q1Revealed.answerCounts.find(
    (item) => item.optionId === q1CorrectId
  );
  check(correctCount?.count === 2, 'answer:revealed includes per-option answer counts');

  const p1Q1Result = await p1Q1ResultPromise;
  const p2Q1Result = await p2Q1ResultPromise;
  check(p1Q1Result.isCorrect === true, 'player one result is correct');
  check(p2Q1Result.isCorrect === true, 'player two result is correct');
  check(p1Q1Result.pointsAwarded > 0, 'correct answer awards points');
  check(
    p1Q1Result.pointsAwarded > p2Q1Result.pointsAwarded,
    'faster correct answer earns more points'
  );
  check(p1Q1Result.score === p1Q1Result.pointsAwarded, 'first correct answer sets the score');
  check(p2Q1Result.score === p2Q1Result.pointsAwarded, 'player two score is server-calculated');
  check(p2Q1Result.pointsAwarded < 999999, 'client-supplied points are ignored');
  check(p1Q1Result.streak === 1, 'first correct answer starts a streak');
  check(p2Q1Result.streak === 1, 'player two streak starts at one');

  const p1Q1Points = await p1Q1PointsPromise;
  check(p1Q1Points.score === p1Q1Result.score, 'points:updated matches the reveal result');

  const q1Leaderboard = await q1LeaderboardPromise;
  check(q1Leaderboard.leaderboard.length === 2, 'leaderboard includes both active players');
  check(
    q1Leaderboard.leaderboard[0].participantId === p1Id &&
      q1Leaderboard.leaderboard[0].rank === 1,
    'leaderboard ranks the faster correct player first'
  );
  check(
    q1Leaderboard.leaderboard[1].participantId === p2Id &&
      q1Leaderboard.leaderboard[1].rank === 2,
    'leaderboard ranks the slower player second'
  );

  const q1Explanation = await q1ExplanationPromise;
  check(q1Explanation.explanation === null, 'explanation event carries null for legacy questions');

  const q2Started = await q2StartedPromise;
  check(q2Started.question.id === q2Id, 'game automatically advances to question two');

  const q2PausedPromise = waitForSocketEvent(teacherSocket, 'game:paused');
  const pauseAck = await emitWithAck(teacherSocket, 'game:pause');
  check(pauseAck.success === true, 'teacher can pause the game over Socket.IO');
  check(pauseAck.data.session.status === 'PAUSED', 'pause response is PAUSED');
  const q2Paused = await q2PausedPromise;
  check(q2Paused.gameState === 'QUESTION', 'pause preserves the current question phase');
  check(q2Paused.remainingTimeMs > 0, 'pause stores the remaining question time');

  const p2LeftPromise = waitForSocketEvent(
    teacherSocket,
    'player:left',
    (payload) => payload.participantId === p2Id
  );
  p2.socket.disconnect();
  const p2Left = await p2LeftPromise;
  check(p2Left.reason === 'disconnect', 'teacher receives player:left on disconnect');

  const p2ReconnectedPromise = waitForSocketEvent(
    teacherSocket,
    'player:reconnected',
    (payload) => payload.participant.id === p2Id
  );
  const p2Reconnect = await connectGameSocket({
    role: 'player',
    joinCode,
    participantToken: p2Token,
  });
  const p2Reconnected = await p2ReconnectedPromise;
  check(p2Reconnect.state.status === 'PAUSED', 'reconnecting player receives paused state');
  check(p2Reconnect.state.gameState === 'QUESTION', 'reconnecting player returns to the question');
  check(p2Reconnect.state.yourAnswer === null, 'reconnecting player has no answer for question two');
  check(p2Reconnected.participant.id === p2Id, 'teacher receives player:reconnected');

  const q2ResumedPromise = waitForSocketEvent(teacherSocket, 'game:resumed');
  const resumeAck = await emitWithAck(teacherSocket, 'game:resume');
  check(resumeAck.success === true, 'teacher can resume the game over Socket.IO');
  check(resumeAck.data.session.status === 'LIVE', 'resume response is LIVE');
  const q2Resumed = await q2ResumedPromise;
  check(q2Resumed.gameState === 'QUESTION', 'resume preserves the current question phase');
  check(
    new Date(q2Resumed.phaseEndsAt).getTime() > Date.now(),
    'resume restores a future question deadline'
  );

  const reopenJoin = await request('PATCH', `/sessions/${sessionId}/join-lock`, {
    token: tokenTeacher,
    body: { joinOpen: true },
  });
  expectStatus(reopenJoin, 200, 'reopen live joining for a late player');

  const p3Nickname = `RT P3 ${suffix}`.slice(0, 50);
  const p3JoinedPromise = waitForSocketEvent(
    teacherSocket,
    'player:joined',
    (payload) => payload.participant.nickname === p3Nickname
  );
  const p3Join = await request('POST', `/join/${joinCode}`, {
    body: { nickname: p3Nickname },
  });
  const p3JoinBody = expectStatus(p3Join, 201, 'late player joins the live session');
  const p3Id = p3JoinBody.data.participant.id;
  const p3Token = p3JoinBody.data.participant.participantToken;
  await p3JoinedPromise;

  const p3 = await connectGameSocket({
    role: 'player',
    joinCode,
    participantToken: p3Token,
  });
  check(p3.state.gameState === 'QUESTION', 'late player receives the live question state');
  check(p3.state.question.id === q2Id, 'late player receives the current question');
  check(
    p3.state.question.options.every((option) => !('isCorrect' in option)),
    'late player state hides correct answers'
  );

  const q2EndedPromise = waitForSocketEvent(
    teacherSocket,
    'question:ended',
    (payload) => payload.questionId === q2Id
  );
  const q2RevealedPromise = waitForSocketEvent(
    teacherSocket,
    'answer:revealed',
    (payload) => payload.questionId === q2Id
  );
  const q2LeaderboardPromise = waitForSocketEvent(
    teacherSocket,
    'leaderboard:updated',
    (payload) => payload.questionId === q2Id
  );
  const q2ExplanationPromise = waitForSocketEvent(
    teacherSocket,
    'explanation:shown',
    (payload) => payload.questionId === q2Id
  );
  const p1Q2ResultPromise = waitForSocketEvent(
    p1.socket,
    'answer:result',
    (payload) => payload.questionId === q2Id
  );
  const p2Q2ResultPromise = waitForSocketEvent(
    p2Reconnect.socket,
    'answer:result',
    (payload) => payload.questionId === q2Id
  );
  const p3Q2ResultPromise = waitForSocketEvent(
    p3.socket,
    'answer:result',
    (payload) => payload.questionId === q2Id
  );
  const finishedPromise = waitForSocketEvent(teacherSocket, 'game:finished');

  const p1Q2Ack = await emitWithAck(p1.socket, 'answer:submit', {
    questionId: q2Id,
    optionId: q2CorrectId,
  });
  check(p1Q2Ack.success === true, 'player one submits a correct second answer');

  const p2Q2Ack = await emitWithAck(p2Reconnect.socket, 'answer:submit', {
    questionId: q2Id,
    optionId: q2WrongId,
    participantId: p1Id,
    score: 999999,
    isCorrect: true,
    pointsAwarded: 999999,
  });
  check(p2Q2Ack.success === true, 'player two submits an incorrect answer with spoofed fields');

  await Session.updateOne(
    { _id: sessionId },
    { $set: { phaseEndsAt: new Date(Date.now() - 1000) } }
  );

  const deadlineAck = await emitWithAck(p3.socket, 'answer:submit', {
    questionId: q2Id,
    optionId: q2CorrectId,
  });
  check(deadlineAck.success === false, 'answer after the question deadline is rejected');
  check(
    deadlineAck.error.code === 'DEADLINE_PASSED',
    'late answer is rejected with DEADLINE_PASSED'
  );

  const forcePausePromise = waitForSocketEvent(teacherSocket, 'game:paused');
  const forcePauseAck = await emitWithAck(teacherSocket, 'game:pause');
  check(forcePauseAck.success === true, 'teacher can pause an expired question');
  await forcePausePromise;

  const forceResumePromise = waitForSocketEvent(teacherSocket, 'game:resumed');
  const forceResumeAck = await emitWithAck(teacherSocket, 'game:resume');
  check(forceResumeAck.success === true, 'teacher can resume an expired question');
  await forceResumePromise;

  const q2Ended = await q2EndedPromise;
  check(q2Ended.answeredCount === 2, 'expired question reveals the persisted answers');
  check(q2Ended.totalPlayers === 3, 'late player is included in the active player count');

  const q2Revealed = await q2RevealedPromise;
  check(q2Revealed.correctOptionId === q2CorrectId, 'second reveal includes the correct option');

  const p1Q2Result = await p1Q2ResultPromise;
  const p2Q2Result = await p2Q2ResultPromise;
  const p3Q2Result = await p3Q2ResultPromise;
  check(p1Q2Result.isCorrect === true, 'player one second answer is correct');
  check(p1Q2Result.streak === 2, 'consecutive correct answers build a streak');
  check(p1Q2Result.bestStreak === 2, 'best streak is persisted');
  check(p2Q2Result.isCorrect === false, 'player two second answer is incorrect');
  check(p2Q2Result.pointsAwarded === 0, 'incorrect answer awards zero points');
  check(p2Q2Result.streak === 0, 'incorrect answer resets the streak');
  check(p2Q2Result.bestStreak === 1, 'best streak survives an incorrect answer');
  check(p2Q2Result.score === p2Q1Result.score, 'incorrect answer does not change the score');
  check(p3Q2Result.selectedOptionId === null, 'late player result has no selected option');
  check(p3Q2Result.isCorrect === false, 'late player result is incorrect by default');
  check(p3Q2Result.pointsAwarded === 0, 'late player receives zero points');

  const q2Leaderboard = await q2LeaderboardPromise;
  check(q2Leaderboard.leaderboard.length === 3, 'leaderboard includes the late player');
  check(
    q2Leaderboard.leaderboard[0].participantId === p1Id,
    'leaderboard keeps player one in first place'
  );
  check(
    q2Leaderboard.leaderboard.find((entry) => entry.participantId === p3Id)?.rank === 3,
    'late player is ranked last with zero points'
  );

  const q2Explanation = await q2ExplanationPromise;
  check(q2Explanation.explanation === null, 'second explanation event also carries null');

  const p2KickedPromise = waitForSocketEvent(
    p2Reconnect.socket,
    'session:kicked'
  );
  const teacherKickPromise = waitForSocketEvent(
    teacherSocket,
    'player:kicked',
    (payload) => payload.participantId === p2Id
  );
  const kickResponse = await request(
    'DELETE',
    `/sessions/${sessionId}/participants/${p2Id}`,
    { token: tokenTeacher }
  );
  expectStatus(kickResponse, 200, 'kick a player during the live game');
  const p2Kicked = await p2KickedPromise;
  check(p2Kicked.reason === 'kicked', 'kicked player receives session:kicked');
  const teacherKick = await teacherKickPromise;
  check(teacherKick.participantId === p2Id, 'teacher receives player:kicked');
  await delay(100);
  check(p2Reconnect.socket.connected === false, 'kicked player socket is disconnected');

  const finished = await finishedPromise;
  check(finished.leaderboard.length === 2, 'final leaderboard excludes kicked players');
  check(
    finished.leaderboard.some((entry) => entry.participantId === p2Id) === false,
    'kicked player is absent from the final leaderboard'
  );
  check(
    finished.leaderboard[0].participantId === p1Id &&
      finished.leaderboard[0].rank === 1,
    'final leaderboard keeps player one first'
  );
  check(
    finished.leaderboard[1].participantId === p3Id &&
      finished.leaderboard[1].rank === 2,
    'final leaderboard ranks the remaining player second'
  );

  const finishedSession = await request('GET', `/sessions/${sessionId}`, {
    token: tokenTeacher,
  });
  const finishedSessionBody = expectStatus(
    finishedSession,
    200,
    'GET realtime session after finish'
  );
  check(finishedSessionBody.data.session.status === 'FINISHED', 'session finishes automatically');
  check(finishedSessionBody.data.session.gameState === 'FINISHED', 'game state becomes FINISHED');
  check(Boolean(finishedSessionBody.data.session.endedAt), 'finished game records endedAt');

  const finalLobby = await request('GET', `/sessions/${sessionId}/lobby`, {
    token: tokenTeacher,
  });
  const finalLobbyBody = expectStatus(finalLobby, 200, 'GET realtime final lobby');
  check(
    finalLobbyBody.data.session.participants.length === 2,
    'final lobby excludes the kicked player'
  );
  const p1LobbyEntry = finalLobbyBody.data.session.participants.find(
    (participant) => participant.id === p1Id
  );
  const p3LobbyEntry = finalLobbyBody.data.session.participants.find(
    (participant) => participant.id === p3Id
  );
  check(p1LobbyEntry?.finalRank === 1, 'winner final rank is persisted');
  check(p3LobbyEntry?.finalRank === 2, 'runner-up final rank is persisted');

  const p1Doc = await SessionPlayer.findById(p1Id);
  const p2Doc = await SessionPlayer.findById(p2Id);
  const p1Answers = await Answer.find({ sessionPlayer: p1Id });
  const p2Answers = await Answer.find({ sessionPlayer: p2Id });
  const p1Awarded = p1Answers.reduce((sum, answer) => sum + answer.pointsAwarded, 0);

  check(p1Answers.length === 2, 'duplicate submissions are not persisted');
  check(p2Answers.length === 2, 'each player has one persisted answer per question');
  check(
    p1Answers.every((answer) => answer.applied === true),
    'persisted answers are marked as applied'
  );
  check(p1Doc.score === p1Awarded, 'player score equals the sum of awarded answer points');
  check(p1Doc.streak === 2 && p1Doc.bestStreak === 2, 'streak statistics are persisted');
  check(
    p2Doc.streak === 0 && p2Doc.bestStreak === 1,
    'incorrect answer persists a reset streak and best streak'
  );
  check(p1Doc.totalResponseTimeMs > 0, 'response time is persisted on the player');
  check(
    (await Answer.countDocuments({ session: sessionId })) === 4,
    'only four authoritative answers exist for the game'
  );

  closeSocket(teacherSocket);
  closeSocket(assistant.socket);
  closeSocket(p1.socket);
  closeSocket(p3.socket);

  const tieSession = await Session.create({
    quiz: quizId,
    organization: orgAId,
    createdBy: teacherId,
    joinCode: generateJoinCode(),
    status: 'LOBBY',
    joinOpen: true,
  });
  const tiePlayerOne = await SessionPlayer.create({
    session: tieSession._id,
    organization: orgAId,
    name: 'Tie Player One',
    nickname: 'Tie Player One',
    nicknameKey: 'tie player one',
    tokenHash: hashParticipantToken(`tie-one-${suffix}`),
    status: 'ACTIVE',
    score: 500,
    totalResponseTimeMs: 2000,
    joinedAt: new Date(Date.now() - 2000),
  });
  const tiePlayerTwo = await SessionPlayer.create({
    session: tieSession._id,
    organization: orgAId,
    name: 'Tie Player Two',
    nickname: 'Tie Player Two',
    nicknameKey: 'tie player two',
    tokenHash: hashParticipantToken(`tie-two-${suffix}`),
    status: 'ACTIVE',
    score: 500,
    totalResponseTimeMs: 1000,
    joinedAt: new Date(Date.now() - 1000),
  });
  const tieLeaderboard = await gameEngine.buildLeaderboard(tieSession._id);
  check(tieLeaderboard.length === 2, 'tie leaderboard includes both players');
  check(
    tieLeaderboard[0].participantId === tiePlayerTwo._id.toString(),
    'equal scores are ordered by total response time'
  );
  check(
    tieLeaderboard[0].rank === 1 && tieLeaderboard[1].rank === 1,
    'players with equal scores share a rank'
  );
  check(
    tieLeaderboard[0].position === 1 && tieLeaderboard[1].position === 2,
    'tied players still have deterministic positions'
  );
  check(
    tieLeaderboard[1].participantId === tiePlayerOne._id.toString(),
    'tie ordering is deterministic'
  );

  const recoveryQuizResponse = await request('POST', '/quizzes', {
    token: tokenTeacher,
    body: { title: `Recovery Quiz ${suffix}` },
  });
  const recoveryQuizBody = expectStatus(
    recoveryQuizResponse,
    201,
    'POST /quizzes for recovery test'
  );
  const recoveryQuizId = recoveryQuizBody.data.quiz.id;
  const recoveryQuestionResponse = await request(
    'POST',
    `/quizzes/${recoveryQuizId}/questions`,
    {
      token: tokenTeacher,
      body: {
        text: 'Recovery question',
        points: 1000,
        timeLimitSec: 120,
        options: [
          { text: 'Recovery correct', isCorrect: true },
          { text: 'Recovery wrong', isCorrect: false },
        ],
      },
    }
  );
  const recoveryQuestionBody = expectStatus(
    recoveryQuestionResponse,
    201,
    'POST recovery question'
  );
  const recoveryQuestionId = recoveryQuestionBody.data.question.id;
  const recoveryCorrectId = recoveryQuestionBody.data.question.options.find(
    (option) => option.isCorrect
  ).id;

  const recoverySessionResponse = await request('POST', '/sessions', {
    token: tokenTeacher,
    body: { quiz: recoveryQuizId },
  });
  const recoverySessionBody = expectStatus(
    recoverySessionResponse,
    201,
    'POST /sessions for recovery test'
  );
  const recoverySessionId = recoverySessionBody.data.session.id;
  const recoveryJoinCode = recoverySessionBody.data.session.joinCode;

  const recoveryTeacher = await connectGameSocket({
    role: 'teacher',
    token: tokenTeacher,
    sessionId: recoverySessionId,
  });
  const recoveryP4Join = await request('POST', `/join/${recoveryJoinCode}`, {
    body: { nickname: `Recovery P4 ${suffix}`.slice(0, 50) },
  });
  const recoveryP4Body = expectStatus(recoveryP4Join, 201, 'POST /join recovery player four');
  const recoveryP4Id = recoveryP4Body.data.participant.id;
  const recoveryP4Token = recoveryP4Body.data.participant.participantToken;
  const recoveryP5Join = await request('POST', `/join/${recoveryJoinCode}`, {
    body: { nickname: `Recovery P5 ${suffix}`.slice(0, 50) },
  });
  const recoveryP5Body = expectStatus(recoveryP5Join, 201, 'POST /join recovery player five');
  const recoveryP5Token = recoveryP5Body.data.participant.participantToken;

  const recoveryP4 = await connectGameSocket({
    role: 'player',
    joinCode: recoveryJoinCode,
    participantToken: recoveryP4Token,
  });
  const recoveryP5 = await connectGameSocket({
    role: 'player',
    joinCode: recoveryJoinCode,
    participantToken: recoveryP5Token,
  });
  const recoveryStartedPromise = waitForSocketEvent(
    recoveryTeacher.socket,
    'question:started',
    (payload) => payload.index === 0
  );
  const recoveryStartAck = await emitWithAck(recoveryTeacher.socket, 'game:start');
  check(recoveryStartAck.success === true, 'recovery game starts');
  await recoveryStartedPromise;

  const recoveryAnswerAck = await emitWithAck(recoveryP4.socket, 'answer:submit', {
    questionId: recoveryQuestionId,
    optionId: recoveryCorrectId,
  });
  check(recoveryAnswerAck.success === true, 'recovery player answers before restart');
  await delay(200);

  closeSocket(recoveryTeacher.socket);
  closeSocket(recoveryP4.socket);
  closeSocket(recoveryP5.socket);
  await delay(100);
  await stopServer();
  await startServer();

  const recoveryTeacherAfter = await connectGameSocket({
    role: 'teacher',
    token: tokenTeacher,
    sessionId: recoverySessionId,
  });
  check(recoveryTeacherAfter.state.status === 'LIVE', 'live session survives a server restart');
  check(
    recoveryTeacherAfter.state.gameState === 'QUESTION',
    'question phase is recovered after restart'
  );
  check(
    recoveryTeacherAfter.state.currentQuestionIndex === 0,
    'current question index is recovered'
  );
  check(recoveryTeacherAfter.state.answerCount === 1, 'answer count is recovered from MongoDB');

  const recoveryP4After = await connectGameSocket({
    role: 'player',
    joinCode: recoveryJoinCode,
    participantToken: recoveryP4Token,
  });
  check(recoveryP4After.state.you.score > 0, 'player score survives a server restart');
  check(
    recoveryP4After.state.yourAnswer?.selectedOptionId === recoveryCorrectId,
    'player answer survives a server restart'
  );

  const duplicateAfterRestart = await emitWithAck(
    recoveryP4After.socket,
    'answer:submit',
    { questionId: recoveryQuestionId, optionId: recoveryCorrectId }
  );
  check(duplicateAfterRestart.success === false, 'duplicate answer is rejected after restart');
  check(
    duplicateAfterRestart.error.code === 'ALREADY_ANSWERED',
    'restart does not allow duplicate scoring'
  );

  const recoveryP5After = await connectGameSocket({
    role: 'player',
    joinCode: recoveryJoinCode,
    participantToken: recoveryP5Token,
  });
  const recoveryFinishedPromise = waitForSocketEvent(
    recoveryTeacherAfter.socket,
    'game:finished'
  );
  const recoveryP5Ack = await emitWithAck(recoveryP5After.socket, 'answer:submit', {
    questionId: recoveryQuestionId,
    optionId: recoveryCorrectId,
  });
  check(recoveryP5Ack.success === true, 'recovered game accepts a new answer');

  const recoveryFinished = await recoveryFinishedPromise;
  check(recoveryFinished.leaderboard.length === 2, 'recovered game finishes with both players');

  const recoverySessionAfter = await request(
    'GET',
    `/sessions/${recoverySessionId}`,
    { token: tokenTeacher }
  );
  const recoverySessionAfterBody = expectStatus(
    recoverySessionAfter,
    200,
    'GET recovered session after finish'
  );
  check(
    recoverySessionAfterBody.data.session.status === 'FINISHED',
    'recovered session can be finished'
  );

  const recoveryP4Doc = await SessionPlayer.findById(recoveryP4Id);
  check(recoveryP4Doc.score > 0, 'recovered player score is persisted after finish');
  check(recoveryP4Doc.answeredCount === 1, 'recovered player answer count is persisted');

  // A crash can leave `connected: true` behind because disconnect handlers
  // never ran. Startup recovery must clear those stale flags.
  const stalePlayer = await SessionPlayer.create({
    session: recoverySessionId,
    organization: orgAId,
    name: 'Stale Recovery Player',
    nickname: `stale-recovery-${suffix}`,
    nicknameKey: `stale-recovery-${suffix}`,
    tokenHash: hashParticipantToken(`stale-recovery-${suffix}`),
    status: 'ACTIVE',
    connected: true,
    joinedAt: new Date(),
    lastSeenAt: new Date(),
  });
  await gameEngine.recoverSessions();
  const stalePlayerAfter = await SessionPlayer.findById(stalePlayer._id);
  check(
    stalePlayerAfter.connected === false &&
      Boolean(stalePlayerAfter.lastDisconnectedAt),
    'startup recovery clears stale connected flags'
  );

  closeSocket(recoveryTeacherAfter.socket);
  closeSocket(recoveryP4After.socket);
  closeSocket(recoveryP5After.socket);
}

async function runPhase6Tests({
  suffix,
  tokenTeacher,
  tokenAssistant,
  orgAId,
  teacherId,
}) {
  console.log('\nPhase 6 teacher controls + commands smoke tests\n');

  const cardsById = new Map(GIFT_CARDS.map((card) => [card.id, card]));

  function makeQuestionFixture({ points = 1000, timeLimitSec = 5 } = {}) {
    const questionId = new mongoose.Types.ObjectId();
    const correctOptionId = new mongoose.Types.ObjectId();
    const wrongOptionId = new mongoose.Types.ObjectId();

    return {
      questionId,
      correctOptionId,
      wrongOptionId,
      snapshot: {
        question: questionId,
        text: `Phase 6 fixture question ${questionId}`,
        points,
        timeLimitSec,
        order: 0,
        explanation: null,
        options: [
          { optionId: correctOptionId, text: 'Correct', isCorrect: true },
          { optionId: wrongOptionId, text: 'Wrong', isCorrect: false },
        ],
      },
    };
  }

  async function createFixtureSession({
    gameQuestions,
    currentQuestionIndex = 0,
    gameState = 'QUESTION',
    status = 'LIVE',
    commandSettings,
    phaseEndsAt,
  }) {
    return Session.create({
      quiz: new mongoose.Types.ObjectId(),
      organization: orgAId,
      createdBy: teacherId,
      joinCode: generateJoinCode(),
      status,
      joinOpen: false,
      gameState,
      gameQuestions,
      currentQuestionIndex,
      phaseStartedAt: new Date(),
      phaseEndsAt: phaseEndsAt || new Date(Date.now() + 60000),
      commandSettings,
    });
  }

  async function createFixturePlayer({
    sessionId,
    nickname,
    score = 0,
    streak = 0,
    connected = true,
    offlineSinceQuestionIndex = null,
    joinedAt = null,
    status = 'ACTIVE',
  }) {
    return SessionPlayer.create({
      session: sessionId,
      organization: orgAId,
      name: nickname,
      nickname,
      nicknameKey: nickname.toLowerCase(),
      tokenHash: hashParticipantToken(
        `phase6-${nickname}-${suffix}-${Math.random()}`
      ),
      status,
      score,
      streak,
      bestStreak: streak,
      connected,
      offlineSinceQuestionIndex,
      joinedAt: joinedAt || new Date(),
    });
  }

  async function createAnswer({
    session,
    player,
    question,
    isCorrect,
    pointsAwarded = 100,
  }) {
    return Answer.create({
      session: session._id,
      organization: session.organization,
      sessionPlayer: player._id,
      question,
      selectedOptionId: new mongoose.Types.ObjectId(),
      isCorrect,
      responseTimeMs: 100,
      pointsAwarded,
      basePointsAwarded: pointsAwarded,
      applied: true,
    });
  }

  async function createQuizWithQuestions(title, count) {
    const quizResponse = await request('POST', '/quizzes', {
      token: tokenTeacher,
      body: { title: `${title} ${suffix}` },
    });
    const quizBody = expectStatus(
      quizResponse,
      201,
      `POST /quizzes for ${title}`
    );
    const quizId = quizBody.data.quiz.id;
    const questions = [];

    for (let index = 0; index < count; index += 1) {
      const questionResponse = await request(
        'POST',
        `/quizzes/${quizId}/questions`,
        {
          token: tokenTeacher,
          body: {
            text: `${title} question ${index + 1} ${suffix}`,
            points: 1000,
            timeLimitSec: 5,
            options: [
              { text: 'Correct', isCorrect: true },
              { text: 'Wrong A', isCorrect: false },
              { text: 'Wrong B', isCorrect: false },
            ],
          },
        }
      );
      const questionBody = expectStatus(
        questionResponse,
        201,
        `POST ${title} question ${index + 1}`
      );

      questions.push({
        id: questionBody.data.question.id,
        correctId: questionBody.data.question.options.find(
          (option) => option.isCorrect
        ).id,
        wrongId: questionBody.data.question.options.find(
          (option) => !option.isCorrect
        ).id,
      });
    }

    return { quizId, questions };
  }

  async function createSessionForQuiz(quizId, label) {
    const response = await request('POST', '/sessions', {
      token: tokenTeacher,
      body: { quiz: quizId },
    });
    const body = expectStatus(response, 201, `POST /sessions for ${label}`);

    return {
      sessionId: body.data.session.id,
      joinCode: body.data.session.joinCode,
    };
  }

  async function joinPlayer(joinCode, nickname) {
    const response = await request('POST', `/join/${joinCode}`, {
      body: { nickname: nickname.slice(0, 50) },
    });
    const body = expectStatus(response, 201, `POST /join ${nickname}`);

    return {
      id: body.data.participant.id,
      token: body.data.participant.participantToken,
    };
  }

  async function applyCards(player, cards, commandId, session) {
    return gameCommands.applyGiftCardsToPlayer(session, player, cards, {
      commandId,
    });
  }

  check(
    COMMAND_SELECTION_TIMEOUT_MS === 3000,
    'command selection timeout honors the smoke-test override'
  );
  check(
    THIEF_ACTIVATION_CHANCE === 1,
    'thief activation chance honors the smoke-test override'
  );
  check(GIFT_CARDS.length === 5, 'gift pool contains five cards');
  check(
    new Set(GIFT_CARDS.map((card) => card.id)).size === GIFT_CARDS.length,
    'gift cards are unique'
  );
  check(
    GIFT_CARDS.every((card) => card.weight > 0),
    'gift cards have positive independent draw weights'
  );
  check(
    cardsById.get('DOUBLE_POINTS').rarity === CARD_RARITIES.COMMON,
    'Double Points has COMMON rarity'
  );
  check(
    cardsById.get('STREAK_SHIELD').rarity === CARD_RARITIES.UNCOMMON,
    'Streak Shield has UNCOMMON rarity'
  );
  check(
    cardsById.get('LEADERBOARD_STRIKE').rarity === CARD_RARITIES.RARE,
    'Leaderboard Strike has RARE rarity'
  );
  check(
    cardsById.get('POINTS_BONUS').rarity === CARD_RARITIES.COMMON,
    'Points Bonus has COMMON rarity'
  );
  check(
    cardsById.get('COLOR_SHARDS').rarity === CARD_RARITIES.UNCOMMON,
    'Color Shards has UNCOMMON rarity'
  );

  const lowDraw = gameCommands.drawGiftCards(() => 0);
  check(
    lowDraw.length === GIFT_DRAW_COUNT,
    'gift draws three cards per unlock'
  );
  check(
    new Set(lowDraw.map((card) => card.id)).size === GIFT_DRAW_COUNT,
    'gift draws cards without replacement'
  );
  check(
    lowDraw.map((card) => card.id).join(',') ===
      'DOUBLE_POINTS,STREAK_SHIELD,LEADERBOARD_STRIKE',
    'weighted gift draw follows the independent card weights'
  );
  const highDraw = gameCommands.drawGiftCards(() => 0.999999);
  check(
    highDraw.map((card) => card.id).join(',') ===
      'COLOR_SHARDS,POINTS_BONUS,LEADERBOARD_STRIKE',
    'weighted gift draw can select rare and uncommon cards'
  );

  check(
    gameCommands.isNukeUnlock(5) &&
      gameCommands.isNukeUnlock(10) &&
      gameCommands.isNukeUnlock(15) &&
      gameCommands.isNukeUnlock(20),
    'rocket unlocks at five and every subsequent multiple of five'
  );
  check(
    !gameCommands.isNukeUnlock(0) &&
      !gameCommands.isNukeUnlock(4) &&
      !gameCommands.isNukeUnlock(6) &&
      !gameCommands.isNukeUnlock(9),
    'rocket does not unlock on non-multiples of five'
  );
  check(
    gameCommands.shouldActivateThief(() => 0.34, 0.35) === true,
    'thief activates below the configured chance'
  );
  check(
    gameCommands.shouldActivateThief(() => 0.35, 0.35) === false,
    'thief does not activate at the configured chance boundary'
  );
  check(
    gameCommands.shouldActivateThief(() => 0.99, 0) === false &&
      gameCommands.shouldActivateThief(() => 0, 1) === true,
    'thief activation is chance-driven'
  );
  check(
    !gameCommands.commandEnabled({ commandSettings: {} }, 'GIFT') &&
      !gameCommands.commandEnabled({ commandSettings: {} }, 'THIEF') &&
      !gameCommands.commandEnabled({ commandSettings: {} }, 'ROCKET'),
    'commands are disabled by default'
  );
  check(
    gameCommands.commandEnabled({ commandSettings: { gift: true } }, 'GIFT') &&
      !gameCommands.commandEnabled({ commandSettings: { gift: true } }, 'THIEF'),
    'each command can be enabled independently'
  );

  const cardSession = await createFixtureSession({
    gameQuestions: [makeQuestionFixture().snapshot],
    commandSettings: { gift: true, thief: false, rocket: false },
  });
  const cardOwner = await createFixturePlayer({
    sessionId: cardSession._id,
    nickname: `Card Owner ${suffix}`,
  });
  await createFixturePlayer({
    sessionId: cardSession._id,
    nickname: `Card Other ${suffix}`,
    score: 500,
  });

  const bonusResult = await applyCards(
    cardOwner,
    [cardsById.get('POINTS_BONUS')],
    `card-bonus-${suffix}`,
    cardSession
  );
  check(bonusResult.value === 100, 'Points Bonus grants 100 points');
  check(bonusResult.scoreAfter === 100, 'Points Bonus updates the owner score');
  const bonusAgain = await applyCards(
    cardOwner,
    [cardsById.get('POINTS_BONUS')],
    `card-bonus-${suffix}`,
    cardSession
  );
  check(bonusAgain.alreadyApplied === true, 'the same gift command is idempotent');
  check(
    (await SessionPlayer.findById(cardOwner._id)).score === 100,
    'duplicate gift execution does not add points twice'
  );

  const doubleFirst = await applyCards(
    cardOwner,
    [cardsById.get('DOUBLE_POINTS')],
    `card-double-1-${suffix}`,
    cardSession
  );
  check(
    doubleFirst.effects[0].applied === true,
    'Double Points activates a pending effect'
  );
  const doubleSecond = await applyCards(
    cardOwner,
    [cardsById.get('DOUBLE_POINTS')],
    `card-double-2-${suffix}`,
    cardSession
  );
  check(
    doubleSecond.effects[0].applied === false &&
      doubleSecond.effects[0].alreadyActive === true,
    'Double Points never stacks more than once'
  );

  const shieldFirst = await applyCards(
    cardOwner,
    [cardsById.get('STREAK_SHIELD')],
    `card-shield-1-${suffix}`,
    cardSession
  );
  check(
    shieldFirst.effects[0].applied === true,
    'Streak Shield activates a pending effect'
  );
  const shieldSecond = await applyCards(
    cardOwner,
    [cardsById.get('STREAK_SHIELD')],
    `card-shield-2-${suffix}`,
    cardSession
  );
  check(
    shieldSecond.effects[0].applied === false &&
      shieldSecond.effects[0].alreadyActive === true,
    'Streak Shield never stacks more than once'
  );

  for (let index = 0; index < 3; index += 1) {
    await applyCards(
      cardOwner,
      [cardsById.get('COLOR_SHARDS')],
      `card-shards-${index}-${suffix}`,
      cardSession
    );
  }

  const shardPlayer = await SessionPlayer.findById(cardOwner._id);
  check(shardPlayer.colorShards === 0, 'three color shards are consumed on unlock');
  check(shardPlayer.unlockedColors.length === 1, 'three color shards unlock one color');
  check(
    AVATAR_COLOR_IDS.includes(shardPlayer.unlockedColors[0]),
    'unlocked color is a valid avatar color'
  );

  const strikeSession = await createFixtureSession({
    gameQuestions: [makeQuestionFixture().snapshot],
    commandSettings: { gift: true },
  });
  const strikeLeader = await createFixturePlayer({
    sessionId: strikeSession._id,
    nickname: `Strike Leader ${suffix}`,
    score: 500,
    joinedAt: new Date(Date.now() - 2000),
  });
  const strikeOwner = await createFixturePlayer({
    sessionId: strikeSession._id,
    nickname: `Strike Owner ${suffix}`,
    score: 100,
    joinedAt: new Date(Date.now() - 1000),
  });
  const strikeResult = await applyCards(
    strikeOwner,
    [cardsById.get('LEADERBOARD_STRIKE')],
    `card-strike-${suffix}`,
    strikeSession
  );
  check(strikeResult.value === 100, 'Leaderboard Strike steals up to 100 points');
  check(
    (await SessionPlayer.findById(strikeLeader._id)).score === 400,
    'Leaderboard Strike removes points from the player above'
  );
  check(
    (await SessionPlayer.findById(strikeOwner._id)).score === 200,
    'Leaderboard Strike transfers points to the owner'
  );

  await SessionPlayer.updateOne(
    { _id: strikeOwner._id },
    { $set: { score: 1000 } }
  );
  const strikeFirst = await applyCards(
    strikeOwner,
    [cardsById.get('LEADERBOARD_STRIKE')],
    `card-strike-first-${suffix}`,
    strikeSession
  );
  check(
    strikeFirst.value === 100 &&
      strikeFirst.effects[0].firstPlaceBonus === true,
    'first place receives a 100 point Leaderboard Strike bonus'
  );
  check(
    (await SessionPlayer.findById(strikeOwner._id)).score === 1100,
    'first place strike bonus is persisted'
  );

  const queueQuestion = makeQuestionFixture();
  const queueSession = await createFixtureSession({
    gameQuestions: [queueQuestion.snapshot, makeQuestionFixture().snapshot],
    commandSettings: { gift: true, thief: true, rocket: true },
  });
  const queueActor = await createFixturePlayer({
    sessionId: queueSession._id,
    nickname: `Queue Actor ${suffix}`,
    score: 0,
    streak: 2,
  });
  const queueTarget = await createFixturePlayer({
    sessionId: queueSession._id,
    nickname: `Queue Target ${suffix}`,
    score: 300,
    streak: 1,
  });
  const queueQuestionId = queueSession.gameQuestions[0].question;

  await SessionCommand.create([
    {
      session: queueSession._id,
      organization: orgAId,
      commandId: `queue-rocket-${suffix}`,
      type: 'ROCKET',
      priority: 3,
      actor: queueActor._id,
      question: queueQuestionId,
      questionIndex: 0,
      status: 'QUEUED',
    },
    {
      session: queueSession._id,
      organization: orgAId,
      commandId: `queue-thief-${suffix}`,
      type: 'THIEF',
      priority: 2,
      actor: queueActor._id,
      question: queueQuestionId,
      questionIndex: 0,
      status: 'QUEUED',
    },
    {
      session: queueSession._id,
      organization: orgAId,
      commandId: `queue-gift-${suffix}`,
      type: 'GIFT',
      priority: 1,
      actor: queueActor._id,
      question: queueQuestionId,
      questionIndex: 0,
      status: 'QUEUED',
    },
  ]);

  await gameCommands.processQueue(queueSession._id);
  const queueGift = await SessionCommand.findOne({
    commandId: `queue-gift-${suffix}`,
  });
  const queueThief = await SessionCommand.findOne({
    commandId: `queue-thief-${suffix}`,
  });
  const queueRocket = await SessionCommand.findOne({
    commandId: `queue-rocket-${suffix}`,
  });
  check(queueGift.status === 'COMPLETED', 'gift command is processed first');
  check(
    queueThief.status === 'AWAITING_TARGET',
    'thief waits for target selection after gift completes'
  );
  check(queueRocket.status === 'QUEUED', 'rocket waits behind gift and thief');
  const queueSessionAfter = await Session.findById(queueSession._id);
  check(
    queueSessionAfter.activeCommand?.toString() === queueThief._id.toString(),
    'session tracks exactly one active command'
  );
  await gameCommands.cancelAllForSession(queueSessionAfter, 'TEST_CLEANUP');
  check(
    (await SessionCommand.countDocuments({
      session: queueSession._id,
      status: { $in: ['QUEUED', 'AWAITING_TARGET', 'PROCESSING'] },
    })) === 0,
    'cancelling a session clears its queued and active commands'
  );

  const timeoutQuestion = makeQuestionFixture();
  const timeoutSession = await createFixtureSession({
    gameQuestions: [timeoutQuestion.snapshot, makeQuestionFixture().snapshot],
    commandSettings: { thief: true },
  });
  const timeoutActor = await createFixturePlayer({
    sessionId: timeoutSession._id,
    nickname: `Timeout Actor ${suffix}`,
    score: 50,
    streak: 1,
  });
  const timeoutTarget = await createFixturePlayer({
    sessionId: timeoutSession._id,
    nickname: `Timeout Target ${suffix}`,
    score: 250,
    streak: 3,
  });
  const timeoutCommand = await SessionCommand.create({
    session: timeoutSession._id,
    organization: orgAId,
    commandId: `timeout-thief-${suffix}`,
    type: 'THIEF',
    priority: 2,
    actor: timeoutActor._id,
    question: timeoutQuestion.questionId,
    questionIndex: 0,
    status: 'QUEUED',
  });

  await gameCommands.processQueue(timeoutSession._id);
  const waitingCommand = await SessionCommand.findById(timeoutCommand._id);
  check(
    waitingCommand.status === 'AWAITING_TARGET',
    'thief waits for owner target selection'
  );
  check(
    waitingCommand.selectionEndsAt instanceof Date,
    'target selection persists a deadline'
  );

  await SessionPlayer.updateOne(
    { _id: timeoutActor._id },
    { $set: { connected: false, offlineSinceQuestionIndex: 0 } }
  );
  await gameCommands.handleSelectionTimeout(
    timeoutSession._id,
    timeoutCommand._id
  );

  const completedTimeout = await SessionCommand.findById(timeoutCommand._id);
  const timeoutTargetDoc = await SessionPlayer.findById(timeoutTarget._id);
  const timeoutActorDoc = await SessionPlayer.findById(timeoutActor._id);
  const timeoutSessionAfter = await Session.findById(timeoutSession._id);
  check(
    completedTimeout.status === 'COMPLETED',
    'selection timeout resolves the thief command'
  );
  check(
    completedTimeout.result.autoSelected === true &&
      completedTimeout.result.reason === 'TIMEOUT',
    'selection timeout auto-selects the first eligible target'
  );
  check(
    completedTimeout.target.toString() === timeoutTarget._id.toString(),
    'selection timeout records the auto-selected target'
  );
  check(
    timeoutTargetDoc.score === 0 && timeoutTargetDoc.streak === 0,
    'thief resets the target score and streak'
  );
  check(
    timeoutActorDoc.score === 300,
    'thief transfers the entire target score to the owner'
  );
  check(
    timeoutActorDoc.appliedCommandIds.includes(timeoutCommand.commandId) &&
      timeoutTargetDoc.appliedCommandIds.includes(timeoutCommand.commandId),
    'thief idempotency markers are persisted on owner and target'
  );
  check(
    timeoutSessionAfter.activeCommand === null,
    'completed command clears the active command'
  );

  const timeoutEvent = await SessionEvent.findOne({
    dedupeKey: timeoutCommand.commandId,
  });
  check(
    timeoutEvent && timeoutEvent.type === 'THIEF',
    'thief command persists a SessionEvent'
  );
  check(timeoutEvent.value === 250, 'SessionEvent records the stolen value');
  check(
    timeoutEvent.targetId.toString() === timeoutTarget._id.toString(),
    'SessionEvent records the thief target'
  );
  check(
    timeoutEvent.metadata.autoSelected === true,
    'SessionEvent records timeout auto-selection'
  );

  const timeoutEventCount = await SessionEvent.countDocuments({
    dedupeKey: timeoutCommand.commandId,
  });
  await gameCommands.handleSelectionTimeout(
    timeoutSession._id,
    timeoutCommand._id
  );
  const timeoutTargetAfter = await SessionPlayer.findById(timeoutTarget._id);
  const timeoutActorAfter = await SessionPlayer.findById(timeoutActor._id);
  check(
    timeoutTargetAfter.score === 0 && timeoutActorAfter.score === 300,
    'duplicate timeout resolution does not apply the effect twice'
  );
  check(
    (await SessionEvent.countDocuments({
      dedupeKey: timeoutCommand.commandId,
    })) === timeoutEventCount,
    'duplicate timeout resolution does not create another SessionEvent'
  );

  let lateSelectionError = null;
  try {
    await gameCommands.selectTarget(timeoutActor._id, timeoutTarget._id);
  } catch (error) {
    lateSelectionError = error;
  }
  check(
    lateSelectionError?.code === 'COMMAND_NOT_ACTIVE',
    'late target selection is rejected after timeout resolution'
  );

  const noTargetQuestion = makeQuestionFixture();
  const noTargetSession = await createFixtureSession({
    gameQuestions: [noTargetQuestion.snapshot, makeQuestionFixture().snapshot],
    commandSettings: { thief: true },
  });
  const noTargetActor = await createFixturePlayer({
    sessionId: noTargetSession._id,
    nickname: `No Target Actor ${suffix}`,
    score: 100,
    streak: 1,
  });
  await createFixturePlayer({
    sessionId: noTargetSession._id,
    nickname: `No Target Player ${suffix}`,
    score: 0,
  });
  const noTargetCommand = await SessionCommand.create({
    session: noTargetSession._id,
    organization: orgAId,
    commandId: `no-target-thief-${suffix}`,
    type: 'THIEF',
    priority: 2,
    actor: noTargetActor._id,
    question: noTargetQuestion.questionId,
    questionIndex: 0,
    status: 'QUEUED',
  });
  await gameCommands.processQueue(noTargetSession._id);
  const noTargetResult = await SessionCommand.findById(noTargetCommand._id);
  check(
    noTargetResult.status === 'CANCELLED' &&
      noTargetResult.error === 'NO_ELIGIBLE_TARGET',
    'thief is cancelled when no eligible target exists'
  );

  const revalidateQuestion = makeQuestionFixture();
  const revalidateSession = await createFixtureSession({
    gameQuestions: [revalidateQuestion.snapshot, makeQuestionFixture().snapshot],
    commandSettings: { thief: true },
  });
  const revalidateActor = await createFixturePlayer({
    sessionId: revalidateSession._id,
    nickname: `Revalidate Actor ${suffix}`,
    score: 100,
    streak: 1,
  });
  const revalidateTarget = await createFixturePlayer({
    sessionId: revalidateSession._id,
    nickname: `Revalidate Target ${suffix}`,
    score: 200,
    streak: 1,
  });
  await SessionCommand.create({
    session: revalidateSession._id,
    organization: orgAId,
    commandId: `revalidate-thief-${suffix}`,
    type: 'THIEF',
    priority: 2,
    actor: revalidateActor._id,
    question: revalidateQuestion.questionId,
    questionIndex: 0,
    status: 'QUEUED',
  });
  await gameCommands.processQueue(revalidateSession._id);
  await SessionPlayer.updateOne(
    { _id: revalidateTarget._id },
    { $set: { score: 0 } }
  );
  let revalidateError = null;
  try {
    await gameCommands.selectTarget(revalidateActor._id, revalidateTarget._id);
  } catch (error) {
    revalidateError = error;
  }
  check(
    revalidateError?.code === 'TARGET_INELIGIBLE',
    'target eligibility is revalidated at execution'
  );
  await gameCommands.cancelAllForSession(
    await Session.findById(revalidateSession._id),
    'TEST_CLEANUP'
  );

  const recoverQuestion = makeQuestionFixture();
  const recoverSessionDoc = await createFixtureSession({
    gameQuestions: [recoverQuestion.snapshot, makeQuestionFixture().snapshot],
    commandSettings: { thief: true },
  });
  const recoverActor = await createFixturePlayer({
    sessionId: recoverSessionDoc._id,
    nickname: `Recover Actor ${suffix}`,
    score: 0,
    streak: 1,
  });
  const recoverTarget = await createFixturePlayer({
    sessionId: recoverSessionDoc._id,
    nickname: `Recover Target ${suffix}`,
    score: 200,
    streak: 2,
  });
  const recoverCommand = await SessionCommand.create({
    session: recoverSessionDoc._id,
    organization: orgAId,
    commandId: `recover-thief-${suffix}`,
    type: 'THIEF',
    priority: 2,
    actor: recoverActor._id,
    question: recoverQuestion.questionId,
    questionIndex: 0,
    status: 'AWAITING_TARGET',
    startedAt: new Date(Date.now() - 5000),
    selectionEndsAt: new Date(Date.now() - 1000),
  });
  await Session.updateOne(
    { _id: recoverSessionDoc._id },
    { $set: { activeCommand: recoverCommand._id } }
  );
  await gameCommands.recoverSession(
    await Session.findById(recoverSessionDoc._id)
  );
  const recoveredCommand = await SessionCommand.findById(recoverCommand._id);
  const recoveredTarget = await SessionPlayer.findById(recoverTarget._id);
  check(
    recoveredCommand.status === 'COMPLETED' &&
      recoveredCommand.result.autoSelected === true,
    'expired command selection is recovered after restart'
  );
  check(
    recoveredTarget.score === 0 && recoveredTarget.streak === 0,
    'recovered thief applies its effect exactly once'
  );

  const eligibilityQuestion = makeQuestionFixture();
  const eligibilitySession = await createFixtureSession({
    gameQuestions: [eligibilityQuestion.snapshot],
    currentQuestionIndex: 4,
    commandSettings: { thief: true, rocket: true },
  });
  const eligibilityActor = await createFixturePlayer({
    sessionId: eligibilitySession._id,
    nickname: `Eligibility Actor ${suffix}`,
    score: 100,
  });
  const eligibleTarget = await createFixturePlayer({
    sessionId: eligibilitySession._id,
    nickname: `Eligible Target ${suffix}`,
    score: 200,
    joinedAt: new Date(Date.now() - 3000),
  });
  await createFixturePlayer({
    sessionId: eligibilitySession._id,
    nickname: `Disconnected Target ${suffix}`,
    score: 200,
    connected: false,
  });
  await createFixturePlayer({
    sessionId: eligibilitySession._id,
    nickname: `Stale Target ${suffix}`,
    score: 200,
    offlineSinceQuestionIndex: 2,
  });
  const zeroScoreTarget = await createFixturePlayer({
    sessionId: eligibilitySession._id,
    nickname: `Zero Target ${suffix}`,
    score: 0,
  });
  await createFixturePlayer({
    sessionId: eligibilitySession._id,
    nickname: `Kicked Target ${suffix}`,
    score: 200,
    status: 'KICKED',
  });
  const eligibleTargets = await gameCommands.findEligibleTargets(
    eligibilitySession,
    eligibilityActor._id,
    { requirePositiveScore: true }
  );
  check(
    eligibleTargets.length === 1 &&
      eligibleTargets[0]._id.toString() === eligibleTarget._id.toString(),
    'target eligibility excludes self, disconnected, kicked, stale, and zero-score players'
  );
  const rocketTargets = await gameCommands.findEligibleTargets(
    eligibilitySession,
    eligibilityActor._id,
    { requirePositiveScore: false }
  );
  check(
    rocketTargets.some(
      (player) => player._id.toString() === zeroScoreTarget._id.toString()
    ),
    'rocket can target a zero-score player'
  );
  check(
    rocketTargets.every(
      (player) => player._id.toString() !== eligibilityActor._id.toString()
    ),
    'commands cannot target their owner'
  );

  const giftTrigger = makeQuestionFixture();
  const giftTriggerSession = await createFixtureSession({
    gameQuestions: [giftTrigger.snapshot, makeQuestionFixture().snapshot],
    commandSettings: { gift: true },
  });
  const giftTriggerPlayer = await createFixturePlayer({
    sessionId: giftTriggerSession._id,
    nickname: `Gift Trigger ${suffix}`,
    score: 100,
    streak: 2,
  });
  await createFixturePlayer({
    sessionId: giftTriggerSession._id,
    nickname: `Gift Target ${suffix}`,
    score: 50,
  });
  await createAnswer({
    session: giftTriggerSession,
    player: giftTriggerPlayer,
    question: giftTrigger.questionId,
    isCorrect: true,
  });
  const giftTriggers = await gameCommands.enqueueForQuestion(
    giftTriggerSession
  );
  check(
    giftTriggers.length === 1 && giftTriggers[0].type === 'GIFT',
    'gift unlocks after two consecutive correct answers'
  );

  const noGiftQuestion = makeQuestionFixture();
  const noGiftSession = await createFixtureSession({
    gameQuestions: [noGiftQuestion.snapshot, makeQuestionFixture().snapshot],
    commandSettings: { gift: true },
  });
  const noGiftPlayer = await createFixturePlayer({
    sessionId: noGiftSession._id,
    nickname: `No Gift ${suffix}`,
    score: 100,
    streak: 1,
  });
  await createAnswer({
    session: noGiftSession,
    player: noGiftPlayer,
    question: noGiftQuestion.questionId,
    isCorrect: true,
  });
  check(
    (await gameCommands.enqueueForQuestion(noGiftSession)).length === 0,
    'gift requires a streak of exactly two'
  );

  const wrongGiftQuestion = makeQuestionFixture();
  const wrongGiftSession = await createFixtureSession({
    gameQuestions: [wrongGiftQuestion.snapshot, makeQuestionFixture().snapshot],
    commandSettings: { gift: true },
  });
  const wrongGiftPlayer = await createFixturePlayer({
    sessionId: wrongGiftSession._id,
    nickname: `Wrong Gift ${suffix}`,
    score: 100,
    streak: 2,
  });
  await createAnswer({
    session: wrongGiftSession,
    player: wrongGiftPlayer,
    question: wrongGiftQuestion.questionId,
    isCorrect: false,
    pointsAwarded: 0,
  });
  check(
    (await gameCommands.enqueueForQuestion(wrongGiftSession)).length === 0,
    'wrong answers do not unlock gift'
  );

  const thiefTrigger = makeQuestionFixture();
  const thiefTriggerSession = await createFixtureSession({
    gameQuestions: [thiefTrigger.snapshot, makeQuestionFixture().snapshot],
    commandSettings: { thief: true },
  });
  const thiefTriggerPlayer = await createFixturePlayer({
    sessionId: thiefTriggerSession._id,
    nickname: `Thief Trigger ${suffix}`,
    score: 100,
    streak: 1,
  });
  await createFixturePlayer({
    sessionId: thiefTriggerSession._id,
    nickname: `Thief Target ${suffix}`,
    score: 200,
  });
  await createAnswer({
    session: thiefTriggerSession,
    player: thiefTriggerPlayer,
    question: thiefTrigger.questionId,
    isCorrect: true,
  });
  const thiefTriggers = await gameCommands.enqueueForQuestion(
    thiefTriggerSession
  );
  check(
    thiefTriggers.length === 1 && thiefTriggers[0].type === 'THIEF',
    'thief unlocks after a correct answer reaching streak one'
  );

  const lastQuestion = makeQuestionFixture();
  const lastQuestionSession = await createFixtureSession({
    gameQuestions: [lastQuestion.snapshot],
    commandSettings: { thief: true },
  });
  const lastQuestionPlayer = await createFixturePlayer({
    sessionId: lastQuestionSession._id,
    nickname: `Last Thief ${suffix}`,
    score: 100,
    streak: 1,
  });
  await createFixturePlayer({
    sessionId: lastQuestionSession._id,
    nickname: `Last Target ${suffix}`,
    score: 200,
  });
  await createAnswer({
    session: lastQuestionSession,
    player: lastQuestionPlayer,
    question: lastQuestion.questionId,
    isCorrect: true,
  });
  check(
    (await gameCommands.enqueueForQuestion(lastQuestionSession)).length === 0,
    'thief never appears on the last question'
  );

  const rocketTrigger = makeQuestionFixture();
  const rocketTriggerSession = await createFixtureSession({
    gameQuestions: [rocketTrigger.snapshot, makeQuestionFixture().snapshot],
    commandSettings: { rocket: true },
  });
  const rocketTriggerPlayer = await createFixturePlayer({
    sessionId: rocketTriggerSession._id,
    nickname: `Rocket Trigger ${suffix}`,
    score: 100,
    streak: 5,
  });
  await createFixturePlayer({
    sessionId: rocketTriggerSession._id,
    nickname: `Rocket Target ${suffix}`,
    score: 200,
  });
  await createAnswer({
    session: rocketTriggerSession,
    player: rocketTriggerPlayer,
    question: rocketTrigger.questionId,
    isCorrect: true,
  });
  const rocketTriggers = await gameCommands.enqueueForQuestion(
    rocketTriggerSession
  );
  check(
    rocketTriggers.length === 1 && rocketTriggers[0].type === 'ROCKET',
    'rocket unlocks at streak five'
  );

  const duplicateCommandSession = await createFixtureSession({
    gameQuestions: [makeQuestionFixture().snapshot],
    commandSettings: { gift: true },
  });
  const duplicateCommandPlayer = await createFixturePlayer({
    sessionId: duplicateCommandSession._id,
    nickname: `Duplicate Command ${suffix}`,
  });
  const duplicateCommandId = `duplicate-command-${suffix}`;
  const duplicateCommand = {
    session: duplicateCommandSession._id,
    organization: orgAId,
    commandId: duplicateCommandId,
    type: 'GIFT',
    priority: 1,
    actor: duplicateCommandPlayer._id,
    question: duplicateCommandSession.gameQuestions[0].question,
    questionIndex: 0,
    status: 'QUEUED',
  };
  await SessionCommand.create(duplicateCommand);
  let duplicateCommandError = null;
  try {
    await SessionCommand.create(duplicateCommand);
  } catch (error) {
    duplicateCommandError = error;
  }
  check(
    duplicateCommandError?.code === 11000,
    'SessionCommand command ids are unique'
  );

  const scoringQuestion = makeQuestionFixture({ points: 1000, timeLimitSec: 10 });
  const scoringSession = await createFixtureSession({
    gameQuestions: [scoringQuestion.snapshot],
  });
  const scoringPlayer = await createFixturePlayer({
    sessionId: scoringSession._id,
    nickname: `Double Scoring ${suffix}`,
  });
  await createFixturePlayer({
    sessionId: scoringSession._id,
    nickname: `Double Other ${suffix}`,
  });
  await SessionPlayer.updateOne(
    { _id: scoringPlayer._id },
    { $set: { doublePointsActive: true } }
  );
  const doubleAck = await gameEngine.submitAnswer(scoringPlayer._id, {
    questionId: scoringQuestion.questionId.toString(),
    optionId: scoringQuestion.correctOptionId.toString(),
  });
  check(doubleAck.sessionId === scoringSession._id.toString(), 'scoring accepts a live answer');
  const doubleAnswer = await Answer.findOne({
    sessionPlayer: scoringPlayer._id,
    question: scoringQuestion.questionId,
  });
  const doublePlayer = await SessionPlayer.findById(scoringPlayer._id);
  check(
    doubleAnswer.doublePointsApplied === true,
    'double points marks the scored answer'
  );
  check(
    doubleAnswer.pointsAwarded === doubleAnswer.basePointsAwarded * 2,
    'double points doubles the awarded question points'
  );
  check(
    doublePlayer.doublePointsActive === false,
    'double points is consumed after one question'
  );

  const shieldQuestion = makeQuestionFixture({ points: 1000, timeLimitSec: 10 });
  const shieldSession = await createFixtureSession({
    gameQuestions: [shieldQuestion.snapshot],
  });
  const shieldPlayer = await createFixturePlayer({
    sessionId: shieldSession._id,
    nickname: `Shield Scoring ${suffix}`,
    streak: 2,
  });
  await createFixturePlayer({
    sessionId: shieldSession._id,
    nickname: `Shield Other ${suffix}`,
  });
  await SessionPlayer.updateOne(
    { _id: shieldPlayer._id },
    { $set: { streakShieldActive: true } }
  );
  await gameEngine.submitAnswer(shieldPlayer._id, {
    questionId: shieldQuestion.questionId.toString(),
    optionId: shieldQuestion.wrongOptionId.toString(),
  });
  const shieldAnswer = await Answer.findOne({
    sessionPlayer: shieldPlayer._id,
    question: shieldQuestion.questionId,
  });
  const shieldPlayerDoc = await SessionPlayer.findById(shieldPlayer._id);
  check(
    shieldAnswer.streakShieldApplied === true,
    'streak shield marks the incorrect answer'
  );
  check(
    shieldPlayerDoc.streak === 2,
    'streak shield preserves the streak after a wrong answer'
  );
  check(
    shieldPlayerDoc.streakShieldActive === false,
    'streak shield is consumed after protecting one answer'
  );

  const stateWithEffects = await gameEngine.getGameState(shieldSession, {
    participant: shieldPlayerDoc,
  });
  check(
    'doublePointsActive' in stateWithEffects.you &&
      'streakShieldActive' in stateWithEffects.you &&
      'colorShards' in stateWithEffects.you,
    'player game state exposes pending effects and shards'
  );

  const commandQuiz = await createQuizWithQuestions('Phase 6 command quiz', 3);
  const commandGame = await createSessionForQuiz(
    commandQuiz.quizId,
    'Phase 6 command session'
  );
  const commandTeacher = await connectGameSocket({
    role: 'teacher',
    token: tokenTeacher,
    sessionId: commandGame.sessionId,
  });
  check(
    commandTeacher.state.commandSettings.gift === false &&
      commandTeacher.state.commandSettings.thief === false &&
      commandTeacher.state.commandSettings.rocket === false,
    'new sessions start with commands disabled'
  );
  check(
    commandTeacher.state.phaseSettings.revealMs > 0,
    'game state exposes phase settings'
  );
  check(
    commandTeacher.state.questionProgress.total === 0,
    'lobby game state reports zero total questions'
  );

  const enableCommands = await emitWithAck(
    commandTeacher.socket,
    'game:command-settings',
    { gift: true, thief: true, rocket: false }
  );
  check(enableCommands.success === true, 'teacher can enable commands over Socket.IO');
  check(
    enableCommands.data.session.commandSettings.gift === true &&
      enableCommands.data.session.commandSettings.rocket === false,
    'command settings are stored independently'
  );
  const invalidSocketCommands = await emitWithAck(
    commandTeacher.socket,
    'game:command-settings',
    { gift: 'yes' }
  );
  check(
    invalidSocketCommands.success === false &&
      invalidSocketCommands.error.code === 'INVALID_PAYLOAD',
    'socket command settings reject invalid values'
  );
  const shortPhases = await emitWithAck(
    commandTeacher.socket,
    'game:phase-settings',
    {
      revealMs: 120,
      explanationMs: 120,
      pointsMs: 80,
      leaderboardMs: 120,
      phoneLeaderboardMs: 80,
    }
  );
  check(shortPhases.success === true, 'teacher can update phase settings over Socket.IO');
  check(
    shortPhases.data.session.phaseSettings.revealMs === 120,
    'phase duration settings are persisted'
  );

  const commandP1 = await joinPlayer(
    commandGame.joinCode,
    `Command P1 ${suffix}`
  );
  const commandP2 = await joinPlayer(
    commandGame.joinCode,
    `Command P2 ${suffix}`
  );
  const commandP1Socket = await connectGameSocket({
    role: 'player',
    joinCode: commandGame.joinCode,
    participantToken: commandP1.token,
  });
  const commandP2Socket = await connectGameSocket({
    role: 'player',
    joinCode: commandGame.joinCode,
    participantToken: commandP2.token,
  });

  const commandQ1Started = waitForSocketEvent(
    commandTeacher.socket,
    'question:started',
    (payload) => payload.index === 0
  );
  const commandStart = await emitWithAck(commandTeacher.socket, 'game:start');
  check(commandStart.success === true, 'teacher starts the command game');
  await commandQ1Started;

  const commandQ2Started = waitForSocketEvent(
    commandTeacher.socket,
    'question:started',
    (payload) => payload.index === 1,
    8000
  );
  const commandP1Q1 = await emitWithAck(commandP1Socket.socket, 'answer:submit', {
    questionId: commandQuiz.questions[0].id,
    optionId: commandQuiz.questions[0].correctId,
  });
  const commandP2Q1 = await emitWithAck(commandP2Socket.socket, 'answer:submit', {
    questionId: commandQuiz.questions[0].id,
    optionId: commandQuiz.questions[0].wrongId,
  });
  check(
    commandP1Q1.success === true && commandP2Q1.success === true,
    'command game records the first question answers'
  );
  await commandQ2Started;

  const commandP1AfterQ1 = await SessionPlayer.findById(commandP1.id);
  const commandP2AfterQ1 = await SessionPlayer.findById(commandP2.id);
  check(
    commandP1AfterQ1.streak === 1 && commandP2AfterQ1.streak === 0,
    'first question creates the expected command streaks'
  );
  check(
    commandP2AfterQ1.score === 0,
    'wrong first answer leaves no thief target score'
  );

  const giftReceivedPromise = waitForSocketEvent(
    commandP1Socket.socket,
    'gift:received',
    (payload) => payload.sessionId === commandGame.sessionId,
    8000
  );
  const thiefTargetPromise = waitForSocketEvent(
    commandP2Socket.socket,
    'command:target-required',
    (payload) => payload.type === 'THIEF',
    8000
  );
  const thiefResultPromise = waitForSocketEvent(
    commandTeacher.socket,
    'thief:result',
    (payload) => payload.sessionId === commandGame.sessionId,
    8000
  );
  const commandQ3Started = waitForSocketEvent(
    commandTeacher.socket,
    'question:started',
    (payload) => payload.index === 2,
    8000
  );

  const commandP1Q2 = await emitWithAck(commandP1Socket.socket, 'answer:submit', {
    questionId: commandQuiz.questions[1].id,
    optionId: commandQuiz.questions[1].correctId,
  });
  const commandP2Q2 = await emitWithAck(commandP2Socket.socket, 'answer:submit', {
    questionId: commandQuiz.questions[1].id,
    optionId: commandQuiz.questions[1].correctId,
  });
  check(
    commandP1Q2.success === true && commandP2Q2.success === true,
    'second question answers unlock gift and thief'
  );

  const giftReceived = await giftReceivedPromise;
  check(giftReceived.cards.length === 3, 'gift delivers three cards');
  check(
    new Set(giftReceived.cards.map((card) => card.id)).size === 3,
    'gift delivers unique cards'
  );
  check(
    giftReceived.cards.every((card) =>
      Object.values(CARD_RARITIES).includes(card.rarity)
    ),
    'gift cards expose independent rarities'
  );
  check(
    giftReceived.cards.every((card) => cardsById.has(card.id)),
    'gift cards come from the configured pool'
  );

  const thiefTarget = await thiefTargetPromise;
  check(
    thiefTarget.targets.some(
      (target) => target.participantId === commandP1.id
    ),
    'thief target list includes an eligible opponent'
  );
  check(
    thiefTarget.targets.every(
      (target) => target.participantId !== commandP2.id
    ),
    'thief target list excludes the owner'
  );
  check(
    new Date(thiefTarget.selectionEndsAt).getTime() > Date.now(),
    'thief target selection includes a future deadline'
  );

  const commandP1BeforeThief = await SessionPlayer.findById(commandP1.id);
  const selectThiefTarget = await emitWithAck(
    commandP2Socket.socket,
    'command:select-target',
    { targetParticipantId: commandP1.id }
  );
  check(selectThiefTarget.success === true, 'thief owner selects a target');
  const thiefResult = await thiefResultPromise;
  check(
    thiefResult.value === commandP1BeforeThief.score,
    'thief steals the entire live target score'
  );
  check(
    thiefResult.autoSelected === false,
    'owner target selection is not marked as auto-selected'
  );

  const commandP1AfterThief = await SessionPlayer.findById(commandP1.id);
  const commandP2AfterThief = await SessionPlayer.findById(commandP2.id);
  check(
    commandP1AfterThief.score === 0 && commandP1AfterThief.streak === 0,
    'thief resets the target score and streak'
  );
  check(
    commandP2AfterThief.score === thiefResult.ownerScoreAfter,
    'thief transfers the stolen score to the owner'
  );

  await commandQ3Started;

  const giftEvent = await SessionEvent.findOne({
    session: commandGame.sessionId,
    type: 'GIFT',
  });
  check(
    giftEvent && giftEvent.actorId.toString() === commandP1.id,
    'gift use is persisted as a SessionEvent'
  );
  check(
    giftEvent.metadata.cards.length === 3,
    'gift SessionEvent stores the drawn cards'
  );
  check(
    giftEvent.questionIndex === 1,
    'gift SessionEvent records the question index'
  );

  const thiefEvent = await SessionEvent.findOne({
    session: commandGame.sessionId,
    type: 'THIEF',
  });
  check(
    thiefEvent && thiefEvent.targetId.toString() === commandP1.id,
    'thief SessionEvent records the selected target'
  );
  check(
    thiefEvent.value === commandP1BeforeThief.score,
    'thief SessionEvent records the stolen value'
  );
  check(
    thiefEvent.metadata.autoSelected === false,
    'thief SessionEvent records owner selection'
  );
  check(
    (await SessionEvent.countDocuments({
      session: commandGame.sessionId,
      type: 'THIEF',
    })) === 1,
    'thief did not trigger on the earlier question'
  );

  const commandFinishedPromise = waitForSocketEvent(
    commandTeacher.socket,
    'game:finished',
    () => true,
    8000
  );
  const commandFinish = await emitWithAck(commandTeacher.socket, 'game:finish');
  check(commandFinish.success === true, 'teacher can finish the command game');
  await commandFinishedPromise;

  closeSocket(commandTeacher.socket);
  closeSocket(commandP1Socket.socket);
  closeSocket(commandP2Socket.socket);

  const rocketQuiz = await createQuizWithQuestions('Phase 6 rocket quiz', 5);
  const rocketGame = await createSessionForQuiz(
    rocketQuiz.quizId,
    'Phase 6 rocket session'
  );
  const rocketTeacher = await connectGameSocket({
    role: 'teacher',
    token: tokenTeacher,
    sessionId: rocketGame.sessionId,
  });
  const rocketSettings = await emitWithAck(
    rocketTeacher.socket,
    'game:command-settings',
    { gift: false, thief: false, rocket: true }
  );
  check(rocketSettings.success === true, 'rocket can be enabled independently');
  const rocketPhases = await emitWithAck(
    rocketTeacher.socket,
    'game:phase-settings',
    {
      revealMs: 120,
      explanationMs: 120,
      pointsMs: 80,
      leaderboardMs: 120,
      phoneLeaderboardMs: 80,
    }
  );
  check(rocketPhases.success === true, 'rocket session accepts short phase durations');

  const rocketP1 = await joinPlayer(rocketGame.joinCode, `Rocket P1 ${suffix}`);
  const rocketP2 = await joinPlayer(rocketGame.joinCode, `Rocket P2 ${suffix}`);
  const rocketP1Socket = await connectGameSocket({
    role: 'player',
    joinCode: rocketGame.joinCode,
    participantToken: rocketP1.token,
  });
  const rocketP2Socket = await connectGameSocket({
    role: 'player',
    joinCode: rocketGame.joinCode,
    participantToken: rocketP2.token,
  });

  const rocketQ1Started = waitForSocketEvent(
    rocketTeacher.socket,
    'question:started',
    (payload) => payload.index === 0
  );
  const rocketStart = await emitWithAck(rocketTeacher.socket, 'game:start');
  check(rocketStart.success === true, 'rocket game starts');
  await rocketQ1Started;

  const rocketTargetPromise = waitForSocketEvent(
    rocketP1Socket.socket,
    'command:target-required',
    (payload) => payload.type === 'ROCKET',
    10000
  );
  const rocketResultPromise = waitForSocketEvent(
    rocketTeacher.socket,
    'rocket:result',
    (payload) => payload.sessionId === rocketGame.sessionId,
    10000
  );
  const rocketFinishedPromise = waitForSocketEvent(
    rocketTeacher.socket,
    'game:finished',
    () => true,
    10000
  );

  for (let index = 0; index < rocketQuiz.questions.length; index += 1) {
    const nextQuestionPromise =
      index < rocketQuiz.questions.length - 1
        ? waitForSocketEvent(
            rocketTeacher.socket,
            'question:started',
            (payload) => payload.index === index + 1,
            8000
          )
        : null;
    const rocketP1Answer = await emitWithAck(
      rocketP1Socket.socket,
      'answer:submit',
      {
        questionId: rocketQuiz.questions[index].id,
        optionId: rocketQuiz.questions[index].correctId,
      }
    );
    check(
      rocketP1Answer.success === true,
      `rocket player answers question ${index + 1} correctly`
    );
    const rocketP2Answer = await emitWithAck(
      rocketP2Socket.socket,
      'answer:submit',
      {
        questionId: rocketQuiz.questions[index].id,
        optionId:
          index === 0
            ? rocketQuiz.questions[index].correctId
            : rocketQuiz.questions[index].wrongId,
      }
    );
    check(
      rocketP2Answer.success === true,
      `rocket opponent answers question ${index + 1}`
    );

    if (nextQuestionPromise) {
      await nextQuestionPromise;
    }
  }

  const rocketTarget = await rocketTargetPromise;
  const rocketP2Before = await SessionPlayer.findById(rocketP2.id);
  const rocketP1Before = await SessionPlayer.findById(rocketP1.id);
  check(
    rocketTarget.targets.some(
      (target) => target.participantId === rocketP2.id
    ),
    'rocket target list includes the opponent'
  );
  check(
    rocketP2Before.score > 0,
    'rocket target has a positive score to reset'
  );

  const selectRocketTarget = await emitWithAck(
    rocketP1Socket.socket,
    'command:select-target',
    { targetParticipantId: rocketP2.id }
  );
  check(selectRocketTarget.success === true, 'rocket owner selects a target');
  const rocketResult = await rocketResultPromise;
  check(
    rocketResult.value === rocketP2Before.score,
    'rocket records the target score'
  );
  check(
    rocketResult.ownerPointsAwarded === 0,
    'rocket awards no points to the owner'
  );

  const rocketP2After = await SessionPlayer.findById(rocketP2.id);
  const rocketP1After = await SessionPlayer.findById(rocketP1.id);
  check(
    rocketP2After.score === 0 && rocketP2After.streak === 0,
    'rocket resets the target score and streak'
  );
  check(
    rocketP1After.score === rocketP1Before.score,
    'rocket does not change the owner score'
  );

  await rocketFinishedPromise;
  const rocketFinishedSession = await Session.findById(rocketGame.sessionId);
  check(
    rocketFinishedSession.status === 'FINISHED' &&
      rocketFinishedSession.gameState === 'FINISHED',
    'rocket session finishes after the last question'
  );

  const rocketEvent = await SessionEvent.findOne({
    session: rocketGame.sessionId,
    type: 'ROCKET',
  });
  check(
    rocketEvent && rocketEvent.targetId.toString() === rocketP2.id,
    'rocket use is persisted with its target'
  );
  check(
    rocketEvent.value === rocketP2Before.score,
    'rocket SessionEvent records the target score'
  );
  check(
    (await SessionEvent.countDocuments({
      session: rocketGame.sessionId,
      type: 'ROCKET',
    })) === 1,
    'rocket triggers exactly once at streak five'
  );

  closeSocket(rocketTeacher.socket);
  closeSocket(rocketP1Socket.socket);
  closeSocket(rocketP2Socket.socket);

  const controlQuiz = await createQuizWithQuestions('Phase 6 controls quiz', 2);
  const controlGame = await createSessionForQuiz(
    controlQuiz.quizId,
    'Phase 6 controls session'
  );
  const controlTeacher = await connectGameSocket({
    role: 'teacher',
    token: tokenTeacher,
    sessionId: controlGame.sessionId,
  });
  const controlAssistant = await connectGameSocket({
    role: 'teacher',
    token: tokenAssistant,
    sessionId: controlGame.sessionId,
  });
  const controlP1 = await joinPlayer(
    controlGame.joinCode,
    `Control P1 ${suffix}`
  );
  const controlP2 = await joinPlayer(
    controlGame.joinCode,
    `Control P2 ${suffix}`
  );
  const controlP1Socket = await connectGameSocket({
    role: 'player',
    joinCode: controlGame.joinCode,
    participantToken: controlP1.token,
  });
  const controlP2Socket = await connectGameSocket({
    role: 'player',
    joinCode: controlGame.joinCode,
    participantToken: controlP2.token,
  });

  const assistantReveal = await emitWithAck(
    controlAssistant.socket,
    'game:reveal'
  );
  check(
    assistantReveal.success === false &&
      assistantReveal.error.code === 'FORBIDDEN',
    'assistant cannot reveal a question'
  );
  const assistantCommands = await emitWithAck(
    controlAssistant.socket,
    'game:command-settings',
    { gift: true }
  );
  check(
    assistantCommands.success === false &&
      assistantCommands.error.code === 'FORBIDDEN',
    'assistant cannot change command settings'
  );
  const assistantPhases = await emitWithAck(
    controlAssistant.socket,
    'game:phase-settings',
    { revealMs: 100 }
  );
  check(
    assistantPhases.success === false &&
      assistantPhases.error.code === 'FORBIDDEN',
    'assistant cannot change phase settings'
  );
  const playerNext = await emitWithAck(controlP1Socket.socket, 'game:next');
  check(
    playerNext.success === false && playerNext.error.code === 'FORBIDDEN',
    'player cannot advance the game'
  );
  const playerSkip = await emitWithAck(controlP1Socket.socket, 'game:skip');
  check(
    playerSkip.success === false && playerSkip.error.code === 'FORBIDDEN',
    'player cannot skip a question'
  );

  const assistantRestReveal = await request(
    'POST',
    `/sessions/${controlGame.sessionId}/reveal`,
    { token: tokenAssistant }
  );
  expectStatus(assistantRestReveal, 403, 'assistant REST reveal is forbidden');

  const invalidRestCommands = await request(
    'PATCH',
    `/sessions/${controlGame.sessionId}/command-settings`,
    { token: tokenTeacher, body: {} }
  );
  expectStatus(
    invalidRestCommands,
    400,
    'REST command settings require at least one field'
  );
  const invalidRestPhases = await request(
    'PATCH',
    `/sessions/${controlGame.sessionId}/phase-settings`,
    { token: tokenTeacher, body: { revealMs: -1 } }
  );
  expectStatus(
    invalidRestPhases,
    400,
    'REST phase durations must be non-negative'
  );

  const restCommands = await request(
    'PATCH',
    `/sessions/${controlGame.sessionId}/command-settings`,
    { token: tokenTeacher, body: { gift: true } }
  );
  const restCommandsBody = expectStatus(
    restCommands,
    200,
    'PATCH /sessions/:id/command-settings'
  );
  check(
    restCommandsBody.data.session.commandSettings.gift === true,
    'REST updates command settings'
  );

  const controlPhases = await emitWithAck(
    controlTeacher.socket,
    'game:phase-settings',
    {
      revealMs: 800,
      explanationMs: 200,
      pointsMs: 400,
      leaderboardMs: 100,
      phoneLeaderboardMs: 100,
      showPoints: false,
    }
  );
  check(controlPhases.success === true, 'teacher updates phase settings');
  check(
    controlPhases.data.session.phaseSettings.showPoints === false,
    'phase visibility can be disabled'
  );

  const closeJoinAck = await emitWithAck(controlTeacher.socket, 'game:join-lock', {
    joinOpen: false,
  });
  check(
    closeJoinAck.success === true &&
      closeJoinAck.data.session.joinOpen === false,
    'teacher can close joining over Socket.IO'
  );
  const openJoinAck = await emitWithAck(controlTeacher.socket, 'game:join-lock', {
    joinOpen: true,
  });
  check(
    openJoinAck.success === true && openJoinAck.data.session.joinOpen === true,
    'teacher can reopen joining over Socket.IO'
  );
  const invalidJoinAck = await emitWithAck(
    controlTeacher.socket,
    'game:join-lock',
    { joinOpen: 'yes' }
  );
  check(
    invalidJoinAck.success === false &&
      invalidJoinAck.error.code === 'INVALID_PAYLOAD',
    'join lock rejects non-boolean values'
  );

  const controlQ1Started = waitForSocketEvent(
    controlTeacher.socket,
    'question:started',
    (payload) => payload.index === 0
  );
  const controlStart = await emitWithAck(controlTeacher.socket, 'game:start');
  check(controlStart.success === true, 'teacher starts the controls game');
  await controlQ1Started;

  const controlState = await emitWithAck(controlTeacher.socket, 'game:sync');
  check(
    controlState.success === true &&
      controlState.data.questionProgress.current === 1 &&
      controlState.data.questionProgress.total === 2,
    'teacher game state exposes question progress'
  );
  check(
    controlState.data.commandSettings.gift === true,
    'teacher game state reflects command settings'
  );
  check(
    controlState.data.phaseSettings.showPoints === false,
    'teacher game state reflects phase settings'
  );
  check(
    controlState.data.participants.every(
      (participant) => typeof participant.commandEligible === 'boolean'
    ),
    'teacher game state exposes participant command eligibility'
  );

  const controlRevealedPromise = waitForSocketEvent(
    controlTeacher.socket,
    'game:revealed',
    (payload) => payload.questionIndex === 0
  );
  const restReveal = await request(
    'POST',
    `/sessions/${controlGame.sessionId}/reveal`,
    { token: tokenTeacher }
  );
  const restRevealBody = expectStatus(
    restReveal,
    200,
    'POST /sessions/:id/reveal'
  );
  check(
    restRevealBody.data.session.gameState === 'REVEAL',
    'REST reveal moves the game to REVEAL'
  );
  await controlRevealedPromise;

  const restNext = await request(
    'POST',
    `/sessions/${controlGame.sessionId}/next`,
    { token: tokenTeacher }
  );
  const restNextBody = expectStatus(
    restNext,
    200,
    'POST /sessions/:id/next'
  );
  check(
    restNextBody.data.session.gameState === 'EXPLANATION',
    'REST next advances from REVEAL to EXPLANATION'
  );

  let pointsShown = false;
  const pointsListener = () => {
    pointsShown = true;
  };
  controlTeacher.socket.on('points:shown', pointsListener);
  const nextToPoints = await emitWithAck(controlTeacher.socket, 'game:next');
  check(
    nextToPoints.success === true &&
      nextToPoints.data.session.gameState === 'POINTS',
    'socket next advances to POINTS'
  );
  await delay(200);
  controlTeacher.socket.off('points:shown', pointsListener);
  check(pointsShown === false, 'showPoints=false suppresses the points event');

  const nextToLeaderboard = await emitWithAck(
    controlTeacher.socket,
    'game:next'
  );
  check(
    nextToLeaderboard.success === true &&
      nextToLeaderboard.data.session.gameState === 'LEADERBOARD',
    'teacher advances from POINTS to LEADERBOARD'
  );
  const nextToPhoneLeaderboard = await emitWithAck(
    controlTeacher.socket,
    'game:next'
  );
  check(
    nextToPhoneLeaderboard.success === true &&
      nextToPhoneLeaderboard.data.session.gameState === 'PHONE_LEADERBOARD',
    'teacher advances to PHONE_LEADERBOARD'
  );

  const controlQ2Started = waitForSocketEvent(
    controlTeacher.socket,
    'question:started',
    (payload) => payload.index === 1,
    8000
  );
  const nextToQuestion = await emitWithAck(controlTeacher.socket, 'game:next');
  check(nextToQuestion.success === true, 'teacher advances to the next question');
  await controlQ2Started;

  const kickedPlayerPromise = waitForSocketEvent(
    controlP2Socket.socket,
    'session:kicked'
  );
  const kickedTeacherPromise = waitForSocketEvent(
    controlTeacher.socket,
    'player:kicked',
    (payload) => payload.participantId === controlP2.id
  );
  const kickAck = await emitWithAck(controlTeacher.socket, 'participant:kick', {
    participantId: controlP2.id,
  });
  check(kickAck.success === true, 'teacher can kick a participant over Socket.IO');
  await kickedPlayerPromise;
  await kickedTeacherPromise;
  check(
    (await SessionPlayer.findById(controlP2.id)).status === 'KICKED',
    'socket kick persists the participant status'
  );

  const controlFinishedPromise = waitForSocketEvent(
    controlTeacher.socket,
    'game:finished',
    () => true,
    8000
  );
  const skipAck = await emitWithAck(controlTeacher.socket, 'game:skip');
  check(skipAck.success === true, 'teacher can skip the last question');
  await controlFinishedPromise;
  const controlFinishedSession = await Session.findById(controlGame.sessionId);
  check(
    controlFinishedSession.status === 'FINISHED' &&
      controlFinishedSession.gameState === 'FINISHED',
    'skipping the last question finishes the game'
  );

  const controlEventTypes = new Set(
    (await SessionEvent.find({ session: controlGame.sessionId })).map(
      (event) => event.type
    )
  );
  for (const type of [
    'TEACHER_START',
    'TEACHER_REVEAL',
    'TEACHER_NEXT',
    'TEACHER_SKIP',
    'TEACHER_COMMAND_SETTINGS',
    'TEACHER_PHASE_SETTINGS',
    'TEACHER_KICK',
    'TEACHER_JOIN_LOCK',
  ]) {
    check(
      controlEventTypes.has(type),
      `SessionEvent records ${type}`
    );
  }
  const teacherEvents = await SessionEvent.find({
    session: controlGame.sessionId,
    type: { $regex: '^TEACHER_' },
  });
  check(
    teacherEvents.every((event) => event.actorType === 'TEACHER'),
    'teacher events use actorType TEACHER'
  );
  check(
    teacherEvents.every(
      (event) =>
        event.actorId && event.actorId.toString() === teacherId
    ),
    'teacher events record the acting teacher'
  );

  closeSocket(controlTeacher.socket);
  closeSocket(controlAssistant.socket);
  closeSocket(controlP1Socket.socket);
}

async function runPhase7Tests({
  suffix,
  tokenA,
  tokenB,
  tokenTeacher,
  tokenAssistant,
  tokenAdmin,
  orgAId,
  orgBId,
  ownerBId,
  teacherId,
}) {
  console.log('\nPhase 7 attendance + reports smoke tests\n');

  function makeQuestion(index, label = '') {
    const questionId = new mongoose.Types.ObjectId();
    const correctOptionId = new mongoose.Types.ObjectId();
    const wrongOptionId = new mongoose.Types.ObjectId();
    const secondWrongOptionId = new mongoose.Types.ObjectId();

    return {
      questionId,
      correctOptionId,
      wrongOptionId,
      secondWrongOptionId,
      snapshot: {
        question: questionId,
        text: `Phase 7 ${label} question ${index + 1} ${suffix}`,
        points: 1000,
        timeLimitSec: 10,
        order: index,
        explanation: null,
        options: [
          { optionId: correctOptionId, text: 'Correct', isCorrect: true },
          { optionId: wrongOptionId, text: 'Wrong A', isCorrect: false },
          {
            optionId: secondWrongOptionId,
            text: 'Wrong B',
            isCorrect: false,
          },
        ],
      },
    };
  }

  async function createParticipant({
    session,
    student = null,
    section = null,
    name,
    nickname,
    score = 0,
    status = 'ACTIVE',
    joinedAt = new Date(),
    connected = false,
    kickedAt = null,
    lastDisconnectedAt = null,
  }) {
    return SessionPlayer.create({
      session: session._id,
      organization: session.organization,
      student: student ? student._id : null,
      section: section ? section._id : null,
      name,
      nickname,
      nicknameKey: nickname.toLowerCase(),
      tokenHash: hashParticipantToken(
        `phase7-${nickname}-${suffix}-${Math.random()}`
      ),
      status,
      score,
      connected,
      joinedAt,
      lastSeenAt: new Date(),
      kickedAt,
      lastDisconnectedAt,
    });
  }

  async function createAnswer({
    session,
    player,
    question,
    isCorrect,
    selectedOptionId,
    responseTimeMs = 100,
    pointsAwarded = 1000,
  }) {
    return Answer.create({
      session: session._id,
      organization: session.organization,
      sessionPlayer: player._id,
      question: question.questionId,
      selectedOptionId,
      isCorrect,
      responseTimeMs,
      pointsAwarded,
      basePointsAwarded: pointsAwarded,
      applied: true,
    });
  }

  // Earlier phases create roster students. Attendance finalization treats the
  // whole organization roster as the absentee denominator, so start Phase 7
  // with a deterministic roster.
  await Student.deleteMany({ organization: orgAId });

  const sectionA = await Section.create({
    name: `Phase 7 Section A ${suffix}`,
    organization: orgAId,
    createdBy: teacherId,
  });
  const sectionB = await Section.create({
    name: `Phase 7 Section B ${suffix}`,
    organization: orgAId,
    createdBy: teacherId,
  });

  const s1 = await Student.create({
    name: `Phase 7 Present ${suffix}`,
    nickname: `present-${suffix}`,
    organization: orgAId,
    section: sectionA._id,
  });
  const s2 = await Student.create({
    name: `Phase 7 Late ${suffix}`,
    nickname: `late-${suffix}`,
    organization: orgAId,
    section: sectionA._id,
  });
  const s3 = await Student.create({
    name: `Phase 7 Kicked ${suffix}`,
    nickname: `kicked-${suffix}`,
    organization: orgAId,
    section: sectionB._id,
  });
  const s4 = await Student.create({
    name: `Phase 7 Absent ${suffix}`,
    nickname: `absent-${suffix}`,
    organization: orgAId,
    section: sectionB._id,
  });
  const s5 = await Student.create({
    name: `Phase 7 Missing ${suffix}`,
    nickname: `missing-${suffix}`,
    organization: orgAId,
    section: sectionA._id,
  });

  const quiz = await Quiz.create({
    title: `Phase 7 Quiz ${suffix}`,
    description: 'Attendance and report fixture',
    organization: orgAId,
    createdBy: teacherId,
  });
  const q1 = makeQuestion(0);
  const q2 = makeQuestion(1);
  const startedAt = new Date(Date.now() - 120000);
  const p1DisconnectedAt = new Date(startedAt.getTime() + 90000);
  const p4KickedAt = new Date(startedAt.getTime() + 60000);

  const session = await Session.create({
    quiz: quiz._id,
    organization: orgAId,
    createdBy: teacherId,
    joinCode: generateJoinCode(),
    status: 'LIVE',
    joinOpen: false,
    gameState: 'QUESTION',
    gameQuestions: [q1.snapshot, q2.snapshot],
    currentQuestionIndex: 1,
    startedAt,
    phaseStartedAt: startedAt,
    phaseEndsAt: new Date(Date.now() + 60000),
    attendanceThreshold: 0.5,
  });

  const p1 = await createParticipant({
    session,
    student: s1,
    section: sectionA,
    name: s1.name,
    nickname: `present-player-${suffix}`,
    score: 2000,
    joinedAt: new Date(startedAt.getTime() - 60000),
    connected: false,
    lastDisconnectedAt: p1DisconnectedAt,
  });
  const p2 = await createParticipant({
    session,
    student: s2,
    section: sectionA,
    name: s2.name,
    nickname: `late-player-${suffix}`,
    score: 1000,
    joinedAt: new Date(startedAt.getTime() + 30000),
    connected: false,
  });
  const p3 = await createParticipant({
    session,
    name: `Phase 7 Guest ${suffix}`,
    nickname: `guest-player-${suffix}`,
    score: 1000,
    joinedAt: new Date(startedAt.getTime() - 30000),
    connected: true,
  });
  const p4 = await createParticipant({
    session,
    student: s3,
    section: sectionB,
    name: s3.name,
    nickname: `kicked-player-${suffix}`,
    score: 1000,
    status: 'KICKED',
    joinedAt: new Date(startedAt.getTime() - 45000),
    connected: false,
    kickedAt: p4KickedAt,
  });
  const p5 = await createParticipant({
    session,
    student: s5,
    section: sectionA,
    name: s5.name,
    nickname: `missing-player-${suffix}`,
    score: 0,
    joinedAt: new Date(startedAt.getTime() - 20000),
    connected: false,
  });

  // A participant whose roster Student record is later deleted must keep the
  // historical student id without becoming a guest.
  await Student.deleteOne({ _id: s5._id });

  await createAnswer({
    session,
    player: p1,
    question: q1,
    isCorrect: true,
    selectedOptionId: q1.correctOptionId,
  });
  await createAnswer({
    session,
    player: p1,
    question: q2,
    isCorrect: true,
    selectedOptionId: q2.correctOptionId,
  });
  await createAnswer({
    session,
    player: p2,
    question: q1,
    isCorrect: true,
    selectedOptionId: q1.correctOptionId,
  });
  await createAnswer({
    session,
    player: p3,
    question: q2,
    isCorrect: false,
    selectedOptionId: q2.wrongOptionId,
  });
  await createAnswer({
    session,
    player: p4,
    question: q1,
    isCorrect: true,
    selectedOptionId: q1.correctOptionId,
  });
  await createAnswer({
    session,
    player: p4,
    question: q2,
    isCorrect: false,
    selectedOptionId: q2.wrongOptionId,
  });

  await SessionCommand.create({
    session: session._id,
    organization: orgAId,
    commandId: `phase7-gift-${suffix}`,
    type: 'GIFT',
    priority: 1,
    actor: p1._id,
    question: q1.questionId,
    questionIndex: 0,
    status: 'COMPLETED',
    startedAt,
    completedAt: new Date(startedAt.getTime() + 1000),
    result: { value: 300 },
  });
  await SessionCommand.create({
    session: session._id,
    organization: orgAId,
    commandId: `phase7-thief-${suffix}`,
    type: 'THIEF',
    priority: 2,
    actor: p2._id,
    target: p1._id,
    question: q2.questionId,
    questionIndex: 1,
    status: 'COMPLETED',
    startedAt,
    completedAt: new Date(startedAt.getTime() + 2000),
    result: { value: -100 },
  });
  await SessionCommand.create({
    session: session._id,
    organization: orgAId,
    commandId: `phase7-rocket-${suffix}`,
    type: 'ROCKET',
    priority: 3,
    actor: p4._id,
    target: p2._id,
    question: q2.questionId,
    questionIndex: 1,
    status: 'CANCELLED',
    startedAt,
    result: {},
  });

  check(
    session.attendanceFinalizedAt === null,
    'attendance is not finalized before the game ends'
  );

  await gameEngine.finishGame(session);
  const finished = await Session.findById(session._id);

  check(finished.status === 'FINISHED', 'Phase 7 fixture session finishes');
  check(
    Boolean(finished.attendanceFinalizedAt),
    'finishing a session finalizes attendance'
  );

  const attendanceDocs = await Attendance.find({ session: session._id });
  check(
    attendanceDocs.length === 6,
    'attendance stores one record per participant and absentee'
  );

  const attendanceByParticipant = new Map(
    attendanceDocs
      .filter((record) => record.participant)
      .map((record) => [record.participant.toString(), record])
  );
  const p1Attendance = attendanceByParticipant.get(p1._id.toString());
  const p2Attendance = attendanceByParticipant.get(p2._id.toString());
  const p3Attendance = attendanceByParticipant.get(p3._id.toString());
  const p4Attendance = attendanceByParticipant.get(p4._id.toString());
  const p5Attendance = attendanceByParticipant.get(p5._id.toString());
  const s4Attendance = attendanceDocs.find(
    (record) =>
      !record.participant &&
      record.student &&
      record.student.toString() === s4._id.toString()
  );

  check(p1Attendance.status === 'PRESENT', 'a full participant is PRESENT');
  check(
    p1Attendance.answeredCount === 2 && p1Attendance.correctCount === 2,
    'attendance uses saved Answer records for counts'
  );
  check(
    p1Attendance.finalRank === 1 && p1Attendance.score === 2000,
    'attendance snapshots final rank and score'
  );
  check(
    p1Attendance.leftAt.getTime() === p1DisconnectedAt.getTime() &&
      p1Attendance.durationMs === 150000,
    'attendance records leave time and duration for disconnected players'
  );
  check(
    p1Attendance.sectionName === sectionA.name,
    'attendance snapshots the section name'
  );
  check(
    p2Attendance.status === 'PRESENT' && p2Attendance.late === true,
    'a late joiner reaching 50% is PRESENT and marked late'
  );
  check(
    p2Attendance.answeredCount === 1,
    'a late joiner only counts answers actually submitted'
  );
  check(
    p3Attendance.guest === true &&
      p3Attendance.student === null &&
      p3Attendance.status === 'PRESENT',
    'a guest participant is tracked without a roster Student'
  );
  check(
    p4Attendance.status === 'KICKED' &&
      p4Attendance.leftAt.getTime() === p4KickedAt.getTime(),
    'kicked participants are recorded separately from absences'
  );
  check(
    p5Attendance.status === 'ABSENT' &&
      p5Attendance.rosterMissing === true &&
      p5Attendance.student.toString() === s5._id.toString(),
    'a participant with a deleted roster record keeps its student id'
  );
  check(
    s4Attendance && s4Attendance.status === 'ABSENT',
    'a roster student who never joined is ABSENT, not PRESENT'
  );
  check(
    s4Attendance.sectionName === sectionB.name,
    'absentees keep their roster section snapshot'
  );

  const attendanceResponse = await request(
    'GET',
    `/sessions/${session._id}/attendance`,
    { token: tokenTeacher }
  );
  const attendanceBody = expectStatus(
    attendanceResponse,
    200,
    'GET /sessions/:id/attendance'
  );
  const attendance = attendanceBody.data.attendance;

  check(attendance.finalized === true, 'finished attendance is finalized');
  check(
    attendance.records.length === 6,
    'attendance endpoint returns every record'
  );
  check(
    attendance.counts.registered === 5,
    'attendance counts registered roster records'
  );
  check(attendance.counts.joined === 5, 'attendance counts joined participants');
  check(attendance.counts.present === 3, 'attendance counts present records');
  check(attendance.counts.absent === 2, 'attendance counts absentees');
  check(
    attendance.counts.kicked === 1,
    'attendance counts kicked participants separately'
  );
  check(attendance.counts.guests === 1, 'attendance counts guest participants');
  check(attendance.counts.late === 1, 'attendance counts late joins');
  check(
    attendance.counts.attendanceRate === 0.4,
    'attendance rate uses the roster denominator'
  );
  check(
    attendance.sections.length === 3,
    'attendance returns section-level summaries'
  );

  const sectionAttendance = await request(
    'GET',
    `/sessions/${session._id}/attendance?section=${sectionA._id}`,
    { token: tokenAssistant }
  );
  const sectionAttendanceBody = expectStatus(
    sectionAttendance,
    200,
    'GET /sessions/:id/attendance?section=...'
  );
  const sectionAttendanceData = sectionAttendanceBody.data.attendance;
  check(
    sectionAttendanceData.records.length === 3,
    'section filter scopes attendance records'
  );
  check(
    sectionAttendanceData.counts.registered === 3 &&
      sectionAttendanceData.counts.present === 2 &&
      sectionAttendanceData.counts.absent === 1,
    'section filter recomputes attendance counts'
  );

  const kickedAttendance = await request(
    'GET',
    `/sessions/${session._id}/attendance?status=KICKED`,
    { token: tokenTeacher }
  );
  const kickedAttendanceBody = expectStatus(
    kickedAttendance,
    200,
    'GET /sessions/:id/attendance?status=KICKED'
  );
  check(
    kickedAttendanceBody.data.attendance.records.length === 1 &&
      kickedAttendanceBody.data.attendance.records[0].participant ===
        p4._id.toString(),
    'status filter returns only kicked participants'
  );

  const invalidSectionFilter = await request(
    'GET',
    `/sessions/${session._id}/attendance?section=not-an-object-id`,
    { token: tokenTeacher }
  );
  expectValidationError(
    invalidSectionFilter,
    'attendance rejects an invalid section filter'
  );

  const invalidStatusFilter = await request(
    'GET',
    `/sessions/${session._id}/attendance?status=UNKNOWN`,
    { token: tokenTeacher }
  );
  expectValidationError(
    invalidStatusFilter,
    'attendance rejects an invalid status filter'
  );

  const reportResponse = await request(
    'GET',
    `/sessions/${session._id}/report`,
    { token: tokenTeacher }
  );
  const reportBody = expectStatus(
    reportResponse,
    200,
    'GET /sessions/:id/report'
  );
  const report = reportBody.data.report;

  check(
    report.session.id === session._id.toString(),
    'report includes the session identity'
  );
  check(
    report.session.quiz.title === quiz.title,
    'report includes the quiz title'
  );
  check(
    report.session.totalQuestions === 2 &&
      report.session.attendanceThreshold === 0.5,
    'report includes question count and attendance threshold'
  );
  check(
    report.attendance.finalized === true,
    'report embeds finalized attendance'
  );
  check(
    report.summary.registeredParticipants === 5,
    'report counts registered participants'
  );
  check(
    report.summary.joinedParticipants === 5,
    'report counts joined participants'
  );
  check(
    report.summary.actualAttendees === 3,
    'report counts actual attendees using the 50% rule'
  );
  check(report.summary.absentees === 2, 'report counts absentees');
  check(report.summary.kicked === 1, 'report counts kicked participants');
  check(report.summary.guests === 1, 'report counts guests');
  check(report.summary.late === 1, 'report counts late joins');
  check(report.summary.totalAnswers === 6, 'report counts saved answers');
  check(report.summary.correctAnswers === 4, 'report counts correct answers');
  check(
    report.summary.incorrectAnswers === 2,
    'report counts incorrect answers'
  );
  check(
    report.summary.accuracy === 0.6667 &&
      report.summary.accuracyPercentage === 66.67,
    'report computes accuracy from Answer records'
  );
  check(report.summary.averageScore === 1000, 'report computes average score');
  check(
    report.summary.averageCorrectAnswers === 0.8,
    'report computes average correct answers per participant'
  );
  check(
    report.summary.averageAccuracy === 0.625 &&
      report.summary.averageAccuracyPercentage === 62.5,
    'report computes average participant accuracy'
  );
  check(
    report.summary.averageResponseTimeMs === 100,
    'report computes average response time'
  );
  check(
    report.summary.gameDurationMs >= 60000,
    'report computes the game duration'
  );
  check(
    report.summary.topPlayers.length === 4 &&
      report.summary.topPlayers[0].participant === p1._id.toString(),
    'report ranks top players and excludes kicked participants'
  );
  check(
    report.summary.topPlayers[0].rank === 1 &&
      report.summary.topPlayers[0].score === 2000,
    'top player entry uses persisted final rank and score'
  );
  check(
    report.summary.hardestQuestion.questionId ===
      q2.questionId.toString() &&
      report.summary.hardestQuestion.accuracyPercentage === 33.33,
    'report identifies the hardest question'
  );

  check(
    report.questionAnalysis.length === 2,
    'report analyses every question'
  );
  const q1Analysis = report.questionAnalysis[0];
  const q2Analysis = report.questionAnalysis[1];
  check(
    q1Analysis.totalAnswers === 3 &&
      q1Analysis.correctAnswers === 3 &&
      q1Analysis.skippedCount === 2,
    'question analysis counts answers and skipped participants'
  );
  check(
    q2Analysis.totalAnswers === 3 &&
      q2Analysis.correctAnswers === 1 &&
      q2Analysis.incorrectAnswers === 2,
    'question analysis counts correct and incorrect answers'
  );
  check(
    q2Analysis.accuracy === 0.3333 &&
      q2Analysis.accuracyPercentage === 33.33,
    'question analysis computes accuracy'
  );
  check(
    q2Analysis.mostCommonWrongOption.optionId ===
      q2.wrongOptionId.toString() &&
      q2Analysis.mostCommonWrongOption.count === 2,
    'question analysis finds the most common wrong answer'
  );
  check(
    q2Analysis.answerDistribution.find(
      (option) => option.optionId === q2.correctOptionId.toString()
    ).count === 1,
    'question analysis returns the full answer distribution'
  );

  const analysisByParticipant = new Map(
    report.studentAnalysis
      .filter((student) => student.participant)
      .map((student) => [student.participant, student])
  );
  const analysisByStudent = new Map(
    report.studentAnalysis
      .filter((student) => student.student)
      .map((student) => [student.student, student])
  );
  const p1Analysis = analysisByParticipant.get(p1._id.toString());
  const p2Analysis = analysisByParticipant.get(p2._id.toString());
  const p3Analysis = analysisByParticipant.get(p3._id.toString());
  const p4Analysis = analysisByParticipant.get(p4._id.toString());
  const p5Analysis = analysisByParticipant.get(p5._id.toString());
  const s4Analysis = analysisByStudent.get(s4._id.toString());

  check(
    p1Analysis.answeredCount === 2 &&
      p1Analysis.correctCount === 2 &&
      p1Analysis.accuracy === 1,
    'student analysis uses saved Answer records'
  );
  check(
    p1Analysis.wrongQuestionCount === 0 &&
      p1Analysis.unansweredCount === 0 &&
      p1Analysis.needsFollowUp === false,
    'student analysis flags no follow-up for a perfect participant'
  );
  check(
    p2Analysis.answeredCount === 1 &&
      p2Analysis.unansweredCount === 1 &&
      p2Analysis.followUpReasons.includes('UNANSWERED_QUESTIONS'),
    'student analysis lists unanswered questions'
  );
  check(
    p3Analysis.accuracy === 0 &&
      p3Analysis.wrongQuestionCount === 1 &&
      p3Analysis.followUpReasons.includes('LOW_ACCURACY'),
    'student analysis lists wrong questions and low accuracy'
  );
  check(
    p4Analysis.status === 'KICKED' &&
      p4Analysis.followUpReasons.includes('KICKED'),
    'student analysis distinguishes kicked participants'
  );
  check(
    p5Analysis.status === 'ABSENT' &&
      p5Analysis.followUpReasons.includes('ABSENT'),
    'student analysis includes absent participants'
  );
  check(
    s4Analysis.status === 'ABSENT' && s4Analysis.answeredCount === 0,
    'student analysis includes roster absentees'
  );

  const sectionASummary = report.attendance.sections.find(
    (section) => section.section === sectionA._id.toString()
  );
  const sectionBSummary = report.attendance.sections.find(
    (section) => section.section === sectionB._id.toString()
  );
  const unassignedSummary = report.attendance.sections.find(
    (section) => section.section === null
  );

  check(
    sectionASummary.registered === 3 &&
      sectionASummary.present === 2 &&
      sectionASummary.absent === 1,
    'section summary counts present and absent roster students'
  );
  check(
    sectionASummary.averageScore === 1000 &&
      sectionASummary.accuracy === 1,
    'section summary computes score and accuracy'
  );
  check(
    sectionBSummary.registered === 2 &&
      sectionBSummary.kicked === 1 &&
      sectionBSummary.absent === 1 &&
      sectionBSummary.accuracy === 0.5,
    'section summary separates kicked participants from absences'
  );
  check(
    unassignedSummary.guests === 1 &&
      unassignedSummary.present === 1 &&
      unassignedSummary.registered === 0,
    'guest participants are grouped outside the roster'
  );

  check(report.commands.total === 3, 'report counts command usage');
  check(
    report.commands.byType.GIFT.total === 1 &&
      report.commands.byType.GIFT.completed === 1,
    'report counts completed Gift commands'
  );
  check(
    report.commands.byType.THIEF.total === 1 &&
      report.commands.byType.THIEF.completed === 1,
    'report counts completed Thief commands'
  );
  check(
    report.commands.byType.ROCKET.total === 1 &&
      report.commands.byType.ROCKET.cancelled === 1,
    'report counts cancelled Rocket commands'
  );
  const giftLog = report.commands.log.find(
    (entry) => entry.type === 'GIFT'
  );
  const thiefLog = report.commands.log.find(
    (entry) => entry.type === 'THIEF'
  );
  check(
    report.commands.log.length === 3 &&
      giftLog.actorId === p1._id.toString() &&
      giftLog.actorName === s1.name &&
      giftLog.value === 300,
    'command log records actor and effect value'
  );
  check(
    thiefLog.targetId === p1._id.toString() &&
      thiefLog.targetName === s1.name,
    'command log records the target'
  );

  const attendanceCountBefore = await Attendance.countDocuments({
    session: session._id,
  });
  await attendanceService.finalizeSessionAttendance(finished, {
    force: true,
  });
  await attendanceService.finalizeSessionAttendance(finished, {
    force: true,
  });
  const attendanceCountAfter = await Attendance.countDocuments({
    session: session._id,
  });
  check(
    attendanceCountAfter === attendanceCountBefore,
    'attendance finalization is idempotent'
  );
  check(
    attendanceCountAfter === 6,
    'repeated finalization does not duplicate attendance records'
  );

  const historySession = await Session.create({
    quiz: quiz._id,
    organization: orgAId,
    createdBy: teacherId,
    joinCode: generateJoinCode(),
    status: 'FINISHED',
    joinOpen: false,
    gameState: 'FINISHED',
    gameQuestions: [q1.snapshot],
    currentQuestionIndex: 0,
    startedAt: new Date(startedAt.getTime() - 1800000),
    endedAt: new Date(startedAt.getTime() - 1700000),
  });
  const historyParticipant = await createParticipant({
    session: historySession,
    student: s1,
    section: sectionA,
    name: s1.name,
    nickname: `history-player-${suffix}`,
    score: 1000,
    joinedAt: new Date(startedAt.getTime() - 1900000),
  });
  await createAnswer({
    session: historySession,
    player: historyParticipant,
    question: q1,
    isCorrect: true,
    selectedOptionId: q1.correctOptionId,
  });
  await attendanceService.finalizeSessionAttendance(historySession);

  const s1History = await request(
    'GET',
    `/students/${s1._id}/history?session=${session._id}`,
    { token: tokenTeacher }
  );
  const s1HistoryBody = expectStatus(
    s1History,
    200,
    'GET /students/:id/history'
  );
  const s1HistoryData = s1HistoryBody.data.history;
  check(
    s1HistoryData.student.id === s1._id.toString(),
    'history returns the requested student'
  );
  check(
    s1HistoryData.pagination.total === 1 &&
      s1HistoryData.history.length === 1,
    'history filters by session'
  );
  check(
    s1HistoryData.history[0].status === 'PRESENT' &&
      s1HistoryData.history[0].score === 2000 &&
      s1HistoryData.history[0].finalRank === 1,
    'history returns attendance and performance for the session'
  );
  check(
    s1HistoryData.history[0].quiz.title === quiz.title &&
      s1HistoryData.history[0].section === sectionA._id.toString(),
    'history returns quiz and historical section snapshots'
  );
  check(
    s1HistoryData.summary.sessions === 1 &&
      s1HistoryData.summary.present === 1 &&
      s1HistoryData.summary.accuracy === 1,
    'history summary reflects the filtered session'
  );

  const s2History = await request(
    'GET',
    `/students/${s2._id}/history?session=${session._id}`,
    { token: tokenTeacher }
  );
  const s2HistoryBody = expectStatus(
    s2History,
    200,
    'GET /students/:id/history late join'
  );
  check(
    s2HistoryBody.data.history.history[0].late === true &&
      s2HistoryBody.data.history.history[0].answeredCount === 1 &&
      s2HistoryBody.data.history.history[0].averageResponseTimeMs === 100,
    'history preserves late-join and response-time data'
  );

  const s4History = await request(
    'GET',
    `/students/${s4._id}/history?session=${session._id}`,
    { token: tokenTeacher }
  );
  const s4HistoryBody = expectStatus(
    s4History,
    200,
    'GET /students/:id/history absentee'
  );
  check(
    s4HistoryBody.data.history.history[0].status === 'ABSENT' &&
      s4HistoryBody.data.history.history[0].answeredCount === 0,
    'history includes absentee sessions'
  );

  const missingStudentHistory = await request(
    'GET',
    `/students/${s5._id}/history`,
    { token: tokenTeacher }
  );
  expectStatus(
    missingStudentHistory,
    404,
    'history for a deleted roster student is not found'
  );

  const quizHistory = await request(
    'GET',
    `/students/${s1._id}/history?quiz=${quiz._id}`,
    { token: tokenTeacher }
  );
  const quizHistoryBody = expectStatus(
    quizHistory,
    200,
    'GET /students/:id/history?quiz=...'
  );
  check(
    quizHistoryBody.data.history.pagination.total === 2,
    'history filters by quiz'
  );

  const absentHistory = await request(
    'GET',
    `/students/${s1._id}/history?session=${session._id}&status=ABSENT`,
    { token: tokenTeacher }
  );
  const absentHistoryBody = expectStatus(
    absentHistory,
    200,
    'GET /students/:id/history?status=ABSENT'
  );
  check(
    absentHistoryBody.data.history.pagination.total === 0,
    'history filters by attendance status'
  );

  const presentHistory = await request(
    'GET',
    `/students/${s1._id}/history?session=${session._id}&status=PRESENT`,
    { token: tokenTeacher }
  );
  const presentHistoryBody = expectStatus(
    presentHistory,
    200,
    'GET /students/:id/history?status=PRESENT'
  );
  check(
    presentHistoryBody.data.history.pagination.total === 1,
    'history status filter includes matching sessions'
  );

  const fromDate = new Date(Date.now() - 3600000).toISOString();
  const toDate = new Date(Date.now() + 3600000).toISOString();
  const dateHistory = await request(
    'GET',
    `/students/${s1._id}/history?from=${encodeURIComponent(
      fromDate
    )}&to=${encodeURIComponent(toDate)}`,
    { token: tokenTeacher }
  );
  const dateHistoryBody = expectStatus(
    dateHistory,
    200,
    'GET /students/:id/history?from=...&to=...'
  );
  check(
    dateHistoryBody.data.history.pagination.total === 2,
    'history filters by session date range'
  );

  const futureFrom = new Date(Date.now() + 3600000).toISOString();
  const futureHistory = await request(
    'GET',
    `/students/${s1._id}/history?from=${encodeURIComponent(futureFrom)}`,
    { token: tokenTeacher }
  );
  const futureHistoryBody = expectStatus(
    futureHistory,
    200,
    'GET /students/:id/history?from=future'
  );
  check(
    futureHistoryBody.data.history.pagination.total === 0,
    'history date filter excludes future sessions'
  );

  const firstPage = await request(
    'GET',
    `/students/${s1._id}/history?limit=1&offset=0`,
    { token: tokenTeacher }
  );
  const firstPageBody = expectStatus(
    firstPage,
    200,
    'GET /students/:id/history pagination'
  );
  check(
    firstPageBody.data.history.pagination.total === 2 &&
      firstPageBody.data.history.history.length === 1 &&
      firstPageBody.data.history.pagination.hasMore === true,
    'history pagination returns the first page'
  );
  check(
    firstPageBody.data.history.summary.sessions === 2 &&
      firstPageBody.data.history.summary.present === 2 &&
      firstPageBody.data.history.summary.averageScore === 1500 &&
      firstPageBody.data.history.summary.totalAnswered === 3 &&
      firstPageBody.data.history.summary.totalCorrect === 3,
    'history summary aggregates every matching session'
  );

  const secondPage = await request(
    'GET',
    `/students/${s1._id}/history?limit=1&offset=1`,
    { token: tokenTeacher }
  );
  const secondPageBody = expectStatus(
    secondPage,
    200,
    'GET /students/:id/history second page'
  );
  check(
    secondPageBody.data.history.history.length === 1 &&
      secondPageBody.data.history.pagination.hasMore === false,
    'history pagination returns the last page'
  );

  const invalidDateFilter = await request(
    'GET',
    `/students/${s1._id}/history?from=not-a-date`,
    { token: tokenTeacher }
  );
  expectValidationError(
    invalidDateFilter,
    'history rejects an invalid date filter'
  );

  const reversedDateFilter = await request(
    'GET',
    `/students/${s1._id}/history?from=${encodeURIComponent(
      toDate
    )}&to=${encodeURIComponent(fromDate)}`,
    { token: tokenTeacher }
  );
  expectValidationError(
    reversedDateFilter,
    'history rejects a reversed date range'
  );

  const invalidHistoryStatus = await request(
    'GET',
    `/students/${s1._id}/history?status=UNKNOWN`,
    { token: tokenTeacher }
  );
  expectValidationError(
    invalidHistoryStatus,
    'history rejects an invalid status filter'
  );

  const invalidHistoryLimit = await request(
    'GET',
    `/students/${s1._id}/history?limit=0`,
    { token: tokenTeacher }
  );
  expectValidationError(
    invalidHistoryLimit,
    'history rejects an invalid limit'
  );

  await Student.updateOne(
    { _id: s1._id },
    { $set: { section: sectionB._id } }
  );
  const movedHistory = await request(
    'GET',
    `/students/${s1._id}/history?session=${session._id}`,
    { token: tokenTeacher }
  );
  const movedHistoryBody = expectStatus(
    movedHistory,
    200,
    'GET /students/:id/history after a section move'
  );
  check(
    movedHistoryBody.data.history.history[0].section ===
      sectionA._id.toString() &&
      movedHistoryBody.data.history.history[0].sectionName === sectionA.name,
    'historical attendance survives a later section change'
  );

  const upgradedParticipant = await createParticipant({
    session,
    student: s4,
    section: sectionB,
    name: s4.name,
    nickname: `upgraded-player-${suffix}`,
    score: 1000,
    joinedAt: new Date(startedAt.getTime() + 45000),
  });
  await createAnswer({
    session,
    player: upgradedParticipant,
    question: q1,
    isCorrect: true,
    selectedOptionId: q1.correctOptionId,
  });
  await attendanceService.finalizeSessionAttendance(finished, {
    force: true,
  });
  const upgradedAttendance = await Attendance.findOne({
    session: session._id,
    student: s4._id,
  });
  check(
    upgradedAttendance.participant.toString() ===
      upgradedParticipant._id.toString(),
    'a later attendee upgrades the absentee record'
  );
  check(
    (await Attendance.countDocuments({
      session: session._id,
      student: s4._id,
    })) === 1,
    'upgrading an absentee does not duplicate attendance'
  );
  check(
    (await Attendance.countDocuments({ session: session._id })) === 6,
    'attendance count stays stable after upgrading an absentee'
  );

  const liveQuiz = await Quiz.create({
    title: `Phase 7 Live Quiz ${suffix}`,
    organization: orgAId,
    createdBy: teacherId,
  });
  const liveQuestion = makeQuestion(0, 'live');
  const liveSession = await Session.create({
    quiz: liveQuiz._id,
    organization: orgAId,
    createdBy: teacherId,
    joinCode: generateJoinCode(),
    status: 'LIVE',
    joinOpen: false,
    gameState: 'QUESTION',
    gameQuestions: [liveQuestion.snapshot],
    currentQuestionIndex: 0,
    startedAt: new Date(Date.now() - 60000),
    phaseStartedAt: new Date(Date.now() - 60000),
    phaseEndsAt: new Date(Date.now() + 60000),
  });
  const liveParticipant = await createParticipant({
    session: liveSession,
    student: s2,
    section: sectionA,
    name: s2.name,
    nickname: `live-player-${suffix}`,
    score: 1000,
    joinedAt: new Date(Date.now() - 30000),
    connected: true,
  });
  await createAnswer({
    session: liveSession,
    player: liveParticipant,
    question: liveQuestion,
    isCorrect: true,
    selectedOptionId: liveQuestion.correctOptionId,
  });

  const liveReport = await request(
    'GET',
    `/sessions/${liveSession._id}/report`,
    { token: tokenTeacher }
  );
  expectStatus(
    liveReport,
    409,
    'live sessions do not expose completed reports'
  );

  const liveAttendance = await request(
    'GET',
    `/sessions/${liveSession._id}/attendance`,
    { token: tokenTeacher }
  );
  const liveAttendanceBody = expectStatus(
    liveAttendance,
    200,
    'GET live session attendance'
  );
  const liveAttendanceData = liveAttendanceBody.data.attendance;
  const liveRecord = liveAttendanceData.records.find(
    (record) => record.participant === liveParticipant._id.toString()
  );
  check(
    liveAttendanceData.finalized === false &&
      liveRecord.status === 'PENDING',
    'live attendance is marked PENDING and not finalized'
  );
  check(
    liveAttendanceData.counts.pending > 0 &&
      liveAttendanceData.counts.present === 0 &&
      liveAttendanceData.counts.absent === 0,
    'live attendance does not finalize present or absent counts'
  );

  const pausedSession = await Session.create({
    quiz: liveQuiz._id,
    organization: orgAId,
    createdBy: teacherId,
    joinCode: generateJoinCode(),
    status: 'PAUSED',
    joinOpen: false,
    gameState: 'QUESTION',
    gameQuestions: [liveQuestion.snapshot],
    currentQuestionIndex: 0,
    startedAt: new Date(Date.now() - 60000),
    pausedAt: new Date(),
  });

  const pausedReport = await request(
    'GET',
    `/sessions/${pausedSession._id}/report`,
    { token: tokenTeacher }
  );
  expectStatus(
    pausedReport,
    409,
    'paused sessions do not expose completed reports'
  );

  const pausedAttendance = await request(
    'GET',
    `/sessions/${pausedSession._id}/attendance`,
    { token: tokenTeacher }
  );
  const pausedAttendanceBody = expectStatus(
    pausedAttendance,
    200,
    'GET paused session attendance'
  );
  check(
    pausedAttendanceBody.data.attendance.finalized === false,
    'paused session attendance remains live'
  );

  await Student.deleteMany({ organization: orgBId });

  const orgBSection = await Section.create({
    name: `Phase 7 Org B Section ${suffix}`,
    organization: orgBId,
    createdBy: ownerBId,
  });
  const orgBStudent = await Student.create({
    name: `Phase 7 Org B Student ${suffix}`,
    nickname: `orgb-student-${suffix}`,
    organization: orgBId,
    section: orgBSection._id,
  });
  const orgBQuiz = await Quiz.create({
    title: `Phase 7 Org B Quiz ${suffix}`,
    organization: orgBId,
    createdBy: ownerBId,
  });
  const orgBSession = await Session.create({
    quiz: orgBQuiz._id,
    organization: orgBId,
    createdBy: ownerBId,
    joinCode: generateJoinCode(),
    status: 'FINISHED',
    joinOpen: false,
    gameState: 'FINISHED',
    gameQuestions: [],
    currentQuestionIndex: -1,
    startedAt: new Date(Date.now() - 60000),
    endedAt: new Date(Date.now() - 30000),
  });

  const crossOrgReport = await request(
    'GET',
    `/sessions/${session._id}/report`,
    { token: tokenB }
  );
  expectStatus(crossOrgReport, 404, 'org B cannot read an org A report');

  const crossOrgAttendance = await request(
    'GET',
    `/sessions/${session._id}/attendance`,
    { token: tokenB }
  );
  expectStatus(
    crossOrgAttendance,
    404,
    'org B cannot read org A attendance'
  );

  const crossOrgHistory = await request(
    'GET',
    `/students/${s1._id}/history`,
    { token: tokenB }
  );
  expectStatus(
    crossOrgHistory,
    404,
    'org B cannot read an org A student history'
  );

  const crossOrgSessionFilter = await request(
    'GET',
    `/students/${s1._id}/history?session=${orgBSession._id}`,
    { token: tokenA }
  );
  expectStatus(
    crossOrgSessionFilter,
    404,
    'history rejects a session from another organization'
  );

  const crossOrgQuizFilter = await request(
    'GET',
    `/students/${s1._id}/history?quiz=${orgBQuiz._id}`,
    { token: tokenA }
  );
  expectStatus(
    crossOrgQuizFilter,
    404,
    'history rejects a quiz from another organization'
  );

  const orgBReport = await request(
    'GET',
    `/sessions/${orgBSession._id}/report`,
    { token: tokenB }
  );
  const orgBReportBody = expectStatus(
    orgBReport,
    200,
    'org B can read its own report'
  );
  check(
    orgBReportBody.data.report.attendance.finalized === true &&
      orgBReportBody.data.report.summary.absentees === 1,
    'org B report finalizes its own absentee roster'
  );

  const orgBAttendance = await request(
    'GET',
    `/sessions/${orgBSession._id}/attendance`,
    { token: tokenB }
  );
  expectStatus(orgBAttendance, 200, 'org B can read its own attendance');

  const orgBHistory = await request(
    'GET',
    `/students/${orgBStudent._id}/history`,
    { token: tokenB }
  );
  expectStatus(orgBHistory, 200, 'org B can read its own student history');

  const ownerReport = await request(
    'GET',
    `/sessions/${session._id}/report`,
    { token: tokenA }
  );
  expectStatus(ownerReport, 200, 'OWNER can read reports');

  const assistantReport = await request(
    'GET',
    `/sessions/${session._id}/report`,
    { token: tokenAssistant }
  );
  expectStatus(assistantReport, 200, 'ASSISTANT can read reports');

  const adminReport = await request(
    'GET',
    `/sessions/${session._id}/report`,
    { token: tokenAdmin }
  );
  expectStatus(adminReport, 403, 'ADMIN cannot read organization reports');

  const adminAttendance = await request(
    'GET',
    `/sessions/${session._id}/attendance`,
    { token: tokenAdmin }
  );
  expectStatus(
    adminAttendance,
    403,
    'ADMIN cannot read organization attendance'
  );

  const adminHistory = await request(
    'GET',
    `/students/${s1._id}/history`,
    { token: tokenAdmin }
  );
  expectStatus(
    adminHistory,
    403,
    'ADMIN cannot read organization student history'
  );

  const invalidReportId = await request(
    'GET',
    '/sessions/not-an-object-id/report',
    { token: tokenTeacher }
  );
  expectStatus(invalidReportId, 400, 'GET report invalid session id');

  const missingReport = await request(
    'GET',
    '/sessions/64b000000000000000000000/report',
    { token: tokenTeacher }
  );
  expectStatus(missingReport, 404, 'GET report missing session');

  const invalidAttendanceId = await request(
    'GET',
    '/sessions/not-an-object-id/attendance',
    { token: tokenTeacher }
  );
  expectStatus(
    invalidAttendanceId,
    400,
    'GET attendance invalid session id'
  );

  const missingAttendance = await request(
    'GET',
    '/sessions/64b000000000000000000000/attendance',
    { token: tokenTeacher }
  );
  expectStatus(missingAttendance, 404, 'GET attendance missing session');

  const invalidHistoryId = await request(
    'GET',
    '/students/not-an-object-id/history',
    { token: tokenTeacher }
  );
  expectStatus(invalidHistoryId, 400, 'GET history invalid student id');

  const missingHistory = await request(
    'GET',
    '/students/64b000000000000000000000/history',
    { token: tokenTeacher }
  );
  expectStatus(missingHistory, 404, 'GET history missing student');
}

async function runPhase8Tests({
  suffix,
  tokenA,
  tokenB,
  tokenTeacher,
  tokenAssistant,
  tokenAdmin,
  orgAId,
  orgBId,
  teacherId,
}) {
  console.log('\nPhase 8 Excel export smoke tests\n');

  const SHEET_NAMES = [
    'Session Summary',
    'Attendance',
    'Student Results',
    'Question Analysis',
    'Commands',
  ];

  const EXPECTED_HEADERS = {
    'Session Summary': ['Field', 'Value'],
    Attendance: [
      'Student Name',
      'Nickname',
      'Section',
      'Attendance Status',
      'Join Time',
      'Leave Time',
      'Participation Duration',
      'Answered Questions',
      'Correct Answers',
      'Attendance Percentage',
    ],
    'Student Results': [
      'Student Name',
      'Nickname',
      'Section',
      'Total Score',
      'Final Rank',
      'Correct Answers',
      'Incorrect Answers',
      'Accuracy Percentage',
      'Average Response Time (ms)',
      'Best Streak',
    ],
    'Question Analysis': [
      'Question Order',
      'Question Text',
      'Total Answers',
      'Correct Answers',
      'Incorrect Answers',
      'Correct Answer Percentage',
      'Average Response Time (ms)',
    ],
    Commands: [
      'Command Type',
      'Actor',
      'Target',
      'Value / Effect',
      'Question',
      'Timestamp',
    ],
  };

  function readHeaders(worksheet) {
    return worksheet
      .getRow(1)
      .values.slice(1)
      .map((value) => (value == null ? '' : String(value)));
  }

  function readRows(worksheet) {
    const rows = [];

    worksheet.eachRow((row, rowNumber) => {
      if (rowNumber === 1) {
        return;
      }

      rows.push(row.values.slice(1));
    });

    return rows;
  }

  function cellText(value) {
    return value == null ? '' : String(value);
  }

  async function loadWorkbook(sessionId, token, label) {
    const response = await requestBuffer(
      'GET',
      `/sessions/${sessionId}/report/export`,
      { token }
    );

    assert.equal(
      response.status,
      200,
      `${label}: expected 200, got ${response.status} -> ${response.body}`
    );

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(response.buffer);

    return { response, workbook };
  }

  function assertWorkbookStructure(workbook, label) {
    check(
      workbook.worksheets.length === 5,
      `${label}: workbook contains exactly five worksheets`
    );
    check(
      JSON.stringify(workbook.worksheets.map((sheet) => sheet.name)) ===
        JSON.stringify(SHEET_NAMES),
      `${label}: worksheets are named and ordered as specified`
    );

    for (const name of SHEET_NAMES) {
      const worksheet = workbook.getWorksheet(name);
      check(Boolean(worksheet), `${label}: worksheet "${name}" exists`);
      check(
        JSON.stringify(readHeaders(worksheet)) ===
          JSON.stringify(EXPECTED_HEADERS[name]),
        `${label}: worksheet "${name}" has the expected headers`
      );
      check(
        worksheet.views.some(
          (view) => view.state === 'frozen' && view.ySplit === 1
        ),
        `${label}: worksheet "${name}" freezes the header row`
      );

      if (name !== 'Session Summary') {
        check(
          Boolean(worksheet.autoFilter),
          `${label}: worksheet "${name}" enables filtering`
        );
      }
    }
  }

  function assertNoFormulaCells(worksheet, label) {
    let formulaCells = 0;

    worksheet.eachRow((row) => {
      row.eachCell((cell) => {
        if (cell.formula || cell.type === ExcelJS.ValueType.Formula) {
          formulaCells += 1;
        }
      });
    });

    check(formulaCells === 0, `${label}: no spreadsheet formula cells exist`);
  }

  function makeQuestion(index, text) {
    const questionId = new mongoose.Types.ObjectId();
    const correctOptionId = new mongoose.Types.ObjectId();
    const wrongOptionId = new mongoose.Types.ObjectId();

    return {
      questionId,
      correctOptionId,
      wrongOptionId,
      snapshot: {
        question: questionId,
        text,
        points: 1000,
        timeLimitSec: 10,
        order: index,
        explanation: null,
        options: [
          { optionId: correctOptionId, text: 'Correct', isCorrect: true },
          { optionId: wrongOptionId, text: 'Wrong', isCorrect: false },
        ],
      },
    };
  }

  async function createParticipant({
    session,
    student = null,
    section = null,
    name,
    nickname,
    score = 0,
    bestStreak = 0,
    status = 'ACTIVE',
    joinedAt = new Date(),
    connected = false,
  }) {
    return SessionPlayer.create({
      session: session._id,
      organization: session.organization,
      student: student ? student._id : null,
      section: section ? section._id : null,
      name,
      nickname,
      nicknameKey: nickname.toLowerCase(),
      tokenHash: hashParticipantToken(
        `phase8-${nickname}-${suffix}-${Math.random()}`
      ),
      status,
      score,
      bestStreak,
      connected,
      joinedAt,
      lastSeenAt: new Date(),
    });
  }

  async function createAnswer({
    session,
    player,
    question,
    isCorrect,
    selectedOptionId,
    responseTimeMs = 100,
    pointsAwarded = 1000,
  }) {
    return Answer.create({
      session: session._id,
      organization: session.organization,
      sessionPlayer: player._id,
      question: question.questionId,
      selectedOptionId,
      isCorrect,
      responseTimeMs,
      pointsAwarded,
      basePointsAwarded: pointsAwarded,
      applied: true,
    });
  }

  const orgResponse = await request('GET', '/organization', { token: tokenA });
  const orgBody = expectStatus(orgResponse, 200, 'GET /organization for export');
  const orgName = orgBody.data.organization.name;
  const teacherMe = await request('GET', '/auth/me', { token: tokenTeacher });
  const teacherMeBody = expectStatus(teacherMe, 200, 'GET /auth/me for export');
  const teacherName = teacherMeBody.data.user.name;

  // Deterministic roster for the export fixture.
  await Student.deleteMany({ organization: orgAId });

  const sectionA = await Section.create({
    name: `Phase 8 Section A ${suffix}`,
    organization: orgAId,
    createdBy: teacherId,
  });
  const sectionB = await Section.create({
    name: `Phase 8 Section B ${suffix}`,
    organization: orgAId,
    createdBy: teacherId,
  });

  const presentStudent = await Student.create({
    name: `طالب حاضر ${suffix}`,
    nickname: `present-${suffix}`,
    organization: orgAId,
    section: sectionA._id,
  });
  const absentStudent = await Student.create({
    name: `Phase 8 Absent ${suffix}`,
    nickname: `absent-${suffix}`,
    organization: orgAId,
    section: sectionB._id,
  });
  const kickedStudent = await Student.create({
    name: `Phase 8 Kicked ${suffix}`,
    nickname: `kicked-${suffix}`,
    organization: orgAId,
    section: sectionB._id,
  });
  const missingStudent = await Student.create({
    name: `Phase 8 Missing ${suffix}`,
    nickname: `missing-${suffix}`,
    organization: orgAId,
    section: sectionA._id,
  });

  const formulaQuizTitle = `=HYPERLINK("http://evil.example","click") ${suffix}`;
  const quiz = await Quiz.create({
    title: formulaQuizTitle,
    description: 'Phase 8 Excel export fixture',
    organization: orgAId,
    createdBy: teacherId,
  });

  const arabicQuestionText = `ما هو ناتج ٢ + ٢؟ ${suffix}`;
  const formulaQuestionText = `=SUM(A1:A2) ${suffix}`;
  const q1 = makeQuestion(0, arabicQuestionText);
  const q2 = makeQuestion(1, formulaQuestionText);
  const startedAt = new Date(Date.now() - 120000);

  const session = await Session.create({
    quiz: quiz._id,
    organization: orgAId,
    createdBy: teacherId,
    joinCode: generateJoinCode(),
    status: 'LIVE',
    joinOpen: false,
    gameState: 'QUESTION',
    gameQuestions: [q1.snapshot, q2.snapshot],
    currentQuestionIndex: 1,
    startedAt,
    phaseStartedAt: startedAt,
    phaseEndsAt: new Date(Date.now() + 60000),
    attendanceThreshold: 0.5,
  });

  const presentPlayer = await createParticipant({
    session,
    student: presentStudent,
    section: sectionA,
    name: presentStudent.name,
    nickname: `present-player-${suffix}`,
    score: 2000,
    bestStreak: 2,
    joinedAt: new Date(startedAt.getTime() - 60000),
  });
  const kickedPlayer = await createParticipant({
    session,
    student: kickedStudent,
    section: sectionB,
    name: kickedStudent.name,
    nickname: `kicked-player-${suffix}`,
    score: 500,
    bestStreak: 1,
    status: 'KICKED',
    joinedAt: new Date(startedAt.getTime() - 45000),
  });
  const guestName = `Phase 8 Guest ${suffix}`;
  const guestNickname = `=1+1 ${suffix}`;
  const guestPlayer = await createParticipant({
    session,
    name: guestName,
    nickname: guestNickname,
    score: 300,
    bestStreak: 0,
    joinedAt: new Date(startedAt.getTime() - 30000),
    connected: true,
  });
  const missingPlayer = await createParticipant({
    session,
    student: missingStudent,
    section: sectionA,
    name: missingStudent.name,
    nickname: `missing-player-${suffix}`,
    score: 0,
    joinedAt: new Date(startedAt.getTime() - 20000),
  });

  // A participant whose roster record is deleted must keep the historical id
  // and be flagged as rosterMissing in the export.
  await Student.deleteOne({ _id: missingStudent._id });

  await createAnswer({
    session,
    player: presentPlayer,
    question: q1,
    isCorrect: true,
    selectedOptionId: q1.correctOptionId,
    responseTimeMs: 100,
  });
  await createAnswer({
    session,
    player: presentPlayer,
    question: q2,
    isCorrect: true,
    selectedOptionId: q2.correctOptionId,
    responseTimeMs: 300,
  });
  await createAnswer({
    session,
    player: kickedPlayer,
    question: q1,
    isCorrect: true,
    selectedOptionId: q1.correctOptionId,
    responseTimeMs: 200,
  });
  await createAnswer({
    session,
    player: guestPlayer,
    question: q2,
    isCorrect: false,
    selectedOptionId: q2.wrongOptionId,
    responseTimeMs: 400,
  });

  await SessionCommand.create({
    session: session._id,
    organization: orgAId,
    commandId: `phase8-gift-${suffix}`,
    type: 'GIFT',
    priority: 1,
    actor: presentPlayer._id,
    question: q1.questionId,
    questionIndex: 0,
    status: 'COMPLETED',
    startedAt,
    completedAt: new Date(startedAt.getTime() + 1000),
    result: { value: 300 },
  });
  await SessionCommand.create({
    session: session._id,
    organization: orgAId,
    commandId: `phase8-thief-${suffix}`,
    type: 'THIEF',
    priority: 2,
    actor: guestPlayer._id,
    target: presentPlayer._id,
    question: q2.questionId,
    questionIndex: 1,
    status: 'COMPLETED',
    startedAt,
    completedAt: new Date(startedAt.getTime() + 2000),
    result: { value: -100 },
  });
  await SessionCommand.create({
    session: session._id,
    organization: orgAId,
    commandId: `phase8-rocket-${suffix}`,
    type: 'ROCKET',
    priority: 3,
    actor: kickedPlayer._id,
    target: presentPlayer._id,
    question: q2.questionId,
    questionIndex: 1,
    status: 'CANCELLED',
    startedAt,
    result: {},
  });

  await gameEngine.finishGame(session);

  const { response: exportResponse, workbook } = await loadWorkbook(
    session._id,
    tokenTeacher,
    'export'
  );

  check(
    exportResponse.buffer[0] === 0x50 && exportResponse.buffer[1] === 0x4b,
    'export returns a valid XLSX (ZIP) payload'
  );
  check(
    exportResponse.headers
      .get('content-type')
      .includes(
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      ),
    'export returns the XLSX content type'
  );
  check(
    (exportResponse.headers.get('content-disposition') || '').startsWith(
      'attachment; filename="'
    ),
    'export returns an attachment content disposition'
  );
  check(
    exportResponse.headers.get('content-length') ===
      String(exportResponse.buffer.length),
    'export reports the correct content length'
  );

  const disposition = exportResponse.headers.get('content-disposition') || '';
  const filename = disposition.match(/filename="([^"]+)"/)?.[1] || '';
  check(
    /^yalla-class-report-[A-Z0-9]+-\d{8}-\d{6}\.xlsx$/.test(filename),
    'export uses a safe generated filename'
  );

  assertWorkbookStructure(workbook, 'main export');

  for (const name of SHEET_NAMES) {
    assertNoFormulaCells(workbook.getWorksheet(name), `main export ${name}`);
  }

  const summarySheet = workbook.getWorksheet('Session Summary');
  const summaryRows = readRows(summarySheet);
  const summaryMap = new Map(
    summaryRows.map((row) => [cellText(row[0]), row[1]])
  );

  check(
    summaryMap.get('Organization Name') === orgName,
    'summary exports the organization name'
  );
  check(
    summaryMap.get('Quiz Title') === `'${formulaQuizTitle}`,
    'summary sanitizes a formula-like quiz title'
  );
  check(
    summaryMap.get('Teacher Name') === teacherName,
    'summary exports the teacher name'
  );
  check(
    summaryMap.get('Session Date') instanceof Date,
    'summary exports a formatted session date'
  );
  check(
    summaryMap.get('Total Questions') === 2,
    'summary exports the total question count'
  );
  check(
    summaryMap.get('Total Registered Participants') === 4,
    'summary exports the registered participant count'
  );
  check(
    summaryMap.get('Actual Attendees') === 2,
    'summary exports actual attendees'
  );
  check(
    summaryMap.get('Absentees') === 2,
    'summary exports absentees'
  );
  check(
    summaryMap.get('Kicked Participants') === 1,
    'summary exports kicked participants'
  );
  check(
    summaryMap.get('Average Accuracy (%)') === 66.67,
    'summary exports average accuracy'
  );
  check(
    summaryMap.get('Average Response Time (ms)') === 250,
    'summary exports average response time'
  );
  check(
    typeof summaryMap.get('Session Duration') === 'string' &&
      /^\d{2}:\d{2}:\d{2}$/.test(summaryMap.get('Session Duration')),
    'summary exports the session duration'
  );

  const attendanceSheet = workbook.getWorksheet('Attendance');
  const attendanceRows = readRows(attendanceSheet);
  check(
    attendanceRows.length === 5,
    'attendance sheet contains every attendance record'
  );

  const attendanceByNickname = new Map(
    attendanceRows.map((row) => [cellText(row[1]), row])
  );
  const presentAttendanceRow = attendanceByNickname.get(
    `present-player-${suffix}`
  );
  check(
    cellText(presentAttendanceRow[0]) === presentStudent.name,
    'attendance sheet preserves Arabic student names'
  );
  check(
    cellText(presentAttendanceRow[2]) === sectionA.name,
    'attendance sheet exports the section name'
  );
  check(
    cellText(presentAttendanceRow[3]) === 'PRESENT',
    'attendance sheet exports the attendance status'
  );
  check(
    presentAttendanceRow[4] instanceof Date &&
      presentAttendanceRow[5] instanceof Date,
    'attendance sheet exports join and leave times as dates'
  );
  check(
    /^\d{2}:\d{2}:\d{2}$/.test(cellText(presentAttendanceRow[6])),
    'attendance sheet exports a readable participation duration'
  );
  check(
    presentAttendanceRow[7] === 2 &&
      presentAttendanceRow[8] === 2 &&
      presentAttendanceRow[9] === 100,
    'attendance sheet exports answered, correct, and attendance percentage'
  );

  const guestAttendanceRow = attendanceByNickname.get(
    `'${guestNickname}`
  );
  check(
    Boolean(guestAttendanceRow) &&
      cellText(guestAttendanceRow[0]) === guestName &&
      cellText(guestAttendanceRow[3]) === 'PRESENT',
    'attendance sheet includes guest participants'
  );
  check(
    cellText(guestAttendanceRow[2]) === '',
    'guest participants export an empty section'
  );
  check(
    cellText(guestAttendanceRow[1]) === `'${guestNickname}`,
    'attendance sheet sanitizes formula-like nicknames'
  );

  const missingAttendanceRow = attendanceByNickname.get(
    `missing-player-${suffix}`
  );
  check(
    Boolean(missingAttendanceRow) &&
      cellText(missingAttendanceRow[3]) === 'ABSENT',
    'attendance sheet includes participants with a missing roster record'
  );

  const absentAttendanceRow = attendanceRows.find(
    (row) => cellText(row[0]) === absentStudent.name
  );
  check(
    Boolean(absentAttendanceRow) &&
      cellText(absentAttendanceRow[3]) === 'ABSENT' &&
      cellText(absentAttendanceRow[2]) === sectionB.name,
    'attendance sheet includes roster absentees with their section snapshot'
  );

  const resultsSheet = workbook.getWorksheet('Student Results');
  const resultsRows = readRows(resultsSheet);
  check(
    resultsRows.length === 5,
    'student results sheet contains every student record'
  );

  const resultsByNickname = new Map(
    resultsRows.map((row) => [cellText(row[1]), row])
  );
  const presentResultRow = resultsByNickname.get(`present-player-${suffix}`);
  check(
    presentResultRow[3] === 2000 &&
      presentResultRow[4] === 1 &&
      presentResultRow[5] === 2 &&
      presentResultRow[6] === 0,
    'student results sheet exports score, rank, and answer counts'
  );
  check(
    presentResultRow[7] === 100 &&
      presentResultRow[8] === 200 &&
      presentResultRow[9] === 2,
    'student results sheet exports accuracy, response time, and best streak'
  );

  const questionSheet = workbook.getWorksheet('Question Analysis');
  const questionRows = readRows(questionSheet);
  check(
    questionRows.length === 2,
    'question analysis sheet contains every question'
  );
  check(
    cellText(questionRows[0][1]) === arabicQuestionText,
    'question analysis sheet preserves Arabic question text'
  );
  check(
    cellText(questionRows[1][1]) === `'${formulaQuestionText}`,
    'question analysis sheet sanitizes formula-like question text'
  );
  check(
    questionRows[0][0] === 1 &&
      questionRows[0][2] === 2 &&
      questionRows[0][3] === 2 &&
      questionRows[0][4] === 0 &&
      questionRows[0][5] === 100,
    'question analysis sheet exports answer counts and percentages'
  );

  const commandsSheet = workbook.getWorksheet('Commands');
  const commandRows = readRows(commandsSheet);
  check(commandRows.length === 3, 'commands sheet exports every command');
  check(
    JSON.stringify(commandRows.map((row) => cellText(row[0]))) ===
      JSON.stringify(['GIFT', 'THIEF', 'ROCKET']),
    'commands sheet exports command types in order'
  );
  check(
    commandRows[0][1] === presentStudent.name &&
      commandRows[1][1] === guestName &&
      commandRows[1][2] === presentStudent.name,
    'commands sheet resolves actor and target names'
  );
  check(
    commandRows[0][3] === 300 &&
      commandRows[1][3] === -100 &&
      commandRows[0][4] === 'Q1' &&
      commandRows[1][4] === 'Q2',
    'commands sheet exports values and question context'
  );
  check(
    commandRows[0][5] instanceof Date,
    'commands sheet exports command timestamps as dates'
  );

  // The workbook must agree with the JSON report, which remains the source of
  // truth for every calculation.
  const reportResponse = await request(
    'GET',
    `/sessions/${session._id}/report`,
    { token: tokenTeacher }
  );
  const reportBody = expectStatus(
    reportResponse,
    200,
    'GET /sessions/:id/report for export consistency'
  );
  const report = reportBody.data.report;

  check(
    report.summary.registeredParticipants === 4 &&
      report.summary.actualAttendees === 2 &&
      report.summary.absentees === 2 &&
      report.summary.kicked === 1 &&
      report.summary.guests === 1,
    'JSON report matches the exported summary counts'
  );
  check(
    attendanceRows.length === report.studentAnalysis.length,
    'attendance sheet row count matches the JSON report'
  );
  check(
    resultsRows.length === report.studentAnalysis.length,
    'student results row count matches the JSON report'
  );
  check(
    questionRows.length === report.questionAnalysis.length,
    'question analysis row count matches the JSON report'
  );
  check(
    commandRows.length === report.commands.log.length,
    'commands row count matches the JSON report'
  );

  const reportPresent = report.studentAnalysis.find(
    (record) => record.participant === presentPlayer._id.toString()
  );
  check(
    presentResultRow[3] === reportPresent.score &&
      presentResultRow[4] === reportPresent.finalRank &&
      presentResultRow[5] === reportPresent.correctCount &&
      presentResultRow[6] === reportPresent.incorrectCount &&
      presentResultRow[7] === reportPresent.accuracyPercentage &&
      presentResultRow[9] === reportPresent.bestStreak,
    'student results sheet matches the JSON student analysis'
  );
  check(
    questionRows[0][2] === report.questionAnalysis[0].totalAnswers &&
      questionRows[0][3] === report.questionAnalysis[0].correctAnswers &&
      questionRows[0][5] === report.questionAnalysis[0].accuracyPercentage,
    'question analysis sheet matches the JSON report'
  );

  const ownerExport = await requestBuffer(
    'GET',
    `/sessions/${session._id}/report/export`,
    { token: tokenA }
  );
  check(ownerExport.status === 200, 'OWNER can export a session report');

  const assistantExport = await loadWorkbook(
    session._id,
    tokenAssistant,
    'assistant export'
  );
  check(
    assistantExport.workbook.worksheets.length === 5,
    'ASSISTANT can export a session report'
  );

  const adminExport = await requestBuffer(
    'GET',
    `/sessions/${session._id}/report/export`,
    { token: tokenAdmin }
  );
  check(
    adminExport.status === 403,
    'ADMIN cannot export organization reports'
  );

  const crossOrgExport = await requestBuffer(
    'GET',
    `/sessions/${session._id}/report/export`,
    { token: tokenB }
  );
  check(
    crossOrgExport.status === 404,
    'cross-organization export returns 404'
  );

  const invalidExportId = await request(
    'GET',
    '/sessions/not-an-object-id/report/export',
    { token: tokenTeacher }
  );
  expectStatus(invalidExportId, 400, 'export rejects an invalid session id');

  const missingExport = await request(
    'GET',
    '/sessions/64b000000000000000000000/report/export',
    { token: tokenTeacher }
  );
  expectStatus(missingExport, 404, 'export returns 404 for a missing session');

  const unfinishedSession = await Session.create({
    quiz: quiz._id,
    organization: orgAId,
    createdBy: teacherId,
    joinCode: generateJoinCode(),
    status: 'LOBBY',
    joinOpen: true,
    gameState: 'IDLE',
    gameQuestions: [q1.snapshot, q2.snapshot],
    currentQuestionIndex: -1,
    startedAt: null,
  });

  const unfinishedExport = await request(
    'GET',
    `/sessions/${unfinishedSession._id}/report/export`,
    { token: tokenTeacher }
  );
  expectStatus(
    unfinishedExport,
    409,
    'export is blocked for a non-finished session'
  );

  // Empty sheets still need their headers. Remove the roster and create a
  // finished session with no questions, answers, participants, or commands.
  await Student.deleteMany({ organization: orgAId });

  const emptyQuiz = await Quiz.create({
    title: `Phase 8 Empty Quiz ${suffix}`,
    description: 'Empty export fixture',
    organization: orgAId,
    createdBy: teacherId,
  });
  const emptyStartedAt = new Date(Date.now() - 60000);
  const emptySession = await Session.create({
    quiz: emptyQuiz._id,
    organization: orgAId,
    createdBy: teacherId,
    joinCode: generateJoinCode(),
    status: 'LIVE',
    joinOpen: false,
    gameState: 'QUESTION',
    gameQuestions: [],
    currentQuestionIndex: -1,
    startedAt: emptyStartedAt,
    phaseStartedAt: emptyStartedAt,
    phaseEndsAt: new Date(Date.now() + 60000),
  });

  await gameEngine.finishGame(emptySession);

  const { workbook: emptyWorkbook } = await loadWorkbook(
    emptySession._id,
    tokenTeacher,
    'empty export'
  );

  assertWorkbookStructure(emptyWorkbook, 'empty export');

  for (const name of [
    'Attendance',
    'Student Results',
    'Question Analysis',
    'Commands',
  ]) {
    const worksheet = emptyWorkbook.getWorksheet(name);
    check(
      worksheet.actualRowCount === 1,
      `empty export: "${name}" keeps only its header row`
    );
  }

  const emptySummarySheet = emptyWorkbook.getWorksheet('Session Summary');
  check(
    readRows(emptySummarySheet).length >= 12,
    'empty export: session summary still contains its metadata'
  );
}

async function runPhase9E2ETests({ suffix }) {
  console.log('\nPhase 9 full product end-to-end journey\n');

  const cliAdminEmail = `phase9.admin.${suffix}@example.com`;
  const cliAdminPassword = 'Phase9Admin123!';
  const ownerEmail = `phase9.owner.${suffix}@example.com`;
  const teacherEmail = `phase9.teacher.${suffix}@example.com`;
  const assistantEmail = `phase9.assistant.${suffix}@example.com`;
  const ownerPassword = 'OwnerPass123!';
  const memberPassword = 'MemberPass123!';

  // 1. Provision the SUPER ADMIN through the real CLI script.
  const cli = await execFileAsync(
    process.execPath,
    [
      path.join(PROJECT_ROOT, 'scripts', 'create-admin.js'),
      '--name',
      'Phase 9 Super Admin',
      '--email',
      cliAdminEmail,
      '--password',
      cliAdminPassword,
    ],
    {
      cwd: PROJECT_ROOT,
      env: {
        ...process.env,
        MONGODB_URI: TEST_MONGODB_URI,
        NODE_ENV: 'test',
      },
    }
  );

  check(
    cli.stdout.includes('SUPER ADMIN'),
    'CLI provisioning creates a SUPER ADMIN account'
  );

  // 2. SUPER ADMIN logs in.
  const adminLogin = await request('POST', '/auth/login', {
    body: { email: cliAdminEmail, password: cliAdminPassword },
  });
  const adminLoginBody = expectStatus(
    adminLogin,
    200,
    'Phase 9 SUPER ADMIN login'
  );
  const tokenAdmin9 = adminLoginBody.data.token;

  check(
    adminLoginBody.data.user.role === 'ADMIN',
    'CLI-provisioned account has the ADMIN role'
  );
  check(
    !('passwordHash' in adminLoginBody.data.user),
    'login responses do not leak password hashes'
  );

  // 3. SUPER ADMIN creates an organization and its OWNER.
  const orgName = `Phase 9 Org ${suffix}`;
  const createOrg = await request('POST', '/admin/organizations', {
    token: tokenAdmin9,
    body: {
      name: orgName,
      owner: {
        name: 'Phase 9 Owner',
        email: ownerEmail,
        password: ownerPassword,
      },
    },
  });
  const createOrgBody = expectStatus(
    createOrg,
    201,
    'Phase 9 admin creates an organization and OWNER'
  );
  const orgId = createOrgBody.data.organization.id;
  const ownerId = createOrgBody.data.owner.id;

  check(
    createOrgBody.data.owner.role === 'OWNER',
    'organization provisioning creates an OWNER account'
  );
  check(
    createOrgBody.data.organization.owner.id === ownerId,
    'the organization is linked to its OWNER'
  );

  // 4. OWNER logs in.
  const ownerLogin = await request('POST', '/auth/login', {
    body: { email: ownerEmail, password: ownerPassword },
  });
  const ownerLoginBody = expectStatus(ownerLogin, 200, 'Phase 9 OWNER login');
  const tokenOwner9 = ownerLoginBody.data.token;

  check(
    ownerLoginBody.data.user.role === 'OWNER',
    'OWNER login returns the OWNER role'
  );

  // 5. OWNER creates TEACHER and ASSISTANT accounts.
  const addTeacher = await request('POST', '/organization/members', {
    token: tokenOwner9,
    body: {
      name: 'Phase 9 Teacher',
      email: teacherEmail,
      password: memberPassword,
      role: 'TEACHER',
    },
  });
  const addTeacherBody = expectStatus(
    addTeacher,
    201,
    'Phase 9 OWNER creates a TEACHER'
  );
  const teacherId9 = addTeacherBody.data.member.id;

  const addAssistant = await request('POST', '/organization/members', {
    token: tokenOwner9,
    body: {
      name: 'Phase 9 Assistant',
      email: assistantEmail,
      password: memberPassword,
      role: 'ASSISTANT',
    },
  });
  const addAssistantBody = expectStatus(
    addAssistant,
    201,
    'Phase 9 OWNER creates an ASSISTANT'
  );
  const assistantId9 = addAssistantBody.data.member.id;

  const ownerCreateOwner = await request('POST', '/organization/members', {
    token: tokenOwner9,
    body: {
      name: 'Fake Owner',
      email: `fake.owner.${suffix}@example.com`,
      password: memberPassword,
      role: 'OWNER',
    },
  });
  expectValidationError(
    ownerCreateOwner,
    'OWNER cannot create another OWNER'
  );

  const ownerCreateAdmin = await request('POST', '/organization/members', {
    token: tokenOwner9,
    body: {
      name: 'Fake Admin',
      email: `fake.admin.${suffix}@example.com`,
      password: memberPassword,
      role: 'ADMIN',
    },
  });
  expectValidationError(ownerCreateAdmin, 'OWNER cannot create an ADMIN');

  const publicRegister = await request('POST', '/auth/register', {
    body: {
      name: 'Public Owner',
      email: `phase9.public.${suffix}@example.com`,
      password: ownerPassword,
      organizationName: `Public Org ${suffix}`,
    },
  });
  expectStatus(publicRegister, 404, 'public OWNER registration is disabled');

  // 6. TEACHER logs in.
  const teacherLogin = await request('POST', '/auth/login', {
    body: { email: teacherEmail, password: memberPassword },
  });
  const teacherLoginBody = expectStatus(
    teacherLogin,
    200,
    'Phase 9 TEACHER login'
  );
  const tokenTeacher9 = teacherLoginBody.data.token;

  const assistantLogin = await request('POST', '/auth/login', {
    body: { email: assistantEmail, password: memberPassword },
  });
  const assistantLoginBody = expectStatus(
    assistantLogin,
    200,
    'Phase 9 ASSISTANT login'
  );
  const tokenAssistant9 = assistantLoginBody.data.token;

  check(
    teacherId9 && assistantId9 && teacherId9 !== assistantId9,
    'teacher and assistant accounts are distinct members'
  );

  // 7. TEACHER creates a section.
  const sectionResponse = await request('POST', '/sections', {
    token: tokenTeacher9,
    body: { name: `Phase 9 Section ${suffix}` },
  });
  const sectionBody = expectStatus(
    sectionResponse,
    201,
    'Phase 9 TEACHER creates a section'
  );
  const sectionId = sectionBody.data.section.id;

  // 8. TEACHER creates students.
  const student1Response = await request('POST', '/students', {
    token: tokenTeacher9,
    body: {
      name: `طالب أول ${suffix}`,
      nickname: `p9-s1-${suffix}`,
      section: sectionId,
    },
  });
  const student1Body = expectStatus(
    student1Response,
    201,
    'Phase 9 TEACHER creates a present student'
  );
  const student1Id = student1Body.data.student.id;

  const student2Response = await request('POST', '/students', {
    token: tokenTeacher9,
    body: {
      name: `Phase 9 Absent ${suffix}`,
      nickname: `p9-s2-${suffix}`,
      section: sectionId,
    },
  });
  const student2Body = expectStatus(
    student2Response,
    201,
    'Phase 9 TEACHER creates an absent student'
  );
  const student2Id = student2Body.data.student.id;

  check(
    student1Body.data.student.organization === orgId,
    'student records are scoped to the organization'
  );

  // 9. TEACHER creates a quiz with multiple questions.
  const quizResponse = await request('POST', '/quizzes', {
    token: tokenTeacher9,
    body: {
      title: `Phase 9 Quiz ${suffix}`,
      description: 'Full end-to-end journey quiz',
    },
  });
  const quizBody = expectStatus(
    quizResponse,
    201,
    'Phase 9 TEACHER creates a quiz'
  );
  const quizId = quizBody.data.quiz.id;

  async function addQuestion(text, points, correctIndex) {
    const response = await request('POST', `/quizzes/${quizId}/questions`, {
      token: tokenTeacher9,
      body: {
        text,
        points,
        timeLimitSec: 5,
        options: [
          { text: 'Option A', isCorrect: correctIndex === 0 },
          { text: 'Option B', isCorrect: correctIndex === 1 },
          { text: 'Option C', isCorrect: correctIndex === 2 },
        ],
      },
    });
    const body = expectStatus(
      response,
      201,
      `Phase 9 TEACHER creates question "${text}"`
    );

    return body.data.question;
  }

  const q1 = await addQuestion(`E2E question one ${suffix}`, 1000, 0);
  const q2 = await addQuestion(`E2E question two ${suffix}`, 1000, 1);
  const q3 = await addQuestion(`E2E question three ${suffix}`, 1000, 2);
  const q1Id = q1.id;
  const q2Id = q2.id;
  const q1CorrectId = q1.options.find((option) => option.isCorrect).id;
  const q1WrongId = q1.options.find((option) => !option.isCorrect).id;
  const q2CorrectId = q2.options.find((option) => option.isCorrect).id;

  check(
    q3.order === 2,
    'questions keep their ordering in the quiz'
  );

  // 10. TEACHER creates a live session.
  const createSessionResponse = await request('POST', '/sessions', {
    token: tokenTeacher9,
    body: { quiz: quizId },
  });
  const createSessionBody = expectStatus(
    createSessionResponse,
    201,
    'Phase 9 TEACHER creates a live session'
  );
  const sessionId = createSessionBody.data.session.id;
  const joinCode = createSessionBody.data.session.joinCode;

  check(
    createSessionBody.data.session.joinUrl.includes(joinCode),
    'session exposes a QR-compatible join URL'
  );
  check(
    createSessionBody.data.session.status === 'LOBBY',
    'new session starts in the lobby'
  );

  const enableGift = await request(
    'PATCH',
    `/sessions/${sessionId}/command-settings`,
    {
      token: tokenTeacher9,
      body: { gift: true },
    }
  );
  const enableGiftBody = expectStatus(
    enableGift,
    200,
    'Phase 9 TEACHER enables the Gift command'
  );
  check(
    enableGiftBody.data.session.commandSettings.gift === true,
    'session command settings persist the Gift toggle'
  );

  const assistantSettings = await request(
    'PATCH',
    `/sessions/${sessionId}/command-settings`,
    {
      token: tokenAssistant9,
      body: { gift: false },
    }
  );
  expectStatus(
    assistantSettings,
    403,
    'ASSISTANT remains read-only for command settings'
  );

  // 11. Students join using the game code without platform accounts.
  const p1Nickname = `P9 Student ${suffix}`.slice(0, 50);
  const p1Join = await request('POST', `/join/${joinCode}`, {
    body: { studentId: student1Id, nickname: p1Nickname },
  });
  const p1JoinBody = expectStatus(
    p1Join,
    201,
    'Phase 9 student joins with a game code'
  );
  const p1Id = p1JoinBody.data.participant.id;
  const p1Token = p1JoinBody.data.participant.participantToken;

  check(
    !('passwordHash' in p1JoinBody.data.participant),
    'public join responses never expose password data'
  );

  const p1ParticipantDoc = await SessionPlayer.findById(p1Id);
  check(
    p1ParticipantDoc.student?.toString() === student1Id,
    'joined participant is linked to the roster student'
  );

  const guestNickname = `P9 Guest ${suffix}`.slice(0, 50);
  const guestJoin = await request('POST', `/join/${joinCode}`, {
    body: { nickname: guestNickname },
  });
  const guestJoinBody = expectStatus(
    guestJoin,
    201,
    'Phase 9 guest joins with only a nickname'
  );
  const guestId = guestJoinBody.data.participant.id;
  const guestToken = guestJoinBody.data.participant.participantToken;

  check(
    guestJoinBody.data.participant.student === undefined,
    'guest participants are not linked to roster students'
  );
  const guestParticipantDoc = await SessionPlayer.findById(guestId);
  check(
    guestParticipantDoc.student === null,
    'guest participant documents have no student reference'
  );

  const duplicateNickname = await request('POST', `/join/${joinCode}`, {
    body: { nickname: p1Nickname },
  });
  expectStatus(duplicateNickname, 409, 'duplicate nicknames are rejected');

  // Teacher and player Socket.IO authentication.
  const teacher = await connectGameSocket({
    role: 'teacher',
    token: tokenTeacher9,
    sessionId,
  });
  const teacherSocket = teacher.socket;
  check(
    teacher.state.sessionId === sessionId,
    'teacher socket authenticates and joins the session room'
  );

  const p1 = await connectGameSocket({
    role: 'player',
    joinCode,
    participantToken: p1Token,
  });
  const guest = await connectGameSocket({
    role: 'player',
    joinCode,
    participantToken: guestToken,
  });
  check(
    p1.state.you.participantId === p1Id,
    'student socket authenticates with the participant token'
  );
  check(
    guest.state.you.participantId === guestId,
    'guest socket authenticates with the participant token'
  );

  // 12. Teacher starts the game.
  const gameStartedPromise = waitForSocketEvent(teacherSocket, 'game:started');
  const q1StartedPromise = waitForSocketEvent(
    teacherSocket,
    'question:started',
    (payload) => payload.index === 0
  );
  const q2StartedPromise = waitForSocketEvent(
    teacherSocket,
    'question:started',
    (payload) => payload.index === 1
  );

  const startAck = await emitWithAck(teacherSocket, 'game:start');
  check(startAck.success === true, 'teacher starts the game over Socket.IO');

  const gameStarted = await gameStartedPromise;
  check(
    gameStarted.totalQuestions === 3,
    'game start reports all three questions'
  );

  const q1Started = await q1StartedPromise;
  check(q1Started.question.id === q1Id, 'the first question is delivered');

  // 16. Teacher pauses and resumes the game (before answering).
  const pausedPromise = waitForSocketEvent(teacherSocket, 'game:paused');
  const pauseAck = await emitWithAck(teacherSocket, 'game:pause');
  check(pauseAck.success === true, 'teacher pauses the live game');
  await pausedPromise;

  const resumedPromise = waitForSocketEvent(teacherSocket, 'game:resumed');
  const resumeAck = await emitWithAck(teacherSocket, 'game:resume');
  check(resumeAck.success === true, 'teacher resumes the live game');
  await resumedPromise;

  // 13. Players answer question one with mixed correctness.
  const q1P1ResultPromise = waitForSocketEvent(
    p1.socket,
    'answer:result',
    (payload) => payload.questionId === q1Id
  );
  const q1GuestResultPromise = waitForSocketEvent(
    guest.socket,
    'answer:result',
    (payload) => payload.questionId === q1Id
  );
  const q1LeaderboardPromise = waitForSocketEvent(
    teacherSocket,
    'leaderboard:updated',
    (payload) => payload.questionId === q1Id
  );

  const p1Q1Ack = await emitWithAck(p1.socket, 'answer:submit', {
    questionId: q1Id,
    optionId: q1CorrectId,
  });
  check(p1Q1Ack.success === true, 'student submits a correct answer');

  const guestQ1Ack = await emitWithAck(guest.socket, 'answer:submit', {
    questionId: q1Id,
    optionId: q1WrongId,
  });
  check(guestQ1Ack.success === true, 'guest submits an incorrect answer');

  const p1Q1Result = await q1P1ResultPromise;
  const guestQ1Result = await q1GuestResultPromise;

  check(
    p1Q1Result.isCorrect === true && p1Q1Result.streak === 1,
    'correct answer awards points and starts a streak'
  );
  check(
    guestQ1Result.isCorrect === false && guestQ1Result.pointsAwarded === 0,
    'incorrect answer awards zero points'
  );

  const q1Leaderboard = await q1LeaderboardPromise;
  check(
    q1Leaderboard.leaderboard[0].participantId === p1Id &&
      q1Leaderboard.leaderboard[0].rank === 1,
    'leaderboard ranks the correct student first'
  );

  // 14. Exercise streaks, scoring, and leaderboard updates on question two.
  const q2Started = await q2StartedPromise;
  check(q2Started.question.id === q2Id, 'the game advances to question two');

  const giftPromise = waitForSocketEvent(
    p1.socket,
    'gift:received',
    () => true,
    9000
  );
  const q2P1ResultPromise = waitForSocketEvent(
    p1.socket,
    'answer:result',
    (payload) => payload.questionId === q2Id
  );
  const q2GuestResultPromise = waitForSocketEvent(
    guest.socket,
    'answer:result',
    (payload) => payload.questionId === q2Id
  );
  const q2LeaderboardPromise = waitForSocketEvent(
    teacherSocket,
    'leaderboard:updated',
    (payload) => payload.questionId === q2Id
  );

  const p1Q2Ack = await emitWithAck(p1.socket, 'answer:submit', {
    questionId: q2Id,
    optionId: q2CorrectId,
  });
  check(p1Q2Ack.success === true, 'student submits a second correct answer');

  const guestQ2Ack = await emitWithAck(guest.socket, 'answer:submit', {
    questionId: q2Id,
    optionId: q2CorrectId,
  });
  check(guestQ2Ack.success === true, 'guest submits a correct answer');

  const p1Q2Result = await q2P1ResultPromise;
  const guestQ2Result = await q2GuestResultPromise;

  check(
    p1Q2Result.isCorrect === true &&
      p1Q2Result.streak === 2 &&
      p1Q2Result.bestStreak === 2,
    'consecutive correct answers build and persist a streak'
  );
  check(
    guestQ2Result.isCorrect === true && guestQ2Result.streak === 1,
    'a correct answer after a wrong answer starts a new streak'
  );

  const q2Leaderboard = await q2LeaderboardPromise;
  check(
    q2Leaderboard.leaderboard[0].participantId === p1Id,
    'the student keeps first place after question two'
  );

  // 15. Exercise the Gift command through the real gameplay path.
  const gift = await giftPromise;
  check(
    Array.isArray(gift.cards) && gift.cards.length === 3,
    'Gift unlocks after two consecutive correct answers and draws three cards'
  );
  check(
    gift.sessionId === sessionId,
    'Gift event is scoped to the active session'
  );

  // 17. Teacher explicitly finishes the session.
  const finishedPromise = waitForSocketEvent(teacherSocket, 'game:finished');
  const finishResponse = await request(
    'POST',
    `/sessions/${sessionId}/finish`,
    { token: tokenTeacher9 }
  );
  const finishBody = expectStatus(
    finishResponse,
    200,
    'Phase 9 TEACHER finishes the session'
  );
  check(
    finishBody.data.session.status === 'FINISHED',
    'finished session status is FINISHED'
  );

  const finished = await finishedPromise;

  // 18. Verify final scores and ranks.
  check(
    finished.leaderboard[0].participantId === p1Id &&
      finished.leaderboard[0].rank === 1,
    'final leaderboard keeps the student in first place'
  );
  check(
    finished.leaderboard.some(
      (entry) => entry.participantId === guestId && entry.rank === 2
    ),
    'final leaderboard ranks the guest second'
  );

  const p1Doc = await SessionPlayer.findById(p1Id);
  const guestDoc = await SessionPlayer.findById(guestId);
  check(
    p1Doc.finalRank === 1 && p1Doc.score > guestDoc.score,
    'final scores and ranks are persisted in the database'
  );
  check(
    p1Doc.bestStreak === 2 && p1Doc.streak === 2,
    'final streak statistics are persisted'
  );

  // 19. Verify attendance records.
  const attendanceResponse = await request(
    'GET',
    `/sessions/${sessionId}/attendance`,
    { token: tokenAssistant9 }
  );
  const attendanceBody = expectStatus(
    attendanceResponse,
    200,
    'Phase 9 ASSISTANT reads finalized attendance'
  );
  const attendance = attendanceBody.data.attendance;

  check(attendance.finalized === true, 'attendance is finalized');
  check(
    attendance.counts.registered === 2,
    'attendance counts the two roster students'
  );
  check(
    attendance.counts.present === 2,
    'attendance counts the present student and guest'
  );
  check(attendance.counts.absent === 1, 'attendance records the absent student');
  check(attendance.counts.guests === 1, 'attendance records the guest');
  check(
    attendance.records.some(
      (record) =>
        record.student === student1Id && record.status === 'PRESENT'
    ),
    'the joined student is PRESENT'
  );
  check(
    attendance.records.some(
      (record) =>
        record.student === student2Id && record.status === 'ABSENT'
    ),
    'the roster student who never joined is ABSENT'
  );

  // 20. Retrieve the session report.
  const reportResponse = await request(
    'GET',
    `/sessions/${sessionId}/report`,
    { token: tokenTeacher9 }
  );
  const reportBody = expectStatus(
    reportResponse,
    200,
    'Phase 9 TEACHER retrieves the session report'
  );
  const report = reportBody.data.report;

  check(
    report.questionAnalysis.length === 3,
    'report includes every question, including the unanswered one'
  );
  check(
    report.studentAnalysis.length === 3,
    'report includes present, absent, and guest students'
  );
  check(
    report.commands.log.some((command) => command.type === 'GIFT'),
    'report includes the Gift command log entry'
  );
  check(
    report.summary.registeredParticipants === 2 &&
      report.summary.actualAttendees === 2 &&
      report.summary.absentees === 1 &&
      report.summary.guests === 1,
    'report summary matches the attendance counts'
  );
  check(
    report.session.quiz.title === `Phase 9 Quiz ${suffix}`,
    'report includes the quiz metadata'
  );

  // 21. Export the report to Excel.
  const exportResponse = await requestBuffer(
    'GET',
    `/sessions/${sessionId}/report/export`,
    { token: tokenOwner9 }
  );
  check(
    exportResponse.status === 200,
    'Phase 9 OWNER exports the report to Excel'
  );

  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(exportResponse.buffer);

  // 22. Verify the downloaded workbook contains correct data.
  check(
    workbook.worksheets.length === 5,
    'E2E workbook contains all five worksheets'
  );

  function sheetRows(worksheet) {
    const rows = [];
    worksheet.eachRow((row, rowNumber) => {
      if (rowNumber === 1) {
        return;
      }
      rows.push(row.values.slice(1));
    });
    return rows;
  }

  const attendanceRows = sheetRows(workbook.getWorksheet('Attendance'));
  const resultsRows = sheetRows(workbook.getWorksheet('Student Results'));
  const questionRows = sheetRows(workbook.getWorksheet('Question Analysis'));
  const commandRows = sheetRows(workbook.getWorksheet('Commands'));

  check(
    attendanceRows.length === report.studentAnalysis.length,
    'exported attendance matches the JSON report'
  );
  check(
    resultsRows.length === report.studentAnalysis.length,
    'exported student results match the JSON report'
  );
  check(
    questionRows.length === report.questionAnalysis.length,
    'exported question analysis matches the JSON report'
  );
  check(
    commandRows.length === report.commands.log.length,
    'exported command log matches the JSON report'
  );

  const p1ResultRow = resultsRows.find(
    (row) => String(row[1]) === p1Nickname
  );
  check(
    Boolean(p1ResultRow) &&
      p1ResultRow[3] === p1Doc.score &&
      p1ResultRow[4] === 1 &&
      p1ResultRow[9] === 2,
    'exported result row contains the final score, rank, and best streak'
  );

  const p1AttendanceRow = attendanceRows.find(
    (row) => String(row[1]) === p1Nickname
  );
  check(
    Boolean(p1AttendanceRow) &&
      String(p1AttendanceRow[3]) === 'PRESENT' &&
      p1AttendanceRow[7] === 2,
    'exported attendance row contains the status and answer count'
  );

  check(
    commandRows.some((row) => String(row[0]) === 'GIFT'),
    'exported command sheet contains the Gift command'
  );
  check(
    questionRows.every((row) => Number.isInteger(row[0])),
    'exported question rows keep their order'
  );

  // SUPER ADMIN still manages organization details at the end of the journey.
  const renameOrg = await request(
    'PATCH',
    `/admin/organizations/${orgId}`,
    {
      token: tokenAdmin9,
      body: { name: `${orgName} Renamed` },
    }
  );
  expectStatus(renameOrg, 200, 'SUPER ADMIN renames the organization');

  const suspendOrg = await request(
    'PATCH',
    `/admin/organizations/${orgId}/status`,
    {
      token: tokenAdmin9,
      body: { status: 'SUSPENDED' },
    }
  );
  const suspendBody = expectStatus(
    suspendOrg,
    200,
    'SUPER ADMIN suspends the organization'
  );
  check(
    suspendBody.data.organization.status === 'SUSPENDED',
    'suspending an organization persists the SUSPENDED status'
  );

  const reactivateOrg = await request(
    'PATCH',
    `/admin/organizations/${orgId}/status`,
    {
      token: tokenAdmin9,
      body: { status: 'ACTIVE' },
    }
  );
  const reactivateBody = expectStatus(
    reactivateOrg,
    200,
    'SUPER ADMIN reactivates the organization'
  );
  check(
    reactivateBody.data.organization.status === 'ACTIVE',
    'reactivating an organization restores the ACTIVE status'
  );

  closeSocket(teacherSocket);
  closeSocket(p1.socket);
  closeSocket(guest.socket);
}

async function runTests(adminEmail, adminPassword) {
  const suffix = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
  const password = 'OwnerPass123!';
  const memberPassword = 'MemberPass123!';
  const ownerAEmail = `owner.a.${suffix}@example.com`;
  const ownerBEmail = `owner.b.${suffix}@example.com`;
  const teacherEmail = `teacher.${suffix}@example.com`;
  const assistantEmail = `assistant.${suffix}@example.com`;

  const health = await request('GET', '/health');
  const healthBody = expectStatus(health, 200, 'GET /health');
  check(healthBody.success === true, 'health response has success=true');
  check(healthBody.database === 'connected', 'health reports database=connected');

  const publicRegister = await request('POST', '/auth/register', {
    body: {
      name: 'Public Owner',
      email: `public.owner.${suffix}@example.com`,
      password,
      organizationName: `Public Org ${suffix}`,
    },
  });
  expectStatus(publicRegister, 404, 'POST /auth/register is removed');

  const adminLogin = await request('POST', '/auth/login', {
    body: { email: adminEmail, password: adminPassword },
  });
  const adminLoginBody = expectStatus(adminLogin, 200, 'POST /auth/login (super admin)');
  expectNoPasswordHash(adminLogin, 'super admin login response');
  const tokenAdmin = adminLoginBody.data.token;
  const adminId = adminLoginBody.data.user.id;
  check(adminLoginBody.data.user.role === 'ADMIN', 'super admin login returns ADMIN role');
  check(
    adminLoginBody.data.user.organization === null,
    'super admin is not an organization member'
  );

  const createOrgA = await request('POST', '/admin/organizations', {
    token: tokenAdmin,
    body: {
      name: `Smoke Org A ${suffix}`,
      owner: { name: 'Owner A', email: ownerAEmail, password },
    },
  });
  const createOrgABody = expectStatus(
    createOrgA,
    201,
    'POST /admin/organizations (org A + owner A)'
  );
  expectNoPasswordHash(createOrgA, 'create organization response');
  check(createOrgABody.data.owner.role === 'OWNER', 'created owner has OWNER role');
  check(
    createOrgABody.data.owner.organization === createOrgABody.data.organization.id,
    'created owner is linked to the organization'
  );
  check(
    createOrgABody.data.organization.owner.id === createOrgABody.data.owner.id,
    'organization owner matches the created owner'
  );
  check(
    createOrgABody.data.organization.status === 'ACTIVE',
    'new organization is ACTIVE'
  );
  check(
    createOrgABody.data.organization.memberCount === 1,
    'new organization starts with one member'
  );

  const ownerAId = createOrgABody.data.owner.id;
  const orgAId = createOrgABody.data.organization.id;

  const storedOwner = await User.findOne({ email: ownerAEmail }).select('+passwordHash');
  check(storedOwner.passwordHash !== password, 'password is not stored in plain text');
  check(await verifyPassword(password, storedOwner.passwordHash), 'stored password hash verifies');
  check(
    storedOwner.organization.toString() === orgAId,
    'owner organization link is persisted'
  );
  check(
    (await Organization.findById(orgAId)).owner.toString() === ownerAId,
    'organization owner link is persisted'
  );

  const wrongPassword = await request('POST', '/auth/login', {
    body: { email: ownerAEmail, password: 'WrongPassword123!' },
  });
  expectStatus(wrongPassword, 401, 'POST /auth/login wrong password');

  const loginA = await request('POST', '/auth/login', {
    body: { email: ownerAEmail, password },
  });
  const loginABody = expectStatus(loginA, 200, 'POST /auth/login (owner A)');
  expectNoPasswordHash(loginA, 'login response');
  check(Boolean(loginABody.data.token), 'login returns a JWT');
  const tokenA = loginABody.data.token;

  const ownerCreateOrg = await request('POST', '/admin/organizations', {
    token: tokenA,
    body: {
      name: `Owner Forbidden Org ${suffix}`,
      owner: {
        name: 'Forbidden Owner',
        email: `forbidden.owner.${suffix}@example.com`,
        password,
      },
    },
  });
  expectStatus(ownerCreateOrg, 403, 'owner cannot create organizations');

  const duplicateEmail = await request('POST', '/admin/organizations', {
    token: tokenAdmin,
    body: {
      name: `Duplicate Org ${suffix}`,
      owner: { name: 'Another Owner', email: ownerAEmail, password },
    },
  });
  expectStatus(duplicateEmail, 409, 'POST /admin/organizations duplicate owner email');
  check(
    (await Organization.exists({ name: `Duplicate Org ${suffix}` })) === null,
    'duplicate owner email does not create an organization'
  );

  const invalidRegister = await request('POST', '/admin/organizations', {
    token: tokenAdmin,
    body: {
      name: 'A',
      owner: { name: 'A', email: 'not-an-email', password: 'short' },
    },
  });
  expectValidationError(invalidRegister, 'POST /admin/organizations invalid body');

  const meMissingToken = await request('GET', '/auth/me');
  expectStatus(meMissingToken, 401, 'GET /auth/me without token');

  const meInvalidToken = await request('GET', '/auth/me', { token: 'not-a-real-token' });
  expectStatus(meInvalidToken, 401, 'GET /auth/me with invalid token');

  const meA = await request('GET', '/auth/me', { token: tokenA });
  const meABody = expectStatus(meA, 200, 'GET /auth/me');
  expectNoPasswordHash(meA, 'me response');
  check(meABody.data.user.id === ownerAId, 'me returns the authenticated user');
  check(meABody.data.user.organization === orgAId, 'me returns the user organization');

  const logout = await request('POST', '/auth/logout');
  const logoutBody = expectStatus(logout, 200, 'POST /auth/logout');
  check(/JWT/i.test(logoutBody.message), 'logout explains that the JWT is client-side only');

  const getOrgA = await request('GET', '/organization', { token: tokenA });
  const getOrgABody = expectStatus(getOrgA, 200, 'GET /organization');
  check(getOrgABody.data.organization.name === `Smoke Org A ${suffix}`, 'organization is scoped correctly');

  const patchOrgA = await request('PATCH', '/organization', {
    token: tokenA,
    body: { name: `Renamed Org A ${suffix}` },
  });
  const patchOrgABody = expectStatus(patchOrgA, 200, 'PATCH /organization');
  check(patchOrgABody.data.organization.name === `Renamed Org A ${suffix}`, 'organization name updated');

  const patchOrgOwner = await request('PATCH', '/organization', {
    token: tokenA,
    body: { name: 'Hijacked Org', owner: ownerAId },
  });
  expectValidationError(patchOrgOwner, 'PATCH /organization rejects owner change');

  const addTeacher = await request('POST', '/organization/members', {
    token: tokenA,
    body: {
      name: 'Teacher One',
      email: teacherEmail,
      password: memberPassword,
      role: 'TEACHER',
    },
  });
  const addTeacherBody = expectStatus(addTeacher, 201, 'POST /organization/members (teacher)');
  expectNoPasswordHash(addTeacher, 'add member response');
  const teacherId = addTeacherBody.data.member.id;
  check(addTeacherBody.data.member.organization === orgAId, 'teacher belongs to owner A organization');

  const addTeacherDuplicate = await request('POST', '/organization/members', {
    token: tokenA,
    body: {
      name: 'Teacher Duplicate',
      email: teacherEmail,
      password: memberPassword,
      role: 'TEACHER',
    },
  });
  expectStatus(addTeacherDuplicate, 409, 'POST /organization/members duplicate email');

  const addAdminAsMember = await request('POST', '/organization/members', {
    token: tokenA,
    body: {
      name: 'Fake Admin',
      email: `fake.admin.${suffix}@example.com`,
      password: memberPassword,
      role: 'ADMIN',
    },
  });
  expectValidationError(addAdminAsMember, 'POST /organization/members rejects ADMIN role');

  const addOwnerAsMember = await request('POST', '/organization/members', {
    token: tokenA,
    body: {
      name: 'Fake Owner',
      email: `fake.owner.${suffix}@example.com`,
      password: memberPassword,
      role: 'OWNER',
    },
  });
  expectValidationError(addOwnerAsMember, 'POST /organization/members rejects OWNER role');

  const addAssistant = await request('POST', '/organization/members', {
    token: tokenA,
    body: {
      name: 'Assistant One',
      email: assistantEmail,
      password: memberPassword,
      role: 'ASSISTANT',
    },
  });
  const addAssistantBody = expectStatus(addAssistant, 201, 'POST /organization/members (assistant)');
  const assistantId = addAssistantBody.data.member.id;

  const membersA = await request('GET', '/organization/members', { token: tokenA });
  const membersABody = expectStatus(membersA, 200, 'GET /organization/members');
  check(membersABody.data.members.length === 3, 'organization A has 3 members');

  const updateTeacher = await request('PATCH', `/organization/members/${teacherId}`, {
    token: tokenA,
    body: { name: 'Teacher Renamed' },
  });
  const updateTeacherBody = expectStatus(updateTeacher, 200, 'PATCH /organization/members/:id');
  check(updateTeacherBody.data.member.name === 'Teacher Renamed', 'member name updated');

  const promoteTeacherToAdmin = await request('PATCH', `/organization/members/${teacherId}`, {
    token: tokenA,
    body: { role: 'ADMIN' },
  });
  expectValidationError(promoteTeacherToAdmin, 'PATCH /organization/members/:id rejects ADMIN role');

  const promoteTeacherToOwner = await request('PATCH', `/organization/members/${teacherId}`, {
    token: tokenA,
    body: { role: 'OWNER' },
  });
  expectValidationError(promoteTeacherToOwner, 'PATCH /organization/members/:id rejects OWNER role');

  const modifyOwner = await request('PATCH', `/organization/members/${ownerAId}`, {
    token: tokenA,
    body: { name: 'Renamed Owner' },
  });
  expectStatus(modifyOwner, 403, 'PATCH /organization/members/:id rejects owner target');

  const loginTeacher = await request('POST', '/auth/login', {
    body: { email: teacherEmail, password: memberPassword },
  });
  const loginTeacherBody = expectStatus(loginTeacher, 200, 'POST /auth/login (teacher)');
  const tokenTeacher = loginTeacherBody.data.token;

  const teacherCreateOrg = await request('POST', '/admin/organizations', {
    token: tokenTeacher,
    body: {
      name: `Teacher Forbidden Org ${suffix}`,
      owner: {
        name: 'Teacher Forbidden Owner',
        email: `teacher.forbidden.owner.${suffix}@example.com`,
        password,
      },
    },
  });
  expectStatus(teacherCreateOrg, 403, 'teacher cannot create organizations');

  const teacherGetOrg = await request('GET', '/organization', { token: tokenTeacher });
  expectStatus(teacherGetOrg, 200, 'teacher GET /organization');

  const teacherPatchOrg = await request('PATCH', '/organization', {
    token: tokenTeacher,
    body: { name: 'Teacher Renamed Org' },
  });
  expectStatus(teacherPatchOrg, 403, 'teacher PATCH /organization');

  const teacherGetMembers = await request('GET', '/organization/members', {
    token: tokenTeacher,
  });
  expectStatus(teacherGetMembers, 200, 'teacher GET /organization/members');

  const teacherAddMember = await request('POST', '/organization/members', {
    token: tokenTeacher,
    body: {
      name: 'Nope',
      email: `nope.${suffix}@example.com`,
      password: memberPassword,
      role: 'TEACHER',
    },
  });
  expectStatus(teacherAddMember, 403, 'teacher POST /organization/members');

  const teacherAdminUsers = await request('GET', '/admin/users', { token: tokenTeacher });
  expectStatus(teacherAdminUsers, 403, 'teacher GET /admin/users');

  const createOrgB = await request('POST', '/admin/organizations', {
    token: tokenAdmin,
    body: {
      name: `Smoke Org B ${suffix}`,
      owner: { name: 'Owner B', email: ownerBEmail, password },
    },
  });
  const createOrgBBody = expectStatus(
    createOrgB,
    201,
    'POST /admin/organizations (org B + owner B)'
  );
  const orgBId = createOrgBBody.data.organization.id;

  const loginB = await request('POST', '/auth/login', {
    body: { email: ownerBEmail, password },
  });
  const loginBBody = expectStatus(loginB, 200, 'POST /auth/login (owner B)');
  const tokenB = loginBBody.data.token;

  const getOrgB = await request('GET', '/organization', { token: tokenB });
  const getOrgBBody = expectStatus(getOrgB, 200, 'owner B GET /organization');
  check(getOrgBBody.data.organization.id === orgBId, 'owner B receives only their organization');
  check(getOrgBBody.data.organization.name !== getOrgABody.data.organization.name, 'organizations are isolated');

  const crossOrgPatchMember = await request('PATCH', `/organization/members/${teacherId}`, {
    token: tokenB,
    body: { name: 'Hijacked Teacher' },
  });
  expectStatus(crossOrgPatchMember, 404, 'cross-organization member update is blocked');

  const crossOrgDeleteMember = await request('DELETE', `/organization/members/${teacherId}`, {
    token: tokenB,
  });
  expectStatus(crossOrgDeleteMember, 404, 'cross-organization member deletion is blocked');

  const membersB = await request('GET', '/organization/members', { token: tokenB });
  const membersBBody = expectStatus(membersB, 200, 'owner B GET /organization/members');
  check(membersBBody.data.members.length === 1, 'organization B cannot see organization A members');

  const ownerAdminUsers = await request('GET', '/admin/users', { token: tokenA });
  expectStatus(ownerAdminUsers, 403, 'owner GET /admin/users');

  const adminUsers = await request('GET', '/admin/users', { token: tokenAdmin });
  const adminUsersBody = expectStatus(adminUsers, 200, 'admin GET /admin/users');
  expectNoPasswordHash(adminUsers, 'admin users response');
  check(adminUsersBody.data.users.length >= 5, 'admin can list users');

  const adminGetUser = await request('GET', `/admin/users/${ownerAId}`, { token: tokenAdmin });
  const adminGetUserBody = expectStatus(adminGetUser, 200, 'admin GET /admin/users/:id');
  check(adminGetUserBody.data.user.email === ownerAEmail, 'admin sees the requested user');

  const invalidUserId = await request('GET', '/admin/users/not-an-object-id', {
    token: tokenAdmin,
  });
  expectStatus(invalidUserId, 400, 'admin GET /admin/users/:id invalid id');

  const missingUserId = await request('GET', '/admin/users/64b000000000000000000000', {
    token: tokenAdmin,
  });
  expectStatus(missingUserId, 404, 'admin GET /admin/users/:id not found');

  const suspendOwner = await request('PATCH', `/admin/users/${ownerAId}/status`, {
    token: tokenAdmin,
    body: { status: 'SUSPENDED' },
  });
  const suspendedOwnerBody = expectStatus(suspendOwner, 200, 'admin PATCH user status SUSPENDED');
  check(suspendedOwnerBody.data.user.status === 'SUSPENDED', 'admin suspended the owner');

  const suspendedMe = await request('GET', '/auth/me', { token: tokenA });
  expectStatus(suspendedMe, 403, 'suspended user cannot use an existing token');

  const suspendedLogin = await request('POST', '/auth/login', {
    body: { email: ownerAEmail, password },
  });
  expectStatus(suspendedLogin, 403, 'suspended user cannot log in');

  const reactivateOwner = await request('PATCH', `/admin/users/${ownerAId}/status`, {
    token: tokenAdmin,
    body: { status: 'ACTIVE' },
  });
  expectStatus(reactivateOwner, 200, 'admin PATCH user status ACTIVE');

  const activeMe = await request('GET', '/auth/me', { token: tokenA });
  expectStatus(activeMe, 200, 'reactivated user can use their token again');

  const suspendSelf = await request('PATCH', `/admin/users/${adminId}/status`, {
    token: tokenAdmin,
    body: { status: 'SUSPENDED' },
  });
  expectStatus(suspendSelf, 400, 'admin cannot suspend their own account');

  const adminOrgs = await request('GET', '/admin/organizations', { token: tokenAdmin });
  const adminOrgsBody = expectStatus(adminOrgs, 200, 'admin GET /admin/organizations');
  check(adminOrgsBody.data.organizations.length >= 2, 'admin can list organizations');
  const adminOrgA = adminOrgsBody.data.organizations.find((org) => org.id === orgAId);
  check(Boolean(adminOrgA), 'admin organization list includes organization A');
  check(adminOrgA.memberCount === 3, 'admin organization list reports member count');
  check(adminOrgA.owner.email === ownerAEmail, 'admin organization list includes owner information');
  check(adminOrgA.status === 'ACTIVE', 'admin organization list includes organization status');

  const adminOrgDetail = await request('GET', `/admin/organizations/${orgAId}`, {
    token: tokenAdmin,
  });
  const adminOrgDetailBody = expectStatus(adminOrgDetail, 200, 'admin GET /admin/organizations/:id');
  check(adminOrgDetailBody.data.organization.id === orgAId, 'admin sees the requested organization');
  check(
    adminOrgDetailBody.data.organization.status === 'ACTIVE',
    'admin organization detail includes status'
  );

  const adminOrgEndpoints = await request('GET', '/organization', { token: tokenAdmin });
  expectStatus(adminOrgEndpoints, 403, 'admin cannot use organization endpoints');

  const adminAddMember = await request('POST', '/organization/members', {
    token: tokenAdmin,
    body: {
      name: 'Admin Added',
      email: `admin.added.${suffix}@example.com`,
      password: memberPassword,
      role: 'TEACHER',
    },
  });
  expectStatus(adminAddMember, 403, 'admin cannot use organization member endpoints');

  const updateOrgB = await request('PATCH', `/admin/organizations/${orgBId}`, {
    token: tokenAdmin,
    body: { name: `Renamed Org B ${suffix}` },
  });
  const updateOrgBBody = expectStatus(updateOrgB, 200, 'PATCH /admin/organizations/:id');
  check(
    updateOrgBBody.data.organization.name === `Renamed Org B ${suffix}`,
    'admin can rename an organization'
  );

  const invalidOrgUpdate = await request('PATCH', `/admin/organizations/${orgBId}`, {
    token: tokenAdmin,
    body: {},
  });
  expectValidationError(invalidOrgUpdate, 'PATCH /admin/organizations/:id invalid body');

  const orgCEmail = `owner.c.${suffix}@example.com`;
  const createOrgC = await request('POST', '/admin/organizations', {
    token: tokenAdmin,
    body: {
      name: `Smoke Org C ${suffix}`,
      owner: { name: 'Owner C', email: orgCEmail, password },
    },
  });
  const createOrgCBody = expectStatus(
    createOrgC,
    201,
    'POST /admin/organizations (org C + owner C)'
  );
  const orgCId = createOrgCBody.data.organization.id;

  const loginC = await request('POST', '/auth/login', {
    body: { email: orgCEmail, password },
  });
  const loginCBody = expectStatus(loginC, 200, 'POST /auth/login (owner C)');
  const tokenC = loginCBody.data.token;

  const suspendOrgC = await request('PATCH', `/admin/organizations/${orgCId}/status`, {
    token: tokenAdmin,
    body: { status: 'SUSPENDED' },
  });
  const suspendOrgCBody = expectStatus(
    suspendOrgC,
    200,
    'PATCH /admin/organizations/:id/status SUSPENDED'
  );
  check(
    suspendOrgCBody.data.organization.status === 'SUSPENDED',
    'admin suspended the organization'
  );

  const suspendedOrgLogin = await request('POST', '/auth/login', {
    body: { email: orgCEmail, password },
  });
  expectStatus(suspendedOrgLogin, 403, 'suspended organization owner cannot log in');

  const suspendedOrgMe = await request('GET', '/auth/me', { token: tokenC });
  expectStatus(suspendedOrgMe, 403, 'suspended organization owner cannot use an existing token');

  const suspendOrgInvalid = await request('PATCH', `/admin/organizations/${orgCId}/status`, {
    token: tokenAdmin,
    body: { status: 'PAUSED' },
  });
  expectValidationError(suspendOrgInvalid, 'PATCH /admin/organizations/:id/status invalid status');

  const reactivateOrgC = await request('PATCH', `/admin/organizations/${orgCId}/status`, {
    token: tokenAdmin,
    body: { status: 'ACTIVE' },
  });
  const reactivateOrgCBody = expectStatus(
    reactivateOrgC,
    200,
    'PATCH /admin/organizations/:id/status ACTIVE'
  );
  check(
    reactivateOrgCBody.data.organization.status === 'ACTIVE',
    'admin reactivated the organization'
  );

  const reactivatedOrgLogin = await request('POST', '/auth/login', {
    body: { email: orgCEmail, password },
  });
  expectStatus(reactivatedOrgLogin, 200, 'reactivated organization owner can log in');

  const rollbackEmail = `rollback.${suffix}@example.com`;
  const rollbackOrgName = `Rollback Org ${suffix}`;
  const originalOrganizationCreate = Organization.create;
  let rollbackError = null;

  Organization.create = async () => {
    throw new Error('forced organization creation failure');
  };

  try {
    await adminService.createOrganization({
      name: rollbackOrgName,
      owner: {
        name: 'Rollback Owner',
        email: rollbackEmail,
        password,
      },
    });
  } catch (error) {
    rollbackError = error;
  } finally {
    Organization.create = originalOrganizationCreate;
  }

  check(
    Boolean(rollbackError) &&
      /forced organization creation failure/.test(rollbackError.message),
    'organization creation failure is surfaced'
  );
  check(
    (await User.exists({ email: rollbackEmail })) === null,
    'failed organization creation rolls back the owner'
  );
  check(
    (await Organization.exists({ name: rollbackOrgName })) === null,
    'failed organization creation leaves no organization'
  );

  const suspendTeacher = await request('PATCH', `/admin/users/${teacherId}/status`, {
    token: tokenAdmin,
    body: { status: 'SUSPENDED' },
  });
  expectStatus(suspendTeacher, 200, 'admin suspends a teacher');

  const suspendedTeacherOrg = await request('GET', '/organization', { token: tokenTeacher });
  expectStatus(suspendedTeacherOrg, 403, 'suspended teacher cannot use an existing token');

  const suspendTeacherLogin = await request('POST', '/auth/login', {
    body: { email: teacherEmail, password: memberPassword },
  });
  expectStatus(suspendTeacherLogin, 403, 'suspended teacher cannot log in');

  await request('PATCH', `/admin/users/${teacherId}/status`, {
    token: tokenAdmin,
    body: { status: 'ACTIVE' },
  });

  const reactivatedTeacherLogin = await request('POST', '/auth/login', {
    body: { email: teacherEmail, password: memberPassword },
  });
  expectStatus(reactivatedTeacherLogin, 200, 'reactivated teacher can log in');

  const loginAssistant = await request('POST', '/auth/login', {
    body: { email: assistantEmail, password: memberPassword },
  });
  const loginAssistantBody = expectStatus(loginAssistant, 200, 'POST /auth/login (assistant)');
  const tokenAssistant = loginAssistantBody.data.token;

  const assistantCreateOrg = await request('POST', '/admin/organizations', {
    token: tokenAssistant,
    body: {
      name: `Assistant Forbidden Org ${suffix}`,
      owner: {
        name: 'Assistant Forbidden Owner',
        email: `assistant.forbidden.owner.${suffix}@example.com`,
        password,
      },
    },
  });
  expectStatus(assistantCreateOrg, 403, 'assistant cannot create organizations');

  const createQuiz = await request('POST', '/quizzes', {
    token: tokenA,
    body: {
      title: `Algebra Basics ${suffix}`,
      description: 'A short algebra quiz',
    },
  });
  const createQuizBody = expectStatus(createQuiz, 201, 'POST /quizzes');
  const quizId = createQuizBody.data.quiz.id;
  check(createQuizBody.data.quiz.organization === orgAId, 'quiz is scoped to the owner organization');
  check(createQuizBody.data.quiz.createdBy === ownerAId, 'quiz records its creator');
  check(createQuizBody.data.quiz.status === 'ACTIVE', 'new quiz is ACTIVE');
  check(createQuizBody.data.quiz.questionCount === 0, 'new quiz has no questions');

  const invalidQuiz = await request('POST', '/quizzes', {
    token: tokenA,
    body: { title: '' },
  });
  expectValidationError(invalidQuiz, 'POST /quizzes invalid body');

  const assistantCreateQuiz = await request('POST', '/quizzes', {
    token: tokenAssistant,
    body: { title: 'Assistant Quiz' },
  });
  expectStatus(assistantCreateQuiz, 403, 'assistant POST /quizzes');

  const listQuizzes = await request('GET', '/quizzes', { token: tokenAssistant });
  const listQuizzesBody = expectStatus(listQuizzes, 200, 'GET /quizzes');
  check(
    listQuizzesBody.data.quizzes.some((quiz) => quiz.id === quizId),
    'assistant can list organization quizzes'
  );

  const searchQuizzes = await request('GET', '/quizzes?search=algebra', { token: tokenTeacher });
  const searchQuizzesBody = expectStatus(searchQuizzes, 200, 'GET /quizzes?search=algebra');
  check(
    searchQuizzesBody.data.quizzes.some((quiz) => quiz.id === quizId),
    'quiz search matches title'
  );

  const searchNoMatch = await request('GET', '/quizzes?search=zzzz-no-match', { token: tokenA });
  const searchNoMatchBody = expectStatus(searchNoMatch, 200, 'GET /quizzes?search=no-match');
  check(searchNoMatchBody.data.quizzes.length === 0, 'quiz search returns no unrelated quizzes');

  const getQuiz = await request('GET', `/quizzes/${quizId}`, { token: tokenTeacher });
  const getQuizBody = expectStatus(getQuiz, 200, 'GET /quizzes/:id');
  check(getQuizBody.data.quiz.questions.length === 0, 'new quiz detail has no questions');

  const updateQuiz = await request('PATCH', `/quizzes/${quizId}`, {
    token: tokenTeacher,
    body: { title: `Algebra Basics Updated ${suffix}`, description: 'Updated description' },
  });
  const updateQuizBody = expectStatus(updateQuiz, 200, 'PATCH /quizzes/:id');
  check(updateQuizBody.data.quiz.title === `Algebra Basics Updated ${suffix}`, 'quiz title updated');

  const crossOrgGetQuiz = await request('GET', `/quizzes/${quizId}`, { token: tokenB });
  expectStatus(crossOrgGetQuiz, 404, 'cross-organization quiz read is blocked');

  const crossOrgUpdateQuiz = await request('PATCH', `/quizzes/${quizId}`, {
    token: tokenB,
    body: { title: 'Hijacked' },
  });
  expectStatus(crossOrgUpdateQuiz, 404, 'cross-organization quiz update is blocked');

  const adminGetQuiz = await request('GET', `/quizzes/${quizId}`, { token: tokenAdmin });
  expectStatus(adminGetQuiz, 403, 'admin cannot access organization quizzes');

  const createQuestion1 = await request('POST', `/quizzes/${quizId}/questions`, {
    token: tokenA,
    body: {
      text: 'What is 2 + 2?',
      points: 1000,
      timeLimitSec: 15,
      options: [
        { text: '3', isCorrect: false },
        { text: '4', isCorrect: true },
        { text: '5', isCorrect: false },
      ],
    },
  });
  const createQuestion1Body = expectStatus(createQuestion1, 201, 'POST /quizzes/:id/questions');
  const question1Id = createQuestion1Body.data.question.id;
  check(createQuestion1Body.data.question.order === 0, 'first question order defaults to 0');
  check(createQuestion1Body.data.question.options.length === 3, 'question has 3 options');
  check(
    createQuestion1Body.data.question.options.filter((option) => option.isCorrect).length === 1,
    'question has exactly one correct option'
  );

  const createQuestion2 = await request('POST', `/quizzes/${quizId}/questions`, {
    token: tokenTeacher,
    body: {
      text: 'What is 3 x 3?',
      points: 500,
      timeLimitSec: 20,
      options: [
        { text: '6', isCorrect: false },
        { text: '9', isCorrect: true },
      ],
    },
  });
  const createQuestion2Body = expectStatus(createQuestion2, 201, 'teacher POST /quizzes/:id/questions');
  const question2Id = createQuestion2Body.data.question.id;
  check(createQuestion2Body.data.question.order === 1, 'second question order defaults to 1');

  const invalidQuestionOptions = await request('POST', `/quizzes/${quizId}/questions`, {
    token: tokenA,
    body: {
      text: 'Invalid',
      options: [{ text: 'Only one', isCorrect: true }],
    },
  });
  expectValidationError(invalidQuestionOptions, 'POST questions rejects fewer than 2 options');

  const noCorrectQuestion = await request('POST', `/quizzes/${quizId}/questions`, {
    token: tokenA,
    body: {
      text: 'No correct answer',
      options: [{ text: 'A' }, { text: 'B' }],
    },
  });
  expectValidationError(noCorrectQuestion, 'POST questions requires one correct option');

  const twoCorrectQuestion = await request('POST', `/quizzes/${quizId}/questions`, {
    token: tokenA,
    body: {
      text: 'Two correct answers',
      options: [
        { text: 'A', isCorrect: true },
        { text: 'B', isCorrect: true },
      ],
    },
  });
  expectValidationError(twoCorrectQuestion, 'POST questions rejects multiple correct options');

  const quizWithQuestions = await request('GET', `/quizzes/${quizId}`, { token: tokenA });
  const quizWithQuestionsBody = expectStatus(quizWithQuestions, 200, 'GET /quizzes/:id with questions');
  check(quizWithQuestionsBody.data.quiz.questionCount === 2, 'quiz reports question count');
  check(
    quizWithQuestionsBody.data.quiz.estimatedDurationSec === 35,
    'quiz reports estimated duration'
  );
  check(quizWithQuestionsBody.data.quiz.questions.length === 2, 'quiz detail includes questions');

  const listQuestions = await request('GET', `/quizzes/${quizId}/questions`, {
    token: tokenAssistant,
  });
  const listQuestionsBody = expectStatus(listQuestions, 200, 'GET /quizzes/:id/questions');
  check(listQuestionsBody.data.questions.length === 2, 'question list returns both questions');

  const getQuestion = await request('GET', `/quizzes/${quizId}/questions/${question1Id}`, {
    token: tokenAssistant,
  });
  const getQuestionBody = expectStatus(getQuestion, 200, 'GET /quizzes/:id/questions/:questionId');
  check(getQuestionBody.data.question.id === question1Id, 'question detail returns requested question');

  const updateQuestion = await request(
    'PATCH',
    `/quizzes/${quizId}/questions/${question1Id}`,
    {
      token: tokenTeacher,
      body: {
        text: 'What is 2 + 3?',
        points: 750,
        timeLimitSec: 25,
        options: [
          { text: '4', isCorrect: false },
          { text: '5', isCorrect: true },
        ],
      },
    }
  );
  const updateQuestionBody = expectStatus(
    updateQuestion,
    200,
    'PATCH /quizzes/:id/questions/:questionId'
  );
  check(updateQuestionBody.data.question.text === 'What is 2 + 3?', 'question text updated');
  check(updateQuestionBody.data.question.options.length === 2, 'question options replaced');
  check(
    updateQuestionBody.data.question.options.filter((option) => option.isCorrect).length === 1,
    'updated question has one correct option'
  );

  const quizAfterQuestionUpdate = await request('GET', `/quizzes/${quizId}`, { token: tokenA });
  const quizAfterQuestionUpdateBody = expectStatus(
    quizAfterQuestionUpdate,
    200,
    'GET quiz after question update'
  );
  check(
    quizAfterQuestionUpdateBody.data.quiz.estimatedDurationSec === 45,
    'estimated duration reflects question updates'
  );

  const crossOrgAddQuestion = await request('POST', `/quizzes/${quizId}/questions`, {
    token: tokenB,
    body: {
      text: 'Hijacked question',
      options: [
        { text: 'A', isCorrect: true },
        { text: 'B' },
      ],
    },
  });
  expectStatus(crossOrgAddQuestion, 404, 'cross-organization question create is blocked');

  const crossOrgListQuestions = await request('GET', `/quizzes/${quizId}/questions`, {
    token: tokenB,
  });
  expectStatus(crossOrgListQuestions, 404, 'cross-organization question list is blocked');

  const crossOrgGetQuestion = await request(
    'GET',
    `/quizzes/${quizId}/questions/${question1Id}`,
    { token: tokenB }
  );
  expectStatus(crossOrgGetQuestion, 404, 'cross-organization question read is blocked');

  const crossOrgUpdateQuestion = await request(
    'PATCH',
    `/quizzes/${quizId}/questions/${question1Id}`,
    {
      token: tokenB,
      body: { text: 'Hijacked' },
    }
  );
  expectStatus(crossOrgUpdateQuestion, 404, 'cross-organization question update is blocked');

  const crossOrgDeleteQuestion = await request(
    'DELETE',
    `/quizzes/${quizId}/questions/${question1Id}`,
    { token: tokenB }
  );
  expectStatus(crossOrgDeleteQuestion, 404, 'cross-organization question delete is blocked');

  const assistantUpdateQuestion = await request(
    'PATCH',
    `/quizzes/${quizId}/questions/${question1Id}`,
    {
      token: tokenAssistant,
      body: { text: 'Assistant edit' },
    }
  );
  expectStatus(assistantUpdateQuestion, 403, 'assistant cannot modify questions');

  const duplicateQuiz = await request('POST', `/quizzes/${quizId}/duplicate`, {
    token: tokenTeacher,
  });
  const duplicateQuizBody = expectStatus(duplicateQuiz, 201, 'POST /quizzes/:id/duplicate');
  const duplicateQuizId = duplicateQuizBody.data.quiz.id;
  check(duplicateQuizId !== quizId, 'duplicate creates a new quiz');
  check(duplicateQuizBody.data.quiz.title.includes('(Copy)'), 'duplicate title includes (Copy)');
  check(duplicateQuizBody.data.quiz.questionCount === 2, 'duplicate copies question count');
  check(duplicateQuizBody.data.quiz.questions.length === 2, 'duplicate copies questions');
  check(
    duplicateQuizBody.data.quiz.questions[0].id !== question1Id,
    'duplicate creates new question ids'
  );
  check(
    duplicateQuizBody.data.quiz.questions[0].options.filter((option) => option.isCorrect).length === 1,
    'duplicate preserves correct answers'
  );

  const crossOrgDuplicate = await request('POST', `/quizzes/${quizId}/duplicate`, {
    token: tokenB,
  });
  expectStatus(crossOrgDuplicate, 404, 'cross-organization duplicate is blocked');

  const archiveQuiz = await request('PATCH', `/quizzes/${quizId}/archive`, { token: tokenA });
  const archiveQuizBody = expectStatus(archiveQuiz, 200, 'PATCH /quizzes/:id/archive');
  check(archiveQuizBody.data.quiz.status === 'ARCHIVED', 'quiz status becomes ARCHIVED');
  check(Boolean(archiveQuizBody.data.quiz.archivedAt), 'archive timestamp is recorded');

  const activeList = await request('GET', '/quizzes', { token: tokenA });
  const activeListBody = expectStatus(activeList, 200, 'GET /quizzes default ACTIVE filter');
  check(
    !activeListBody.data.quizzes.some((quiz) => quiz.id === quizId),
    'archived quiz is excluded by default'
  );
  check(
    activeListBody.data.quizzes.some((quiz) => quiz.id === duplicateQuizId),
    'active duplicate remains listed'
  );

  const archivedList = await request('GET', '/quizzes?status=ARCHIVED', { token: tokenA });
  const archivedListBody = expectStatus(archivedList, 200, 'GET /quizzes?status=ARCHIVED');
  check(
    archivedListBody.data.quizzes.some((quiz) => quiz.id === quizId),
    'archived filter includes archived quiz'
  );

  const allList = await request('GET', '/quizzes?status=ALL', { token: tokenA });
  const allListBody = expectStatus(allList, 200, 'GET /quizzes?status=ALL');
  check(allListBody.data.quizzes.some((quiz) => quiz.id === quizId), 'ALL filter includes archived quiz');
  check(
    allListBody.data.quizzes.some((quiz) => quiz.id === duplicateQuizId),
    'ALL filter includes active quiz'
  );

  const updateArchivedQuiz = await request('PATCH', `/quizzes/${quizId}`, {
    token: tokenA,
    body: { title: 'Cannot update archived' },
  });
  expectStatus(updateArchivedQuiz, 409, 'archived quiz cannot be updated');

  const addQuestionToArchived = await request('POST', `/quizzes/${quizId}/questions`, {
    token: tokenA,
    body: {
      text: 'Archived question',
      options: [
        { text: 'A', isCorrect: true },
        { text: 'B' },
      ],
    },
  });
  expectStatus(addQuestionToArchived, 409, 'archived quiz cannot receive questions');

  const updateQuestionArchived = await request(
    'PATCH',
    `/quizzes/${quizId}/questions/${question2Id}`,
    {
      token: tokenA,
      body: { text: 'Archived edit' },
    }
  );
  expectStatus(updateQuestionArchived, 409, 'archived quiz questions cannot be updated');

  const unarchiveQuiz = await request('PATCH', `/quizzes/${quizId}/unarchive`, {
    token: tokenA,
  });
  const unarchiveQuizBody = expectStatus(unarchiveQuiz, 200, 'PATCH /quizzes/:id/unarchive');
  check(unarchiveQuizBody.data.quiz.status === 'ACTIVE', 'quiz status returns to ACTIVE');
  check(unarchiveQuizBody.data.quiz.archivedAt === null, 'archivedAt is cleared');

  const deleteQuestion = await request('DELETE', `/quizzes/${quizId}/questions/${question2Id}`, {
    token: tokenA,
  });
  expectStatus(deleteQuestion, 200, 'DELETE /quizzes/:id/questions/:questionId');

  const quizAfterQuestionDelete = await request('GET', `/quizzes/${quizId}`, { token: tokenA });
  const quizAfterQuestionDeleteBody = expectStatus(
    quizAfterQuestionDelete,
    200,
    'GET quiz after question delete'
  );
  check(
    quizAfterQuestionDeleteBody.data.quiz.questionCount === 1,
    'question count updates after delete'
  );

  const deleteQuiz = await request('DELETE', `/quizzes/${quizId}`, { token: tokenA });
  expectStatus(deleteQuiz, 200, 'DELETE /quizzes/:id');

  const deletedQuiz = await request('GET', `/quizzes/${quizId}`, { token: tokenA });
  expectStatus(deletedQuiz, 404, 'deleted quiz cannot be retrieved');

  check(
    (await Question.countDocuments({ quiz: quizId })) === 0,
    'deleting a quiz deletes its questions'
  );

  const missingQuiz = await request('GET', '/quizzes/64b000000000000000000000', {
    token: tokenA,
  });
  expectStatus(missingQuiz, 404, 'GET /quizzes/:id not found');

  const invalidQuizId = await request('GET', '/quizzes/not-an-object-id', { token: tokenA });
  expectStatus(invalidQuizId, 400, 'GET /quizzes/:id invalid id');

  const avatarOptions = await request('GET', '/avatars/options', { token: tokenA });
  const avatarOptionsBody = expectStatus(avatarOptions, 200, 'GET /avatars/options');
  check(avatarOptionsBody.data.presets.length > 0, 'avatar options include presets');
  check(avatarOptionsBody.data.colors.length > 0, 'avatar options include colors');
  check(Boolean(avatarOptionsBody.data.default.preset), 'avatar options include a default avatar');

  const avatarPreset = avatarOptionsBody.data.presets[0].id;
  const avatarColor = avatarOptionsBody.data.colors[0].id;
  const secondAvatarPreset = avatarOptionsBody.data.presets[1].id;
  const secondAvatarColor = avatarOptionsBody.data.colors[1].id;

  const createSection = await request('POST', '/sections', {
    token: tokenA,
    body: { name: `Grade 10 A ${suffix}`, description: 'First section' },
  });
  const createSectionBody = expectStatus(createSection, 201, 'POST /sections');
  const section1Id = createSectionBody.data.section.id;
  check(
    createSectionBody.data.section.organization === orgAId,
    'section is scoped to the owner organization'
  );
  check(createSectionBody.data.section.createdBy === ownerAId, 'section records its creator');
  check(createSectionBody.data.section.studentCount === 0, 'new section has no students');

  const invalidSection = await request('POST', '/sections', {
    token: tokenA,
    body: { name: '' },
  });
  expectValidationError(invalidSection, 'POST /sections invalid body');

  const duplicateSection = await request('POST', '/sections', {
    token: tokenA,
    body: { name: `Grade 10 A ${suffix}` },
  });
  expectStatus(duplicateSection, 409, 'POST /sections duplicate name');

  const assistantCreateSection = await request('POST', '/sections', {
    token: tokenAssistant,
    body: { name: `Assistant Section ${suffix}` },
  });
  expectStatus(assistantCreateSection, 403, 'assistant POST /sections');

  const listSections = await request('GET', '/sections', { token: tokenAssistant });
  const listSectionsBody = expectStatus(listSections, 200, 'GET /sections');
  check(
    listSectionsBody.data.sections.some((section) => section.id === section1Id),
    'assistant can list organization sections'
  );

  const searchSections = await request('GET', '/sections?search=grade', {
    token: tokenTeacher,
  });
  const searchSectionsBody = expectStatus(searchSections, 200, 'GET /sections?search=grade');
  check(
    searchSectionsBody.data.sections.some((section) => section.id === section1Id),
    'section search matches name'
  );

  const searchSectionsNoMatch = await request('GET', '/sections?search=zzzz-no-match', {
    token: tokenA,
  });
  const searchSectionsNoMatchBody = expectStatus(
    searchSectionsNoMatch,
    200,
    'GET /sections?search=no-match'
  );
  check(
    searchSectionsNoMatchBody.data.sections.length === 0,
    'section search returns no unrelated sections'
  );

  const getSection = await request('GET', `/sections/${section1Id}`, { token: tokenTeacher });
  const getSectionBody = expectStatus(getSection, 200, 'GET /sections/:id');
  check(getSectionBody.data.section.students.length === 0, 'new section detail has no students');

  const updateSection = await request('PATCH', `/sections/${section1Id}`, {
    token: tokenTeacher,
    body: { name: `Grade 10 Alpha ${suffix}`, description: 'Updated section' },
  });
  const updateSectionBody = expectStatus(updateSection, 200, 'PATCH /sections/:id');
  check(
    updateSectionBody.data.section.name === `Grade 10 Alpha ${suffix}`,
    'section name updated'
  );

  const createSection2 = await request('POST', '/sections', {
    token: tokenTeacher,
    body: { name: `Grade 10 B ${suffix}` },
  });
  const createSection2Body = expectStatus(createSection2, 201, 'teacher POST /sections');
  const section2Id = createSection2Body.data.section.id;

  const createOrgBSection = await request('POST', '/sections', {
    token: tokenB,
    body: { name: `Org B Section ${suffix}` },
  });
  const createOrgBSectionBody = expectStatus(createOrgBSection, 201, 'owner B POST /sections');
  const orgBSectionId = createOrgBSectionBody.data.section.id;

  const crossOrgGetSection = await request('GET', `/sections/${section1Id}`, { token: tokenB });
  expectStatus(crossOrgGetSection, 404, 'cross-organization section read is blocked');

  const crossOrgUpdateSection = await request('PATCH', `/sections/${section1Id}`, {
    token: tokenB,
    body: { name: 'Hijacked Section' },
  });
  expectStatus(crossOrgUpdateSection, 404, 'cross-organization section update is blocked');

  const adminGetSections = await request('GET', '/sections', { token: tokenAdmin });
  expectStatus(adminGetSections, 403, 'admin cannot access organization sections');

  const createStudent1 = await request('POST', '/students', {
    token: tokenA,
    body: {
      name: `Student One ${suffix}`,
      nickname: 'S1',
      section: section1Id,
      avatar: { preset: avatarPreset, color: avatarColor },
    },
  });
  const createStudent1Body = expectStatus(createStudent1, 201, 'POST /students');
  const student1Id = createStudent1Body.data.student.id;
  check(
    createStudent1Body.data.student.organization === orgAId,
    'student is scoped to the owner organization'
  );
  check(
    createStudent1Body.data.student.section === section1Id,
    'student is assigned to the requested section'
  );
  check(createStudent1Body.data.student.avatar.preset === avatarPreset, 'student avatar preset saved');
  check(createStudent1Body.data.student.avatar.color === avatarColor, 'student avatar color saved');

  const createStudent2 = await request('POST', '/students', {
    token: tokenTeacher,
    body: { name: `Student Two ${suffix}`, section: section1Id },
  });
  const createStudent2Body = expectStatus(createStudent2, 201, 'teacher POST /students');
  const student2Id = createStudent2Body.data.student.id;
  check(
    createStudent2Body.data.student.avatar.preset === avatarOptionsBody.data.default.preset,
    'student avatar defaults to the default preset'
  );
  check(
    createStudent2Body.data.student.avatar.color === avatarOptionsBody.data.default.color,
    'student avatar defaults to the default color'
  );

  const invalidStudent = await request('POST', '/students', {
    token: tokenA,
    body: { name: '', section: section1Id },
  });
  expectValidationError(invalidStudent, 'POST /students invalid body');

  const invalidStudentSection = await request('POST', '/students', {
    token: tokenA,
    body: { name: 'Invalid Section', section: 'not-an-object-id' },
  });
  expectValidationError(invalidStudentSection, 'POST /students invalid section id');

  const crossOrgSectionStudent = await request('POST', '/students', {
    token: tokenA,
    body: { name: 'Cross Org Student', section: orgBSectionId },
  });
  expectStatus(
    crossOrgSectionStudent,
    404,
    'student cannot be created in another organization section'
  );

  const invalidAvatar = await request('POST', '/students', {
    token: tokenA,
    body: { name: 'Invalid Avatar', section: section1Id, avatar: { preset: 'NOT_A_PRESET' } },
  });
  expectValidationError(invalidAvatar, 'POST /students rejects unsupported avatar preset');

  const assistantCreateStudent = await request('POST', '/students', {
    token: tokenAssistant,
    body: { name: 'Assistant Student', section: section1Id },
  });
  expectStatus(assistantCreateStudent, 403, 'assistant POST /students');

  const listStudents = await request('GET', '/students', { token: tokenAssistant });
  const listStudentsBody = expectStatus(listStudents, 200, 'GET /students');
  check(
    listStudentsBody.data.students.some((student) => student.id === student1Id),
    'assistant can list organization students'
  );

  const sectionStudents = await request('GET', `/students?section=${section1Id}`, {
    token: tokenTeacher,
  });
  const sectionStudentsBody = expectStatus(sectionStudents, 200, 'GET /students?section=:id');
  check(sectionStudentsBody.data.students.length === 2, 'student list filters by section');

  const searchStudents = await request('GET', '/students?search=one', { token: tokenTeacher });
  const searchStudentsBody = expectStatus(searchStudents, 200, 'GET /students?search=one');
  check(
    searchStudentsBody.data.students.some((student) => student.id === student1Id),
    'student search matches name'
  );

  const searchStudentsNickname = await request('GET', '/students?search=S1', {
    token: tokenTeacher,
  });
  const searchStudentsNicknameBody = expectStatus(
    searchStudentsNickname,
    200,
    'GET /students?search=S1'
  );
  check(
    searchStudentsNicknameBody.data.students.some((student) => student.id === student1Id),
    'student search matches nickname'
  );

  const searchStudentsNoMatch = await request('GET', '/students?search=zzzz-no-match', {
    token: tokenA,
  });
  const searchStudentsNoMatchBody = expectStatus(
    searchStudentsNoMatch,
    200,
    'GET /students?search=no-match'
  );
  check(
    searchStudentsNoMatchBody.data.students.length === 0,
    'student search returns no unrelated students'
  );

  const getStudent = await request('GET', `/students/${student1Id}`, { token: tokenTeacher });
  const getStudentBody = expectStatus(getStudent, 200, 'GET /students/:id');
  check(getStudentBody.data.student.id === student1Id, 'student detail returns the requested student');

  const updateStudent = await request('PATCH', `/students/${student2Id}`, {
    token: tokenTeacher,
    body: { name: `Student Two Renamed ${suffix}`, nickname: 'S2' },
  });
  const updateStudentBody = expectStatus(updateStudent, 200, 'PATCH /students/:id');
  check(
    updateStudentBody.data.student.name === `Student Two Renamed ${suffix}`,
    'student name updated'
  );
  check(updateStudentBody.data.student.nickname === 'S2', 'student nickname updated');

  const moveStudent = await request('PATCH', `/students/${student2Id}`, {
    token: tokenTeacher,
    body: { section: section2Id },
  });
  const moveStudentBody = expectStatus(moveStudent, 200, 'PATCH /students/:id moves section');
  check(moveStudentBody.data.student.section === section2Id, 'student moved to another section');

  const crossOrgMoveStudent = await request('PATCH', `/students/${student2Id}`, {
    token: tokenA,
    body: { section: orgBSectionId },
  });
  expectStatus(crossOrgMoveStudent, 404, 'student cannot be moved to another organization section');

  const updateAvatar = await request('PATCH', `/students/${student1Id}/avatar`, {
    token: tokenTeacher,
    body: { preset: secondAvatarPreset, color: secondAvatarColor },
  });
  const updateAvatarBody = expectStatus(updateAvatar, 200, 'PATCH /students/:id/avatar');
  check(
    updateAvatarBody.data.student.avatar.preset === secondAvatarPreset,
    'student avatar preset updated'
  );
  check(
    updateAvatarBody.data.student.avatar.color === secondAvatarColor,
    'student avatar color updated'
  );

  const invalidAvatarUpdate = await request('PATCH', `/students/${student1Id}/avatar`, {
    token: tokenTeacher,
    body: { color: '#000000' },
  });
  expectValidationError(
    invalidAvatarUpdate,
    'PATCH /students/:id/avatar rejects unsupported color'
  );

  const emptyAvatarUpdate = await request('PATCH', `/students/${student1Id}/avatar`, {
    token: tokenTeacher,
    body: {},
  });
  expectValidationError(emptyAvatarUpdate, 'PATCH /students/:id/avatar requires a field');

  const crossOrgGetStudent = await request('GET', `/students/${student1Id}`, { token: tokenB });
  expectStatus(crossOrgGetStudent, 404, 'cross-organization student read is blocked');

  const crossOrgUpdateStudent = await request('PATCH', `/students/${student1Id}`, {
    token: tokenB,
    body: { name: 'Hijacked Student' },
  });
  expectStatus(crossOrgUpdateStudent, 404, 'cross-organization student update is blocked');

  const crossOrgDeleteStudent = await request('DELETE', `/students/${student1Id}`, {
    token: tokenB,
  });
  expectStatus(crossOrgDeleteStudent, 404, 'cross-organization student delete is blocked');

  const adminGetStudents = await request('GET', '/students', { token: tokenAdmin });
  expectStatus(adminGetStudents, 403, 'admin cannot access organization students');

  const importStudents = await request('POST', '/students/import', {
    token: tokenTeacher,
    body: {
      section: section2Id,
      students: [
        { name: `Imported One ${suffix}`, nickname: 'IMP1' },
        { name: `Imported Two ${suffix}`, avatar: { preset: avatarPreset, color: avatarColor } },
      ],
    },
  });
  const importStudentsBody = expectStatus(importStudents, 201, 'POST /students/import');
  check(importStudentsBody.data.importedCount === 2, 'student import reports imported count');
  check(importStudentsBody.data.students.length === 2, 'student import returns created students');
  check(
    importStudentsBody.data.students.every((student) => student.section === section2Id),
    'imported students are assigned to the target section'
  );

  const sectionWithStudents = await request('GET', `/sections/${section1Id}`, {
    token: tokenTeacher,
  });
  const sectionWithStudentsBody = expectStatus(
    sectionWithStudents,
    200,
    'GET section with students'
  );
  check(sectionWithStudentsBody.data.section.studentCount === 1, 'section reports student count');
  check(
    sectionWithStudentsBody.data.section.students.length === 1,
    'section detail includes its students'
  );

  const section2WithStudents = await request('GET', `/sections/${section2Id}`, {
    token: tokenTeacher,
  });
  const section2WithStudentsBody = expectStatus(
    section2WithStudents,
    200,
    'GET second section with students'
  );
  check(section2WithStudentsBody.data.section.studentCount === 3, 'second section reports all students');

  const deleteSectionWithStudents = await request('DELETE', `/sections/${section1Id}`, {
    token: tokenA,
  });
  expectStatus(deleteSectionWithStudents, 409, 'section with students cannot be deleted');

  const addPlayerAsMember = await request('POST', '/organization/members', {
    token: tokenA,
    body: {
      name: 'Player Account',
      email: `player.${suffix}@example.com`,
      password: memberPassword,
      role: 'PLAYER',
    },
  });
  expectValidationError(addPlayerAsMember, 'PLAYER is not a platform user role');

  const deleteStudent1 = await request('DELETE', `/students/${student1Id}`, { token: tokenA });
  expectStatus(deleteStudent1, 200, 'DELETE /students/:id');

  const deletedStudent = await request('GET', `/students/${student1Id}`, { token: tokenA });
  expectStatus(deletedStudent, 404, 'deleted student cannot be retrieved');

  const deleteSection1 = await request('DELETE', `/sections/${section1Id}`, { token: tokenA });
  expectStatus(deleteSection1, 200, 'DELETE empty section');

  const deletedSection = await request('GET', `/sections/${section1Id}`, { token: tokenA });
  expectStatus(deletedSection, 404, 'deleted section cannot be retrieved');

  const deleteStudent2 = await request('DELETE', `/students/${student2Id}`, { token: tokenA });
  expectStatus(deleteStudent2, 200, 'DELETE moved student');

  const deleteSection2 = await request('DELETE', `/sections/${section2Id}`, { token: tokenA });
  expectStatus(deleteSection2, 409, 'section with imported students cannot be deleted');

  const importedStudents = await request('GET', `/students?section=${section2Id}`, {
    token: tokenA,
  });
  const importedStudentsBody = expectStatus(
    importedStudents,
    200,
    'GET imported students before cleanup'
  );
  check(importedStudentsBody.data.students.length === 2, 'imported students remain in the section');

  for (const student of importedStudentsBody.data.students) {
    await request('DELETE', `/students/${student.id}`, { token: tokenA });
  }

  const deleteSection2AfterCleanup = await request('DELETE', `/sections/${section2Id}`, {
    token: tokenA,
  });
  expectStatus(deleteSection2AfterCleanup, 200, 'DELETE section after removing imported students');

  const invalidSectionId = await request('GET', '/sections/not-an-object-id', { token: tokenA });
  expectStatus(invalidSectionId, 400, 'GET /sections/:id invalid id');

  const missingSection = await request('GET', '/sections/64b000000000000000000000', {
    token: tokenA,
  });
  expectStatus(missingSection, 404, 'GET /sections/:id not found');

  const invalidStudentId = await request('GET', '/students/not-an-object-id', { token: tokenA });
  expectStatus(invalidStudentId, 400, 'GET /students/:id invalid id');

  const missingStudent = await request('GET', '/students/64b000000000000000000000', {
    token: tokenA,
  });
  expectStatus(missingStudent, 404, 'GET /students/:id not found');

  check(
    (await Student.countDocuments({ organization: orgAId })) === 0,
    'all organization A students were removed'
  );
  check(
    (await Section.countDocuments({ organization: orgAId })) === 0,
    'all organization A sections were removed'
  );

  const sessionQuiz = await request('POST', '/quizzes', {
    token: tokenA,
    body: { title: `Session Quiz ${suffix}` },
  });
  const sessionQuizBody = expectStatus(sessionQuiz, 201, 'POST /quizzes for session');
  const sessionQuizId = sessionQuizBody.data.quiz.id;

  const sessionQuizQuestion = await request('POST', `/quizzes/${sessionQuizId}/questions`, {
    token: tokenA,
    body: {
      text: 'Session question',
      timeLimitSec: 20,
      options: [
        { text: 'A', isCorrect: true },
        { text: 'B', isCorrect: false },
      ],
    },
  });
  expectStatus(sessionQuizQuestion, 201, 'POST session quiz question');

  const emptySessionQuiz = await request('POST', '/quizzes', {
    token: tokenA,
    body: { title: `Empty Session Quiz ${suffix}` },
  });
  const emptySessionQuizBody = expectStatus(
    emptySessionQuiz,
    201,
    'POST /quizzes for empty session quiz'
  );
  const emptySessionQuizId = emptySessionQuizBody.data.quiz.id;

  const emptyQuizSession = await request('POST', '/sessions', {
    token: tokenA,
    body: { quiz: emptySessionQuizId },
  });
  expectStatus(emptyQuizSession, 409, 'session creation requires a quiz with questions');

  const archivedSessionQuiz = await request('POST', '/quizzes', {
    token: tokenA,
    body: { title: `Archived Session Quiz ${suffix}` },
  });
  const archivedSessionQuizBody = expectStatus(
    archivedSessionQuiz,
    201,
    'POST /quizzes for archived session quiz'
  );
  const archivedSessionQuizId = archivedSessionQuizBody.data.quiz.id;

  await request('POST', `/quizzes/${archivedSessionQuizId}/questions`, {
    token: tokenA,
    body: {
      text: 'Archived session question',
      options: [
        { text: 'A', isCorrect: true },
        { text: 'B', isCorrect: false },
      ],
    },
  });
  await request('PATCH', `/quizzes/${archivedSessionQuizId}/archive`, { token: tokenA });

  const archivedQuizSession = await request('POST', '/sessions', {
    token: tokenA,
    body: { quiz: archivedSessionQuizId },
  });
  expectStatus(archivedQuizSession, 409, 'archived quiz cannot create a session');

  const orgBSessionQuiz = await request('POST', '/quizzes', {
    token: tokenB,
    body: { title: `Org B Session Quiz ${suffix}` },
  });
  const orgBSessionQuizBody = expectStatus(orgBSessionQuiz, 201, 'POST org B session quiz');
  const orgBSessionQuizId = orgBSessionQuizBody.data.quiz.id;

  await request('POST', `/quizzes/${orgBSessionQuizId}/questions`, {
    token: tokenB,
    body: {
      text: 'Org B session question',
      options: [
        { text: 'A', isCorrect: true },
        { text: 'B', isCorrect: false },
      ],
    },
  });

  const crossOrgQuizSession = await request('POST', '/sessions', {
    token: tokenA,
    body: { quiz: orgBSessionQuizId },
  });
  expectStatus(crossOrgQuizSession, 404, 'session cannot be created from another organization quiz');

  const invalidSessionBody = await request('POST', '/sessions', {
    token: tokenA,
    body: {},
  });
  expectValidationError(invalidSessionBody, 'POST /sessions invalid body');

  const invalidSessionQuiz = await request('POST', '/sessions', {
    token: tokenA,
    body: { quiz: 'not-an-object-id' },
  });
  expectValidationError(invalidSessionQuiz, 'POST /sessions invalid quiz id');

  const missingSessionQuiz = await request('POST', '/sessions', {
    token: tokenA,
    body: { quiz: '64b000000000000000000000' },
  });
  expectStatus(missingSessionQuiz, 404, 'POST /sessions missing quiz');

  const assistantCreateSession = await request('POST', '/sessions', {
    token: tokenAssistant,
    body: { quiz: sessionQuizId },
  });
  expectStatus(assistantCreateSession, 403, 'assistant POST /sessions');

  const createSession = await request('POST', '/sessions', {
    token: tokenTeacher,
    body: { quiz: sessionQuizId },
  });
  const createSessionBody = expectStatus(createSession, 201, 'POST /sessions');
  const sessionId = createSessionBody.data.session.id;
  const joinCode = createSessionBody.data.session.joinCode;
  check(/^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{6}$/.test(joinCode), 'game code is 6 safe characters');
  check(createSessionBody.data.session.status === 'LOBBY', 'new session is in LOBBY');
  check(createSessionBody.data.session.joinOpen === true, 'new session accepts participants');
  check(createSessionBody.data.session.organization === orgAId, 'session is scoped to the organization');
  check(createSessionBody.data.session.createdBy === teacherId, 'session records its creator');
  check(createSessionBody.data.session.quiz.id === sessionQuizId, 'session references the quiz');
  check(createSessionBody.data.session.quiz.questionCount === 1, 'session quiz question count is included');
  check(
    createSessionBody.data.session.joinUrl.endsWith(`/${joinCode}`),
    'session includes a QR-compatible join URL'
  );
  check(createSessionBody.data.session.participantCount === 0, 'new session has no participants');

  const createSession2 = await request('POST', '/sessions', {
    token: tokenA,
    body: { quiz: sessionQuizId },
  });
  const createSession2Body = expectStatus(createSession2, 201, 'POST /sessions second session');
  const session2Id = createSession2Body.data.session.id;
  check(createSession2Body.data.session.joinCode !== joinCode, 'game codes are unique');

  const listSessions = await request('GET', '/sessions', { token: tokenAssistant });
  const listSessionsBody = expectStatus(listSessions, 200, 'GET /sessions');
  check(
    listSessionsBody.data.sessions.some((session) => session.id === sessionId),
    'assistant can list organization sessions'
  );

  const lobbySessions = await request('GET', '/sessions?status=LOBBY', { token: tokenTeacher });
  const lobbySessionsBody = expectStatus(lobbySessions, 200, 'GET /sessions?status=LOBBY');
  check(
    lobbySessionsBody.data.sessions.some((session) => session.id === sessionId),
    'session status filter includes the lobby session'
  );

  const quizSessions = await request('GET', `/sessions?quiz=${sessionQuizId}`, { token: tokenA });
  const quizSessionsBody = expectStatus(quizSessions, 200, 'GET /sessions?quiz=:id');
  check(quizSessionsBody.data.sessions.length === 2, 'session list filters by quiz');

  const searchSessions = await request('GET', '/sessions?search=Session Quiz', { token: tokenA });
  const searchSessionsBody = expectStatus(searchSessions, 200, 'GET /sessions?search=Session Quiz');
  check(
    searchSessionsBody.data.sessions.some((session) => session.id === sessionId),
    'session search matches quiz title'
  );

  const searchSessionsNoMatch = await request('GET', '/sessions?search=zzzz-no-match', {
    token: tokenA,
  });
  const searchSessionsNoMatchBody = expectStatus(
    searchSessionsNoMatch,
    200,
    'GET /sessions?search=no-match'
  );
  check(
    searchSessionsNoMatchBody.data.sessions.length === 0,
    'session search returns no unrelated sessions'
  );

  const getSession = await request('GET', `/sessions/${sessionId}`, { token: tokenTeacher });
  const getSessionBody = expectStatus(getSession, 200, 'GET /sessions/:id');
  check(
    getSessionBody.data.session.quiz.title === `Session Quiz ${suffix}`,
    'session detail includes the quiz title'
  );

  const crossOrgGetSession = await request('GET', `/sessions/${sessionId}`, { token: tokenB });
  expectStatus(crossOrgGetSession, 404, 'cross-organization session read is blocked');

  const crossOrgLobby = await request('GET', `/sessions/${sessionId}/lobby`, { token: tokenB });
  expectStatus(crossOrgLobby, 404, 'cross-organization lobby read is blocked');

  const crossOrgStartSession = await request('POST', `/sessions/${sessionId}/start`, {
    token: tokenB,
  });
  expectStatus(crossOrgStartSession, 404, 'cross-organization session start is blocked');

  const adminGetSessions = await request('GET', '/sessions', { token: tokenAdmin });
  expectStatus(adminGetSessions, 403, 'admin cannot access organization sessions');

  const adminCreateSession = await request('POST', '/sessions', {
    token: tokenAdmin,
    body: { quiz: sessionQuizId },
  });
  expectStatus(adminCreateSession, 403, 'admin cannot create organization sessions');

  const publicSession = await request('GET', `/join/${joinCode}`);
  const publicSessionBody = expectStatus(publicSession, 200, 'GET /join/:code');
  check(publicSessionBody.data.session.joinCode === joinCode, 'public session returns the game code');
  check(
    publicSessionBody.data.session.quiz.title === `Session Quiz ${suffix}`,
    'public session includes the quiz title'
  );
  check(
    !hasKeyDeep(publicSessionBody, 'organization'),
    'public session does not expose organization'
  );
  check(!hasKeyDeep(publicSessionBody, 'createdBy'), 'public session does not expose creator');

  const unknownJoinCode = await request('GET', '/join/ZZZZZZ');
  expectStatus(unknownJoinCode, 404, 'GET /join/:code unknown code');

  const invalidJoinCode = await request('GET', '/join/ABC');
  expectStatus(invalidJoinCode, 400, 'GET /join/:code invalid code');

  const lowercasePublicSession = await request('GET', `/join/${joinCode.toLowerCase()}`);
  expectStatus(lowercasePublicSession, 200, 'game code lookup is case-insensitive');

  const sessionSection = await request('POST', '/sections', {
    token: tokenA,
    body: { name: `Session Section ${suffix}` },
  });
  const sessionSectionBody = expectStatus(sessionSection, 201, 'POST /sections for session');
  const sessionSectionId = sessionSectionBody.data.section.id;

  const sessionStudent = await request('POST', '/students', {
    token: tokenA,
    body: {
      name: `Session Student ${suffix}`,
      nickname: `SS${suffix}`,
      section: sessionSectionId,
      avatar: { preset: avatarPreset, color: avatarColor },
    },
  });
  const sessionStudentBody = expectStatus(sessionStudent, 201, 'POST /students for session');
  const sessionStudentId = sessionStudentBody.data.student.id;

  const orgBSection = await request('POST', '/sections', {
    token: tokenB,
    body: { name: `Org B Session Section ${suffix}` },
  });
  const orgBSessionSectionBody = expectStatus(orgBSection, 201, 'POST org B section for session');
  const sessionOrgBSectionId = orgBSessionSectionBody.data.section.id;

  const orgBStudent = await request('POST', '/students', {
    token: tokenB,
    body: { name: `Org B Student ${suffix}`, section: sessionOrgBSectionId },
  });
  const orgBSessionStudentBody = expectStatus(orgBStudent, 201, 'POST org B student for session');
  const sessionOrgBStudentId = orgBSessionStudentBody.data.student.id;

  const joinWithStudent = await request('POST', `/join/${joinCode}`, {
    body: {
      studentId: sessionStudentId,
      avatar: { preset: secondAvatarPreset, color: secondAvatarColor },
    },
  });
  const joinWithStudentBody = expectStatus(joinWithStudent, 201, 'POST /join/:code with student');
  const studentParticipantId = joinWithStudentBody.data.participant.id;
  const studentParticipantToken = joinWithStudentBody.data.participant.participantToken;
  check(
    joinWithStudentBody.data.participant.nickname === `SS${suffix}`,
    'join uses the saved student nickname'
  );
  check(
    joinWithStudentBody.data.participant.avatar.preset === secondAvatarPreset,
    'join applies an avatar override'
  );
  check(
    typeof studentParticipantToken === 'string' && studentParticipantToken.length >= 32,
    'join returns a participant token'
  );
  check(!hasKeyDeep(joinWithStudentBody, 'tokenHash'), 'join does not expose the token hash');
  check(
    joinWithStudentBody.data.session.participantCount === 1,
    'public session reports participant count'
  );

  const duplicateNickname = await request('POST', `/join/${joinCode}`, {
    body: { nickname: `SS${suffix}` },
  });
  expectStatus(duplicateNickname, 409, 'duplicate nickname is blocked');

  const duplicateStudentJoin = await request('POST', `/join/${joinCode}`, {
    body: { studentId: sessionStudentId, nickname: `Another ${suffix}` },
  });
  expectStatus(duplicateStudentJoin, 409, 'student cannot join the same session twice');

  const invalidJoinAvatar = await request('POST', `/join/${joinCode}`, {
    body: { nickname: `Bad Avatar ${suffix}`, avatar: { preset: 'NOT_A_PRESET' } },
  });
  expectValidationError(invalidJoinAvatar, 'join rejects an unsupported avatar preset');

  const invalidJoinStudent = await request('POST', `/join/${joinCode}`, {
    body: { studentId: 'not-an-object-id' },
  });
  expectValidationError(invalidJoinStudent, 'join rejects an invalid student id');

  const missingJoinIdentity = await request('POST', `/join/${joinCode}`, { body: {} });
  expectValidationError(missingJoinIdentity, 'join requires a nickname, student, or token');

  const crossOrgStudentJoin = await request('POST', `/join/${joinCode}`, {
    body: { studentId: sessionOrgBStudentId, nickname: `Org B Join ${suffix}` },
  });
  expectStatus(crossOrgStudentJoin, 404, 'student from another organization cannot join');

  const crossOrgSectionJoin = await request('POST', `/join/${joinCode}`, {
    body: { nickname: `Org B Section ${suffix}`, section: sessionOrgBSectionId },
  });
  expectStatus(crossOrgSectionJoin, 404, 'section from another organization cannot be used to join');

  const guestJoin = await request('POST', `/join/${joinCode}`, {
    body: {
      nickname: `Guest ${suffix}`,
      name: `Guest Player ${suffix}`,
      section: sessionSectionId,
      avatar: { preset: avatarPreset, color: avatarColor },
    },
  });
  const guestJoinBody = expectStatus(guestJoin, 201, 'POST /join/:code anonymous');
  const guestParticipantId = guestJoinBody.data.participant.id;
  check(guestJoinBody.data.participant.section === sessionSectionId, 'join stores the section');

  const reconnect = await request('POST', `/join/${joinCode}/reconnect`, {
    body: { participantToken: studentParticipantToken },
  });
  const reconnectBody = expectStatus(reconnect, 200, 'POST /join/:code/reconnect');
  check(
    reconnectBody.data.participant.id === studentParticipantId,
    'reconnect returns the existing participant'
  );
  check(
    reconnectBody.data.participant.participantToken === studentParticipantToken,
    'reconnect returns the same participant token'
  );

  const joinWithToken = await request('POST', `/join/${joinCode}`, {
    body: { participantToken: studentParticipantToken },
  });
  const joinWithTokenBody = expectStatus(joinWithToken, 201, 'POST /join/:code with participantToken');
  check(
    joinWithTokenBody.data.participant.id === studentParticipantId,
    'join with a token reconnects the participant'
  );

  const invalidReconnect = await request('POST', `/join/${joinCode}/reconnect`, {
    body: { participantToken: 'a'.repeat(64) },
  });
  expectStatus(invalidReconnect, 401, 'reconnect rejects an invalid token');

  const getLobby = await request('GET', `/sessions/${sessionId}/lobby`, { token: tokenTeacher });
  const getLobbyBody = expectStatus(getLobby, 200, 'GET /sessions/:id/lobby');
  check(getLobbyBody.data.session.participants.length === 2, 'lobby lists active participants');
  check(
    getLobbyBody.data.session.participants.every(
      (participant) => participant.avatar && participant.avatar.preset
    ),
    'lobby includes participant avatars'
  );
  check(!hasKeyDeep(getLobbyBody, 'participantToken'), 'lobby does not expose participant tokens');
  check(!hasKeyDeep(getLobbyBody, 'tokenHash'), 'lobby does not expose token hashes');

  const assistantLobby = await request('GET', `/sessions/${sessionId}/lobby`, {
    token: tokenAssistant,
  });
  expectStatus(assistantLobby, 200, 'assistant can read the session lobby');

  const kickParticipant = await request(
    'DELETE',
    `/sessions/${sessionId}/participants/${guestParticipantId}`,
    { token: tokenTeacher }
  );
  expectStatus(kickParticipant, 200, 'DELETE /sessions/:id/participants/:participantId');

  const lobbyAfterKick = await request('GET', `/sessions/${sessionId}/lobby`, {
    token: tokenTeacher,
  });
  const lobbyAfterKickBody = expectStatus(lobbyAfterKick, 200, 'GET lobby after kick');
  check(lobbyAfterKickBody.data.session.participants.length === 1, 'kicked participant leaves the lobby');

  const kickedReconnect = await request('POST', `/join/${joinCode}/reconnect`, {
    body: { participantToken: guestJoinBody.data.participant.participantToken },
  });
  expectStatus(kickedReconnect, 403, 'kicked participant cannot reconnect');

  const kickedNicknameJoin = await request('POST', `/join/${joinCode}`, {
    body: { nickname: `Guest ${suffix}` },
  });
  expectStatus(kickedNicknameJoin, 409, 'kicked nickname remains reserved');

  const kickAgain = await request(
    'DELETE',
    `/sessions/${sessionId}/participants/${guestParticipantId}`,
    { token: tokenTeacher }
  );
  expectStatus(kickAgain, 409, 'participant cannot be kicked twice');

  const crossOrgKick = await request(
    'DELETE',
    `/sessions/${sessionId}/participants/${studentParticipantId}`,
    { token: tokenB }
  );
  expectStatus(crossOrgKick, 404, 'cross-organization kick is blocked');

  const assistantKick = await request(
    'DELETE',
    `/sessions/${sessionId}/participants/${studentParticipantId}`,
    { token: tokenAssistant }
  );
  expectStatus(assistantKick, 403, 'assistant cannot kick participants');

  const invalidJoinLock = await request('PATCH', `/sessions/${sessionId}/join-lock`, {
    token: tokenTeacher,
    body: { joinOpen: 'yes' },
  });
  expectValidationError(invalidJoinLock, 'join-lock requires a boolean');

  const closeJoin = await request('PATCH', `/sessions/${sessionId}/join-lock`, {
    token: tokenTeacher,
    body: { joinOpen: false },
  });
  const closeJoinBody = expectStatus(closeJoin, 200, 'PATCH /sessions/:id/join-lock close');
  check(closeJoinBody.data.session.joinOpen === false, 'joining can be closed');

  const joinClosed = await request('POST', `/join/${joinCode}`, {
    body: { nickname: `Closed ${suffix}` },
  });
  expectStatus(joinClosed, 403, 'join is blocked when the lobby is closed');

  const reopenJoin = await request('PATCH', `/sessions/${sessionId}/join-lock`, {
    token: tokenTeacher,
    body: { joinOpen: true },
  });
  const reopenJoinBody = expectStatus(reopenJoin, 200, 'PATCH /sessions/:id/join-lock reopen');
  check(reopenJoinBody.data.session.joinOpen === true, 'joining can be reopened');

  const lateJoin = await request('POST', `/join/${joinCode}`, {
    body: { nickname: `Late ${suffix}` },
  });
  const lateJoinBody = expectStatus(lateJoin, 201, 'join succeeds after reopening');
  const lateParticipantId = lateJoinBody.data.participant.id;

  const startSession = await request('POST', `/sessions/${sessionId}/start`, {
    token: tokenTeacher,
  });
  const startSessionBody = expectStatus(startSession, 200, 'POST /sessions/:id/start');
  check(startSessionBody.data.session.status === 'LIVE', 'session becomes LIVE');
  check(Boolean(startSessionBody.data.session.startedAt), 'startedAt is recorded');
  check(startSessionBody.data.session.joinOpen === false, 'starting closes joining');

  const startAgain = await request('POST', `/sessions/${sessionId}/start`, {
    token: tokenTeacher,
  });
  expectStatus(startAgain, 409, 'session cannot start twice');

  const joinStartedClosed = await request('POST', `/join/${joinCode}`, {
    body: { nickname: `Live Closed ${suffix}` },
  });
  expectStatus(joinStartedClosed, 403, 'join is blocked while live joining is closed');

  const reopenLiveJoin = await request('PATCH', `/sessions/${sessionId}/join-lock`, {
    token: tokenTeacher,
    body: { joinOpen: true },
  });
  expectStatus(reopenLiveJoin, 200, 'live session joining can be reopened');

  const liveJoin = await request('POST', `/join/${joinCode}`, {
    body: { nickname: `Live ${suffix}` },
  });
  const liveJoinBody = expectStatus(liveJoin, 201, 'late join succeeds in a live session');
  const liveParticipantId = liveJoinBody.data.participant.id;

  const pauseSession = await request('POST', `/sessions/${sessionId}/pause`, {
    token: tokenTeacher,
  });
  const pauseSessionBody = expectStatus(pauseSession, 200, 'POST /sessions/:id/pause');
  check(pauseSessionBody.data.session.status === 'PAUSED', 'session becomes PAUSED');

  const joinPaused = await request('POST', `/join/${joinCode}`, {
    body: { nickname: `Paused ${suffix}` },
  });
  expectStatus(joinPaused, 403, 'join is blocked while the session is paused');

  const pauseAgain = await request('POST', `/sessions/${sessionId}/pause`, {
    token: tokenTeacher,
  });
  expectStatus(pauseAgain, 409, 'session cannot pause twice');

  const resumeSession = await request('POST', `/sessions/${sessionId}/resume`, {
    token: tokenTeacher,
  });
  const resumeSessionBody = expectStatus(resumeSession, 200, 'POST /sessions/:id/resume');
  check(resumeSessionBody.data.session.status === 'LIVE', 'session resumes to LIVE');

  const resumeAgain = await request('POST', `/sessions/${sessionId}/resume`, {
    token: tokenTeacher,
  });
  expectStatus(resumeAgain, 409, 'session cannot resume twice');

  const finishSession = await request('POST', `/sessions/${sessionId}/finish`, {
    token: tokenTeacher,
  });
  const finishSessionBody = expectStatus(finishSession, 200, 'POST /sessions/:id/finish');
  check(finishSessionBody.data.session.status === 'FINISHED', 'session becomes FINISHED');
  check(Boolean(finishSessionBody.data.session.endedAt), 'endedAt is recorded');
  check(finishSessionBody.data.session.joinOpen === false, 'finishing closes joining');

  const finishAgain = await request('POST', `/sessions/${sessionId}/finish`, {
    token: tokenTeacher,
  });
  expectStatus(finishAgain, 409, 'session cannot finish twice');

  const joinFinished = await request('POST', `/join/${joinCode}`, {
    body: { nickname: `Finished ${suffix}` },
  });
  expectStatus(joinFinished, 403, 'finished session cannot be joined');

  const lockFinished = await request('PATCH', `/sessions/${sessionId}/join-lock`, {
    token: tokenTeacher,
    body: { joinOpen: true },
  });
  expectStatus(lockFinished, 409, 'finished session joining cannot be reopened');

  const finishedDetail = await request('GET', `/sessions/${sessionId}`, { token: tokenTeacher });
  const finishedDetailBody = expectStatus(finishedDetail, 200, 'GET finished session');
  check(finishedDetailBody.data.session.status === 'FINISHED', 'finished session detail is FINISHED');

  const finishedList = await request('GET', '/sessions?status=FINISHED', { token: tokenA });
  const finishedListBody = expectStatus(finishedList, 200, 'GET /sessions?status=FINISHED');
  check(
    finishedListBody.data.sessions.some((session) => session.id === sessionId),
    'finished status filter includes the session'
  );

  const invalidSessionId = await request('GET', '/sessions/not-an-object-id', { token: tokenA });
  expectStatus(invalidSessionId, 400, 'GET /sessions/:id invalid id');

  const missingSession = await request('GET', '/sessions/64b000000000000000000000', {
    token: tokenA,
  });
  expectStatus(missingSession, 404, 'GET /sessions/:id not found');

  const invalidParticipantId = await request(
    'DELETE',
    `/sessions/${session2Id}/participants/not-an-object-id`,
    { token: tokenA }
  );
  expectStatus(invalidParticipantId, 400, 'DELETE participant invalid id');

  await runPhase5Tests({
    suffix,
    tokenTeacher,
    tokenAssistant,
    tokenB,
    orgAId,
    teacherId,
  });

  await runPhase6Tests({
    suffix,
    tokenTeacher,
    tokenAssistant,
    orgAId,
    teacherId,
  });

  await runPhase7Tests({
    suffix,
    tokenA,
    tokenB,
    tokenTeacher,
    tokenAssistant,
    tokenAdmin,
    orgAId,
    orgBId,
    ownerBId: createOrgBBody.data.owner.id,
    teacherId,
  });

  await runPhase8Tests({
    suffix,
    tokenA,
    tokenB,
    tokenTeacher,
    tokenAssistant,
    tokenAdmin,
    orgAId,
    orgBId,
    teacherId,
  });

  await runPhase9E2ETests({ suffix });

  const deleteTeacher = await request('DELETE', `/organization/members/${teacherId}`, {
    token: tokenA,
  });
  expectStatus(deleteTeacher, 200, 'DELETE /organization/members/:id');

  const deletedTeacherLogin = await request('POST', '/auth/login', {
    body: { email: teacherEmail, password: memberPassword },
  });
  expectStatus(deletedTeacherLogin, 401, 'deleted member account can no longer log in');

  const deleteOwner = await request('DELETE', `/organization/members/${ownerAId}`, {
    token: tokenA,
  });
  expectStatus(deleteOwner, 403, 'organization owner cannot be deleted');

  const deleteAssistant = await request('DELETE', `/organization/members/${assistantId}`, {
    token: tokenA,
  });
  expectStatus(deleteAssistant, 200, 'owner can delete an assistant');

  const membersAfterDelete = await request('GET', '/organization/members', { token: tokenA });
  const membersAfterDeleteBody = expectStatus(
    membersAfterDelete,
    200,
    'GET /organization/members after deletion'
  );
  check(membersAfterDeleteBody.data.members.length === 1, 'only the owner remains in organization A');

  const missingRoute = await request('GET', '/does-not-exist');
  expectStatus(missingRoute, 404, 'unknown route returns 404');

  const invalidJson = await request('POST', '/auth/login', { rawBody: '{bad json' });
  expectStatus(invalidJson, 400, 'invalid JSON body returns 400');

  const oversizedBody = await request('POST', '/auth/login', {
    rawBody: JSON.stringify({
      email: 'oversized@example.com',
      password: 'x'.repeat(1024 * 1024 + 1024),
    }),
  });
  expectStatus(oversizedBody, 413, 'oversized JSON body returns 413');

  // Phase 9 security: login brute-force protection. The limiter keys on
  // IP + email, so exhausting one account must not lock out another.
  const rateLimitEmail = `ratelimit.${suffix}@example.com`;
  let loginRateLimitResponse = null;

  for (let attempt = 0; attempt < 21; attempt += 1) {
    loginRateLimitResponse = await request('POST', '/auth/login', {
      body: { email: rateLimitEmail, password: 'WrongPass123!' },
    });
  }

  expectStatus(
    loginRateLimitResponse,
    429,
    'login rate limit blocks repeated attempts for one account'
  );
  check(
    String(loginRateLimitResponse.body?.message || '').includes(
      'Too many login attempts'
    ),
    'login rate limit returns a clear error message'
  );

  const unrelatedLogin = await request('POST', '/auth/login', {
    body: { email: `unrelated.${suffix}@example.com`, password: 'WrongPass123!' },
  });
  expectStatus(
    unrelatedLogin,
    401,
    'login rate limit does not lock out unrelated accounts'
  );

  // Public game-code lookup is unauthenticated, so it is rate limited to slow
  // down code enumeration. Earlier phases already consumed part of the
  // window, so loop until the limiter responds instead of assuming an exact
  // remaining count.
  let joinRateLimited = false;

  for (let attempt = 0; attempt < 160 && !joinRateLimited; attempt += 1) {
    const response = await request('GET', '/join/ZZZZZZ');
    joinRateLimited = response.status === 429;
  }

  check(joinRateLimited, 'public join lookups are rate limited');

  return { orgAId, orgBId };
}

async function main() {
  const suffix = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
  const adminEmail = `admin.${suffix}@example.com`;
  const adminPassword = 'AdminPass123!';

  try {
    await connectDatabase();
    await mongoose.connection.dropDatabase();

    await User.create({
      name: 'Smoke Admin',
      email: adminEmail,
      passwordHash: await hashPassword(adminPassword),
      role: 'ADMIN',
      organization: null,
      status: 'ACTIVE',
    });

    await startServer();
    console.log(
      '\nPhase 0 + Phase 1 + Phase 2 + Phase 3 + Phase 4 + Phase 5 + Phase 6 + Phase 7 + Phase 8 + Phase 9 + provisioning smoke tests\n'
    );
    await runTests(adminEmail, adminPassword);
    console.log(`\nAll ${passed} checks passed.\n`);
  } catch (error) {
    console.error(`\nSmoke test failed: ${error.message}`);
    if (serverOutput) {
      console.error(`\nServer output:\n${serverOutput}`);
    }
    process.exitCode = 1;
  } finally {
    console.log('Cleaning up: stopping test server...');
    await stopServer();
    console.log('Cleaning up: dropping test database...');
    await mongoose.connection.dropDatabase().catch(() => {});
    console.log('Cleaning up: disconnecting...');
    await disconnectDatabase().catch(() => {});
    console.log('Cleanup complete.');
    process.exit(process.exitCode || 0);
  }
}

main();
