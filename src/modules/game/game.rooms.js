function sessionRoom(sessionId) {
  return `session:${sessionId}`;
}

function teacherRoom(sessionId) {
  return `session:${sessionId}:teachers`;
}

function playersRoom(sessionId) {
  return `session:${sessionId}:players`;
}

function playerRoom(participantId) {
  return `player:${participantId}`;
}

module.exports = {
  sessionRoom,
  teacherRoom,
  playersRoom,
  playerRoom,
};
