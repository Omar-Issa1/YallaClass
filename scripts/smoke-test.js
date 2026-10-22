const assert = require('node:assert/strict');
const { execFile, spawn } = require('node:child_process');
const { once } = require('node:events');
const path = require('node:path');

const PORT = 4100;
const BASE_URL = `http://127.0.0.1:${PORT}/api`;
const TEST_MONGODB_URI =
  process.env.SMOKE_MONGODB_URI || 'mongodb://127.0.0.1:27017/yalla_class_smoke';
const PROJECT_ROOT = path.resolve(__dirname, '..');

process.env.MONGODB_URI = TEST_MONGODB_URI;
process.env.PORT = String(PORT);
process.env.NODE_ENV = 'test';

const mongoose = require('mongoose');

const { connectDatabase, disconnectDatabase } = require('../src/config/database');
const User = require('../src/models/user.model');
const { hashPassword, verifyPassword } = require('../src/utils/password');

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

  const registerA = await request('POST', '/auth/register', {
    body: {
      name: 'Owner A',
      email: ownerAEmail,
      password,
      organizationName: `Smoke Org A ${suffix}`,
    },
  });
  const registerABody = expectStatus(registerA, 201, 'POST /auth/register (owner A)');
  expectNoPasswordHash(registerA, 'register response');
  check(registerABody.data.user.role === 'OWNER', 'registered user is OWNER');
  check(
    registerABody.data.user.organization === registerABody.data.organization.id,
    'user is linked to the created organization'
  );
  check(
    registerABody.data.organization.owner === registerABody.data.user.id,
    'registered user owns the organization'
  );

  const tokenA = registerABody.data.token;
  const ownerAId = registerABody.data.user.id;
  const orgAId = registerABody.data.organization.id;

  const storedOwner = await User.findOne({ email: ownerAEmail }).select('+passwordHash');
  check(storedOwner.passwordHash !== password, 'password is not stored in plain text');
  check(await verifyPassword(password, storedOwner.passwordHash), 'stored password hash verifies');

  const duplicateEmail = await request('POST', '/auth/register', {
    body: {
      name: 'Another Owner',
      email: ownerAEmail,
      password,
      organizationName: 'Duplicate Org',
    },
  });
  expectStatus(duplicateEmail, 409, 'POST /auth/register duplicate email');

  const invalidRegister = await request('POST', '/auth/register', {
    body: { name: 'A', email: 'not-an-email', password: 'short' },
  });
  expectValidationError(invalidRegister, 'POST /auth/register invalid body');

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

  const registerB = await request('POST', '/auth/register', {
    body: {
      name: 'Owner B',
      email: ownerBEmail,
      password,
      organizationName: `Smoke Org B ${suffix}`,
    },
  });
  const registerBBody = expectStatus(registerB, 201, 'POST /auth/register (owner B)');
  const tokenB = registerBBody.data.token;
  const orgBId = registerBBody.data.organization.id;

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

  const adminLogin = await request('POST', '/auth/login', {
    body: { email: adminEmail, password: adminPassword },
  });
  const adminLoginBody = expectStatus(adminLogin, 200, 'POST /auth/login (admin)');
  const tokenAdmin = adminLoginBody.data.token;
  check(adminLoginBody.data.user.role === 'ADMIN', 'admin login returns ADMIN role');

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

  const suspendSelf = await request('PATCH', `/admin/users/${adminLoginBody.data.user.id}/status`, {
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

  const adminOrgDetail = await request('GET', `/admin/organizations/${orgAId}`, {
    token: tokenAdmin,
  });
  const adminOrgDetailBody = expectStatus(adminOrgDetail, 200, 'admin GET /admin/organizations/:id');
  check(adminOrgDetailBody.data.organization.id === orgAId, 'admin sees the requested organization');

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
    console.log('\nPhase 0 + Phase 1 smoke tests\n');
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
