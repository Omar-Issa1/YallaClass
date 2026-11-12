const Organization = require('../../models/organization.model');
const Section = require('../../models/section.model');
const SessionPlayer = require('../../models/session-player.model');
const Student = require('../../models/student.model');
const AppError = require('../../utils/app-error');
const { DEFAULT_AVATAR } = require('../../constants/avatar');
const {
  generateParticipantToken,
  hashParticipantToken,
} = require('../../utils/session-code');
const {
  serializePublicSession,
  serializePublicParticipant,
} = require('../../utils/serializers');
const {
  findSessionByCode,
  getSessionSummary,
} = require('../session/session.service');
const gameEngine = require('../game/game.engine');

async function assertOrganizationActive(organizationId) {
  const organization = await Organization.findById(organizationId).select('status');

  if (!organization) {
    throw new AppError('Organization not found', 404);
  }

  if (organization.status === 'SUSPENDED') {
    throw new AppError('This organization has been suspended', 403);
  }
}

function assertSessionJoinable(session) {
  if (session.status === 'FINISHED') {
    throw new AppError('This session has finished', 403);
  }

  if (!session.joinOpen) {
    throw new AppError('This session is not accepting participants', 403);
  }

  if (session.status === 'PAUSED') {
    throw new AppError('This session is paused', 403);
  }

  if (session.status !== 'LOBBY' && session.status !== 'LIVE') {
    throw new AppError('This session is not accepting participants', 403);
  }
}

async function buildJoinResult(session, participant, participantToken) {
  const summary = await getSessionSummary(session);

  return {
    session: serializePublicSession(session, summary),
    participant: serializePublicParticipant(participant, { participantToken }),
  };
}

async function getPublicSession(joinCode) {
  const session = await findSessionByCode(joinCode);
  await assertOrganizationActive(session.organization);
  const summary = await getSessionSummary(session);

  return serializePublicSession(session, summary);
}

async function reconnectParticipant(joinCode, participantToken) {
  const session = await findSessionByCode(joinCode);
  await assertOrganizationActive(session.organization);
  const tokenHash = hashParticipantToken(participantToken);
  const participant = await SessionPlayer.findOne({
    session: session._id,
    tokenHash,
  });

  if (!participant) {
    throw new AppError('Invalid participant token', 401);
  }

  if (participant.status === 'KICKED') {
    throw new AppError('You were removed from this session', 403);
  }

  participant.lastSeenAt = new Date();
  await participant.save();

  gameEngine.notifyPlayerReconnected(session, participant);

  return buildJoinResult(session, participant, participantToken);
}

async function resolveStudent(session, studentId) {
  const student = await Student.findOne({
    _id: studentId,
    organization: session.organization,
  });

  if (!student) {
    throw new AppError('Student not found', 404);
  }

  return student;
}

async function resolveSection(session, sectionId) {
  const section = await Section.findOne({
    _id: sectionId,
    organization: session.organization,
  });

  if (!section) {
    throw new AppError('Section not found', 404);
  }

  return section;
}

async function joinSession(joinCode, payload) {
  if (payload.participantToken) {
    return reconnectParticipant(joinCode, payload.participantToken);
  }

  const session = await findSessionByCode(joinCode);

  await assertOrganizationActive(session.organization);
  assertSessionJoinable(session);

  const student = payload.studentId
    ? await resolveStudent(session, payload.studentId)
    : null;

  let sectionId = student ? student.section : null;

  if (payload.section) {
    const section = await resolveSection(session, payload.section);
    sectionId = section._id;
  }

  const nickname = (payload.nickname || student?.nickname || student?.name || '').slice(0, 50);

  if (!nickname) {
    throw new AppError('Nickname is required', 400);
  }

  const name = payload.name || student?.name || nickname;
  const avatar = {
    preset: payload.avatar?.preset || student?.avatar?.preset || DEFAULT_AVATAR.preset,
    color: payload.avatar?.color || student?.avatar?.color || DEFAULT_AVATAR.color,
  };
  const nicknameKey = nickname.toLowerCase();

  const nicknameTaken = await SessionPlayer.findOne({
    session: session._id,
    nicknameKey,
  });

  if (nicknameTaken) {
    throw new AppError('Nickname is already taken in this session', 409);
  }

  if (student) {
    const existingStudent = await SessionPlayer.findOne({
      session: session._id,
      student: student._id,
    });

    if (existingStudent) {
      if (existingStudent.status === 'KICKED') {
        throw new AppError('You were removed from this session', 403);
      }

      throw new AppError('This student has already joined this session', 409);
    }
  }

  const participantToken = generateParticipantToken();
  let participant;

  try {
    participant = await SessionPlayer.create({
      session: session._id,
      organization: session.organization,
      student: student ? student._id : null,
      section: sectionId,
      name,
      nickname,
      nicknameKey,
      avatar,
      tokenHash: hashParticipantToken(participantToken),
      status: 'ACTIVE',
      joinedAt: new Date(),
      lastSeenAt: new Date(),
    });
  } catch (error) {
    if (error.code === 11000) {
      if (error.keyPattern?.nicknameKey || error.keyValue?.nicknameKey) {
        throw new AppError('Nickname is already taken in this session', 409);
      }

      if (error.keyPattern?.student || error.keyValue?.student) {
        throw new AppError('This student has already joined this session', 409);
      }

      throw new AppError('Participant already joined this session', 409);
    }

    throw error;
  }

  gameEngine.notifyPlayerJoined(session, participant);

  return buildJoinResult(session, participant, participantToken);
}

module.exports = {
  getPublicSession,
  joinSession,
  reconnectParticipant,
};
