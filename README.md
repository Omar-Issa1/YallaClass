# Yalla Class API

Backend API for **Yalla Class**, a live classroom quiz platform for Arabic/Egyptian classrooms.

**Current status: Phase 0 + Phase 1 + Phase 2 + Phase 3 + Phase 4 + Phase 5 + Phase 6 + Phase 7 + Phase 8 + Phase 9 + Phase 10 complete — Backend MVP.**

Implemented:

- Project foundation (Express, MongoDB/Mongoose, environment config, centralized errors, validation, CORS, logging, health endpoint)
- JWT authentication and password hashing
- Organizations and organization members
- Roles: `OWNER`, `TEACHER`, `ASSISTANT`, `ADMIN`
- Account status: `ACTIVE`, `SUSPENDED`
- SUPER ADMIN (`ADMIN` role) provisioning through the CLI
- SUPER ADMIN organization management, including atomic organization + initial `OWNER` creation
- Strict provisioning: no public `OWNER` registration; `OWNER` creates only `TEACHER`/`ASSISTANT` members
- Admin user/organization management
- Quiz and Question CRUD
- Quiz search, archive/unarchive, duplicate, and automatic question count/estimated duration
- Sections/classes and student roster management
- Student search, section filtering, moving students between sections, and JSON bulk import
- Predefined avatar presets/colors with validation
- Live session creation, game codes, QR-compatible join URLs, and lifecycle transitions
- Session lobby, participant listing, kicking participants, and join open/close controls
- Public student join and reconnect flow with participant tokens
- Organization-level isolation for all quiz, section, student, and session data
- Socket.IO real-time game rooms with separate teacher and player authentication
- Server-authoritative question lifecycle: countdown, question, answer deadline, reveal, explanation, leaderboard, and finish
- Server-side correctness checks, response-time scoring, streaks, total scores, ranks, and final results
- Independent academic `rawScore` and gameplay `gameScore` per participant, with teacher-configurable per-question points
- Frontend-ready session report JSON with `sessionSummary`, `attendance`, `studentResults`, `questionAnalysis`, and `commandStatistics`
- Live leaderboard, per-player answer results, teacher-only answer statistics, and late-player support
- Connect/disconnect/reconnect tracking, kicking during a live game, and automatic rejoin state sync
- Persisted game state and answers with restart recovery and idempotent scoring
- Teacher live controls: reveal, next, skip, pause/resume, finish, join lock, kick, and per-session command/phase settings
- Per-session command switches for `Gift`, `Thief`, and `Rocket` (all disabled by default)
- Gift cards with independent rarity weights and one-time effects
- Thief/Rocket target selection with server-side eligibility checks and 12-second auto-selection
- A single serialized command queue so abilities never run at the same time
- Persisted `SessionCommand` state and `SessionEvent` audit records for command and teacher actions
- Command recovery after reconnect/server restart without duplicate scoring or duplicate card effects
- Materialized session attendance based on actual participation (50% answer threshold by default)
- Session reports with attendance, question analysis, student analysis, academic/game student results, and Gift/Thief/Rocket command logs
- Organization-scoped student attendance history with date/session/quiz/status filters and pagination
- Excel report export with five worksheets (`Session Summary`, `Attendance`, `Student Results`, `Question Analysis`, `Commands`), Arabic-safe text, frozen headers, filters, number/date formats, formula-injection sanitization, and organization-scoped authorization
- In-memory rate limiting for login (per IP + email) and public join lookups (per IP)
- Full end-to-end integration test that provisions a SUPER ADMIN through the CLI, runs a real Socket.IO game, finishes the session, and verifies the exported workbook against the JSON report

Not implemented yet: quiz folders/tags, AI generation, billing, and Excel/CSV file parsing for student import.

---

## Tech Stack

| Layer          | Choice                                      |
| -------------- | ------------------------------------------- |
| Runtime        | Node.js 20+ (tested on Node 24)            |
| Language       | JavaScript (CommonJS)                      |
| Web framework  | Express 5                                  |
| Database       | MongoDB + Mongoose                         |
| Auth           | JWT (`jsonwebtoken`) + `bcryptjs`          |
| Real-time      | Socket.IO 4 (same HTTP server)             |
| Validation     | Zod                                        |
| Excel export   | ExcelJS                                    |
| Other          | `dotenv`, `cors`                           |

No TypeScript, no SQL database, no message queues, no microservices.

---

## Project Structure

```text
src/
  config/
    database.js                  # MongoDB connect/disconnect/status helpers
    env.js                       # Loads and validates .env with Zod
  middlewares/
    auth.middleware.js           # Bearer JWT verification + user loading
    role.middleware.js           # authorizeRoles() and requireOrganization()
    validate.middleware.js       # Zod body/query/params validation + ObjectId param check
    error-handler.middleware.js  # Central error handler
    not-found.middleware.js      # JSON 404 handler
    request-logger.middleware.js # Development request logging
    rate-limit.middleware.js     # In-memory fixed-window limiter for login and public join
  models/
    user.model.js                # Phase 1 user model
    organization.model.js        # Phase 1 organization model
    quiz.model.js                # Phase 2 quiz model
    question.model.js            # Phase 2 question model
    option.model.js              # Embedded question option schema
    section.model.js             # Phase 3 section/class model
    student.model.js             # Phase 3 student roster model
    session.model.js             # Phase 4/5/6 live session, game snapshot/phase state, settings, active command
    session-player.model.js      # Phase 4/5/6 participant, score, streak, card effects, offline state
    answer.model.js              # Phase 5/6 authoritative answer records, bonus/shield flags
    session-command.model.js     # Phase 6 persisted command queue/state
    session-event.model.js       # Phase 6 command and teacher action audit events
    attendance.model.js          # Phase 7 materialized per-session attendance snapshot
    avatar.schema.js             # Shared embedded avatar schema
  constants/
    avatar.js                    # Allowed avatar presets and colors
  modules/
    health/health.routes.js
    auth/
      auth.routes.js
      auth.controller.js
      auth.service.js
      auth.validation.js
    organization/
      organization.routes.js
      organization.controller.js
      organization.service.js
      organization.validation.js
    quiz/
      quiz.routes.js
      quiz.controller.js
      quiz.service.js
      quiz.validation.js
      question.validation.js
    section/
      section.routes.js
      section.controller.js
      section.service.js
      section.validation.js
    student/
      student.routes.js
      student.controller.js
      student.service.js
      student.validation.js
    avatar/
      avatar.routes.js
      avatar.controller.js
    session/
      session.routes.js
      session.controller.js
      session.service.js
      session.validation.js
    join/
      join.routes.js
      join.controller.js
      join.service.js
      join.validation.js
    game/
      game.constants.js          # Game states, phase/command defaults, cards, error codes
      game.errors.js             # Game error helpers + socket error normalization
      game.rooms.js              # Session/teacher/player room names
      game.serializers.js        # Safe question and leaderboard payloads
      game.engine.js             # Authoritative phase engine, scoring, leaderboard, controls, recovery
      game.commands.js           # Command queue, card effects, eligibility, target timeouts, events
      game.socket.js             # Socket.IO auth, rooms, event handlers
    attendance/
      attendance.controller.js   # Attendance, report, Excel export, and student-history handlers
      attendance.service.js      # Finalization, live summaries, reports, export, history aggregation
      attendance.serializers.js  # Attendance/report/command-log output shapes
      attendance.validation.js   # Section/status/date/session/quiz/pagination query schemas
      attendance.excel.js        # ExcelJS workbook builder, formatting, sanitization, filename
    admin/
      admin.routes.js
      admin.controller.js
      admin.service.js
      admin.validation.js
  utils/
    api-response.js              # Consistent success response helper
    app-error.js                 # Operational error class
    async-handler.js             # Async controller wrapper
    password.js                  # bcrypt hash/verify helpers
    serializers.js               # Safe user/organization/section/student/session output
    session-code.js              # Game code, join URL, participant token helpers
    token.js                     # JWT sign/verify helpers
  app.js                         # Express app (no listen)
  server.js                      # Entry point: connect DB, HTTP + Socket.IO server, recovery, shutdown
scripts/
  create-admin.js                # Creates a platform ADMIN account
  smoke-test.js                  # End-to-end API verification
```

The feature-module layout (`routes -> controller -> service -> model`) is used by the REST modules; the game engine and command queue live in `src/modules/game/` and are shared by REST lifecycle/control endpoints and Socket.IO events.

Repository note: `quiz`, `question`, `option`, `section`, `student`, `session`, `session-player`, `answer`, `session-command`, `session-event`, and `attendance` are all active models. `answer` is loaded by the game engine; `session-command` and `session-event` are used only by the Phase 6 command/audit layer; `attendance` is written by the Phase 7 finalization layer and read by the attendance, report, and student-history endpoints.

---

## Setup

### Requirements

- Node.js 20+
- MongoDB running locally (default: `mongodb://127.0.0.1:27017`)

### 1. Install dependencies

```bash
npm install
```

### 2. Configure environment variables

Copy the example file:

```powershell
Copy-Item .env.example .env
```

Then edit `.env`. Generate a strong JWT secret, for example:

```powershell
[Convert]::ToBase64String([Security.Cryptography.RandomNumberGenerator]::GetBytes(48))
```

| Variable         | Required | Default                                  | Description |
| ---------------- | -------- | ---------------------------------------- | ----------- |
| `NODE_ENV`       | No       | `development`                            | `development`, `test`, or `production` |
| `PORT`           | No       | `4000`                                   | HTTP port |
| `MONGODB_URI`    | Yes      | -                                        | MongoDB connection string |
| `JWT_SECRET`     | Yes      | -                                        | Signing secret, at least 32 characters |
| `JWT_EXPIRES_IN` | No       | `7d`                                     | JWT lifetime |
| `CORS_ORIGIN`    | No       | `*`                                      | `*` or comma-separated allowed origins (also used for Socket.IO CORS) |
| `JOIN_BASE_URL`  | No       | `http://localhost:3000/join`             | Frontend base URL used to build QR-compatible join links |
| `GAME_COUNTDOWN_MS` | No    | `3000`                                   | Default countdown duration before the first question |
| `GAME_REVEAL_MS` | No       | `5000`                                   | Default correct-answer reveal duration |
| `GAME_EXPLANATION_MS` | No   | `5000`                                   | Default explanation duration |
| `GAME_POINTS_MS` | No       | `3000`                                   | Default points phase duration |
| `GAME_LEADERBOARD_MS` | No   | `5000`                                   | Default leaderboard duration |
| `GAME_PHONE_LEADERBOARD_MS` | No | `3000`                              | Default phone leaderboard duration |
| `COMMAND_SELECTION_TIMEOUT_MS` | No | `12000`                           | Thief/Rocket target-selection timeout |
| `COMMAND_THIEF_CHANCE` | No   | `0.35`                                   | Probability that a streak-1 correct answer triggers Thief (`0`-`1`) |
| `AUTH_RATE_LIMIT_WINDOW_MS` | No | `900000`                              | Login rate-limit window (15 minutes) |
| `AUTH_RATE_LIMIT_MAX` | No   | `20`                                     | Maximum login attempts per IP + email inside the window |
| `JOIN_RATE_LIMIT_WINDOW_MS` | No | `60000`                              | Public join rate-limit window (1 minute) |
| `JOIN_RATE_LIMIT_MAX` | No   | `120`                                    | Maximum public join requests per IP inside the window |

`.env` is git-ignored. Never commit real secrets.

### 3. Start the server

```bash
npm run dev    # auto-restart with node --watch
# or
npm start
```

Expected output:

```text
MongoDB connected: 127.0.0.1/yalla_class
Yalla Class API is running on http://localhost:4000
```

### 4. Verify

```bash
curl http://localhost:4000/api/health
```

```json
{
  "success": true,
  "message": "Yalla Class API is running",
  "database": "connected"
}
```

---

## NPM Scripts

| Script                | Purpose |
| --------------------- | ------- |
| `npm run dev`         | Development server with auto-restart |
| `npm start`           | Normal server start |
| `npm run create-admin`| Create a platform-level SUPER ADMIN (`ADMIN` role) account |
| `npm run test:smoke`  | Run the end-to-end API smoke test |

---

## Roles and Account Model

Platform accounts use these roles:

| Role        | Scope               | Capabilities |
| ----------- | ------------------- | ------------ |
| `OWNER`     | Organization        | Read/rename organization, manage `TEACHER`/`ASSISTANT` members, manage quizzes/questions/sections/students/sessions, control live games, read attendance/reports/student history |
| `TEACHER`   | Organization        | Read organization/members, manage quizzes/questions/sections/students/sessions, control live games, read attendance/reports/student history |
| `ASSISTANT` | Organization        | Read organization/members, quizzes/questions/sections/students/sessions, attendance/reports/student history; observe live games but cannot control them |
| `ADMIN`     | Platform (SUPER ADMIN) | Create/update/suspend organizations, create an organization with its initial `OWNER`, view users, suspend/reactivate users |

`PLAYER` is **not** a platform account. Students are stored as roster records (`Student` model) and do not receive logins. Session participants are stored as `SessionPlayer` records and receive a per-session participant token, not a JWT. Do not create PLAYER users through these endpoints.

Every non-admin user belongs to exactly one organization. The authenticated user's `organization` field is the source of truth for tenant isolation.

---

## API Conventions

Base URL:

```text
http://localhost:4000/api
```

Protected endpoints expect:

```http
Authorization: Bearer <JWT>
```

Success format:

```json
{
  "success": true,
  "message": "...",
  "data": {}
}
```

Error format:

```json
{
  "success": false,
  "message": "...",
  "errors": [
    { "field": "email", "message": "Please provide a valid email address" }
  ]
}
```

`errors` is included for validation failures. A stack trace is included only in development for unexpected errors.

Common status codes:

| Code | Meaning |
| ---- | ------- |
| `200` | Success |
| `201` | Created |
| `400` | Invalid input / invalid ObjectId |
| `401` | Missing/invalid token, wrong credentials |
| `403` | Wrong role, suspended account, owner-protected action, closed/finished session join |
| `404` | Resource not found (also used for cross-organization access) |
| `409` | Duplicate email/section name, section with students, archived quiz modification, invalid session transition, duplicate nickname/participant |
| `500` | Unexpected server error |

---

## Endpoints

### Health

#### `GET /api/health`

- Authentication: No
- Role: Public

Response `200`:

```json
{
  "success": true,
  "message": "Yalla Class API is running",
  "database": "connected"
}
```

---

## Authentication

### Public registration is not available

`POST /api/auth/register` has been removed and returns `404`. `OWNER` accounts cannot be self-registered.

Account provisioning flow:

```text
SUPER ADMIN (ADMIN role)
  ↓ CLI: npm run create-admin
  ↓ POST /api/admin/organizations
Organization + initial OWNER (name, email, temporary password)
  ↓ OWNER logs in
  ↓ POST /api/organization/members
TEACHER / ASSISTANT accounts
```

- Only a SUPER ADMIN (`ADMIN` role) can create an organization and its initial `OWNER`.
- `OWNER` can create and manage only `TEACHER` and `ASSISTANT` members.
- `ADMIN` is a platform role and cannot belong to an organization.
- Students/players remain accountless and join sessions with a game code.

---

### `POST /api/auth/login`

- Authentication: No
- Role: Public

Request body:

```json
{
  "email": "omar@example.com",
  "password": "password123"
}
```

Response `200`:

```json
{
  "success": true,
  "message": "Login successful",
  "data": {
    "token": "<jwt>",
    "user": {
      "id": "<userId>",
      "name": "Omar Ahmed",
      "email": "omar@example.com",
      "role": "OWNER",
      "status": "ACTIVE",
      "organization": "<organizationId>",
      "avatar": "",
      "createdAt": "2026-01-01T00:00:00.000Z",
      "updatedAt": "2026-01-01T00:00:00.000Z"
    }
  }
}
```

Errors:

- `401` invalid email or password
- `403` account is suspended

---

### `GET /api/auth/me`

- Authentication: Yes
- Role: Any authenticated user

Response `200`:

```json
{
  "success": true,
  "message": "Current user",
  "data": {
    "user": {
      "id": "<userId>",
      "name": "Omar Ahmed",
      "email": "omar@example.com",
      "role": "OWNER",
      "status": "ACTIVE",
      "organization": "<organizationId>",
      "avatar": "",
      "createdAt": "2026-01-01T00:00:00.000Z",
      "updatedAt": "2026-01-01T00:00:00.000Z"
    }
  }
}
```

Errors: `401` missing/invalid token, `403` suspended account.

---

### `POST /api/auth/logout`

- Authentication: No (JWT is stateless)
- Role: Public

Response `200`:

```json
{
  "success": true,
  "message": "Logged out. Discard the JWT on the client."
}
```

**Limitation:** this project uses stateless JWTs. The server does not keep a token blacklist, so logout only means the client discards the token. A copied token stays valid until `JWT_EXPIRES_IN` expires. This is intentional for the university MVP.

---

## Organization

All organization endpoints require authentication and a user that belongs to an organization. `ADMIN` accounts cannot use these endpoints.

### `GET /api/organization`

- Authentication: Yes
- Role: `OWNER`, `TEACHER`, or `ASSISTANT`
- Returns only the authenticated user's organization

Response `200`:

```json
{
  "success": true,
  "message": "Organization retrieved successfully",
  "data": {
    "organization": {
      "id": "<organizationId>",
      "name": "My Classroom",
      "owner": "<ownerId>",
      "createdAt": "2026-01-01T00:00:00.000Z",
      "updatedAt": "2026-01-01T00:00:00.000Z"
    }
  }
}
```

---

### `PATCH /api/organization`

Updates the organization name.

- Authentication: Yes
- Role: `OWNER` only
- Owner, ID, and security fields cannot be changed here. Unknown fields are rejected.

Request body:

```json
{
  "name": "My Updated Classroom"
}
```

Response `200`:

```json
{
  "success": true,
  "message": "Organization updated successfully",
  "data": {
    "organization": {
      "id": "<organizationId>",
      "name": "My Updated Classroom",
      "owner": "<ownerId>",
      "createdAt": "2026-01-01T00:00:00.000Z",
      "updatedAt": "2026-01-01T00:00:00.000Z"
    }
  }
}
```

Errors: `400` validation, `403` not owner.

---

### `GET /api/organization/members`

- Authentication: Yes
- Role: `OWNER`, `TEACHER`, or `ASSISTANT`
- Returns only users in the authenticated user's organization

Response `200`:

```json
{
  "success": true,
  "message": "Members retrieved successfully",
  "data": {
    "members": [
      {
        "id": "<userId>",
        "name": "Omar Ahmed",
        "email": "omar@example.com",
        "role": "OWNER",
        "status": "ACTIVE",
        "organization": "<organizationId>",
        "avatar": "",
        "createdAt": "2026-01-01T00:00:00.000Z",
        "updatedAt": "2026-01-01T00:00:00.000Z"
      }
    ]
  }
}
```

---

### `POST /api/organization/members`

Creates a `TEACHER` or `ASSISTANT` account directly in the owner's organization.

- Authentication: Yes
- Role: `OWNER` only
- `OWNER` and `ADMIN` roles are rejected
- No invitation email is sent. The owner provides a temporary password, which the member can change in a future phase.

Request body:

```json
{
  "name": "Mona Ali",
  "email": "mona@example.com",
  "password": "temporary123",
  "role": "TEACHER"
}
```

Response `201`:

```json
{
  "success": true,
  "message": "Member created successfully",
  "data": {
    "member": {
      "id": "<memberId>",
      "name": "Mona Ali",
      "email": "mona@example.com",
      "role": "TEACHER",
      "status": "ACTIVE",
      "organization": "<organizationId>",
      "avatar": "",
      "createdAt": "2026-01-01T00:00:00.000Z",
      "updatedAt": "2026-01-01T00:00:00.000Z"
    }
  }
}
```

Errors: `400` validation, `403` not owner, `409` duplicate email.

---

### `PATCH /api/organization/members/:id`

Updates a member's `name`, `role` (`TEACHER`/`ASSISTANT`), or `status` (`ACTIVE`/`SUSPENDED`).

- Authentication: Yes
- Role: `OWNER` only
- Member must belong to the owner's organization
- The organization owner cannot be modified through this endpoint
- `ADMIN` and `OWNER` roles are rejected

Request body (at least one field):

```json
{
  "name": "Mona Ahmed",
  "role": "TEACHER",
  "status": "ACTIVE"
}
```

Response `200`:

```json
{
  "success": true,
  "message": "Member updated successfully",
  "data": {
    "member": {
      "id": "<memberId>",
      "name": "Mona Ahmed",
      "email": "mona@example.com",
      "role": "TEACHER",
      "status": "ACTIVE",
      "organization": "<organizationId>",
      "avatar": "",
      "createdAt": "2026-01-01T00:00:00.000Z",
      "updatedAt": "2026-01-01T00:00:00.000Z"
    }
  }
}
```

Errors: `400` validation, `403` not owner/target is owner, `404` member not in this organization.

---

### `DELETE /api/organization/members/:id`

Removes a teacher or assistant from the organization.

- Authentication: Yes
- Role: `OWNER` only
- The organization owner cannot be deleted
- In Phase 1, removal deletes the member's account (there are no other organizations or owned data yet)

Response `200`:

```json
{
  "success": true,
  "message": "Member removed successfully",
  "data": {
    "id": "<memberId>"
  }
}
```

Errors: `400` invalid id, `403` not owner/target is owner, `404` member not in this organization.

---

## Quizzes and Questions (Phase 2)

All quiz/question endpoints require authentication and an organization.

- Read roles: `OWNER`, `TEACHER`, `ASSISTANT`
- Write roles: `OWNER`, `TEACHER`
- `ADMIN` accounts cannot access organization quiz data
- Every query is scoped to the authenticated user's `organization`; cross-organization IDs return `404`

A quiz summary has this shape:

```json
{
  "id": "<quizId>",
  "title": "Algebra Basics",
  "description": "A short algebra quiz",
  "organization": "<organizationId>",
  "createdBy": "<userId>",
  "status": "ACTIVE",
  "archivedAt": null,
  "questionCount": 2,
  "estimatedDurationSec": 35,
  "createdAt": "2026-01-01T00:00:00.000Z",
  "updatedAt": "2026-01-01T00:00:00.000Z"
}
```

`questionCount` and `estimatedDurationSec` are calculated from the quiz's questions. Estimated duration is the sum of each question's `timeLimitSec`.

A question has this shape:

```json
{
  "id": "<questionId>",
  "quiz": "<quizId>",
  "text": "What is 2 + 2?",
  "points": 1000,
  "timeLimitSec": 15,
  "order": 0,
  "options": [
    { "id": "<optionId>", "text": "3", "isCorrect": false },
    { "id": "<optionId>", "text": "4", "isCorrect": true },
    { "id": "<optionId>", "text": "5", "isCorrect": false }
  ],
  "createdAt": "2026-01-01T00:00:00.000Z",
  "updatedAt": "2026-01-01T00:00:00.000Z"
}
```

`isCorrect` is visible to organization staff for editing. Future player-facing endpoints must not expose it.

---

### `GET /api/quizzes`

- Authentication: Yes
- Role: `OWNER`, `TEACHER`, `ASSISTANT`
- Query parameters:

| Parameter | Values | Default | Description |
| --------- | ------ | ------- | ----------- |
| `search` | text, max 100 chars | none | Case-insensitive search in title and description |
| `status` | `ACTIVE`, `ARCHIVED`, `ALL` | `ACTIVE` | Archive filter |

Response `200`:

```json
{
  "success": true,
  "message": "Quizzes retrieved successfully",
  "data": {
    "quizzes": [
      {
        "id": "<quizId>",
        "title": "Algebra Basics",
        "description": "A short algebra quiz",
        "organization": "<organizationId>",
        "createdBy": "<userId>",
        "status": "ACTIVE",
        "archivedAt": null,
        "questionCount": 2,
        "estimatedDurationSec": 35,
        "createdAt": "2026-01-01T00:00:00.000Z",
        "updatedAt": "2026-01-01T00:00:00.000Z"
      }
    ]
  }
}
```

Example:

```http
GET /api/quizzes?search=algebra&status=ACTIVE
```

---

### `POST /api/quizzes`

- Authentication: Yes
- Role: `OWNER`, `TEACHER`
- Organization and creator are taken from the authenticated user

Request body:

```json
{
  "title": "Algebra Basics",
  "description": "A short algebra quiz"
}
```

`title` is required (1-150 characters); `description` is optional (max 1000 characters).

Response `201`:

```json
{
  "success": true,
  "message": "Quiz created successfully",
  "data": {
    "quiz": {
      "id": "<quizId>",
      "title": "Algebra Basics",
      "description": "A short algebra quiz",
      "organization": "<organizationId>",
      "createdBy": "<userId>",
      "status": "ACTIVE",
      "archivedAt": null,
      "questionCount": 0,
      "estimatedDurationSec": 0,
      "createdAt": "2026-01-01T00:00:00.000Z",
      "updatedAt": "2026-01-01T00:00:00.000Z"
    }
  }
}
```

---

### `GET /api/quizzes/:id`

- Authentication: Yes
- Role: `OWNER`, `TEACHER`, `ASSISTANT`
- Returns the quiz summary plus its questions ordered by `order`

Response `200`:

```json
{
  "success": true,
  "message": "Quiz retrieved successfully",
  "data": {
    "quiz": {
      "id": "<quizId>",
      "title": "Algebra Basics",
      "description": "A short algebra quiz",
      "organization": "<organizationId>",
      "createdBy": "<userId>",
      "status": "ACTIVE",
      "archivedAt": null,
      "questionCount": 1,
      "estimatedDurationSec": 15,
      "createdAt": "2026-01-01T00:00:00.000Z",
      "updatedAt": "2026-01-01T00:00:00.000Z",
      "questions": [
        {
          "id": "<questionId>",
          "quiz": "<quizId>",
          "text": "What is 2 + 2?",
          "points": 1000,
          "timeLimitSec": 15,
          "order": 0,
          "options": [
            { "id": "<optionId>", "text": "3", "isCorrect": false },
            { "id": "<optionId>", "text": "4", "isCorrect": true }
          ],
          "createdAt": "2026-01-01T00:00:00.000Z",
          "updatedAt": "2026-01-01T00:00:00.000Z"
        }
      ]
    }
  }
}
```

Errors: `400` invalid id, `404` quiz not found or belongs to another organization.

---

### `PATCH /api/quizzes/:id`

- Authentication: Yes
- Role: `OWNER`, `TEACHER`
- Archived quizzes cannot be modified (`409`)
- At least one field is required

Request body:

```json
{
  "title": "Updated Algebra Basics",
  "description": "Updated description"
}
```

Response `200`: same `data.quiz` summary shape.

---

### `DELETE /api/quizzes/:id`

- Authentication: Yes
- Role: `OWNER`, `TEACHER`
- Permanently deletes the quiz and all of its questions

Response `200`:

```json
{
  "success": true,
  "message": "Quiz deleted successfully",
  "data": {
    "id": "<quizId>"
  }
}
```

---

### `PATCH /api/quizzes/:id/archive`

- Authentication: Yes
- Role: `OWNER`, `TEACHER`
- Sets `status` to `ARCHIVED` and records `archivedAt`
- Archived quizzes are excluded from the default quiz list

Response `200`: same `data.quiz` summary shape with `"status": "ARCHIVED"`.

---

### `PATCH /api/quizzes/:id/unarchive`

- Authentication: Yes
- Role: `OWNER`, `TEACHER`
- Sets `status` back to `ACTIVE` and clears `archivedAt`

Response `200`: same `data.quiz` summary shape with `"status": "ACTIVE"`.

---

### `POST /api/quizzes/:id/duplicate`

- Authentication: Yes
- Role: `OWNER`, `TEACHER`
- Creates a new active quiz titled `"<original title> (Copy)"`
- Copies the description and every question/option
- The authenticated user becomes the new quiz's `createdBy`

Response `201`: same quiz detail shape as `GET /api/quizzes/:id`, including copied questions.

---

### `GET /api/quizzes/:id/questions`

- Authentication: Yes
- Role: `OWNER`, `TEACHER`, `ASSISTANT`

Response `200`:

```json
{
  "success": true,
  "message": "Questions retrieved successfully",
  "data": {
    "questions": []
  }
}
```

Questions are ordered by `order`, then creation time.

---

### `POST /api/quizzes/:id/questions`

- Authentication: Yes
- Role: `OWNER`, `TEACHER`
- Archived quizzes cannot receive questions (`409`)

Request body:

```json
{
  "text": "What is 2 + 2?",
  "points": 1000,
  "timeLimitSec": 15,
  "options": [
    { "text": "3", "isCorrect": false },
    { "text": "4", "isCorrect": true },
    { "text": "5", "isCorrect": false }
  ]
}
```

Rules:

- `text`: required, 1-1000 characters
- `options`: 2-4 options, exactly one must have `isCorrect: true`
- `points`: optional positive integer, 1-10000, default `1000` (base points for the question)
- `timeLimitSec`: optional integer, 5-120, default `10`
- `order`: optional integer >= 0; if omitted, the question is appended

Response `201`:

```json
{
  "success": true,
  "message": "Question created successfully",
  "data": {
    "question": {
      "id": "<questionId>",
      "quiz": "<quizId>",
      "text": "What is 2 + 2?",
      "points": 1000,
      "timeLimitSec": 15,
      "order": 0,
      "options": [
        { "id": "<optionId>", "text": "3", "isCorrect": false },
        { "id": "<optionId>", "text": "4", "isCorrect": true },
        { "id": "<optionId>", "text": "5", "isCorrect": false }
      ],
      "createdAt": "2026-01-01T00:00:00.000Z",
      "updatedAt": "2026-01-01T00:00:00.000Z"
    }
  }
}
```

---

### `GET /api/quizzes/:id/questions/:questionId`

- Authentication: Yes
- Role: `OWNER`, `TEACHER`, `ASSISTANT`

Response `200`: same `data.question` shape shown above.

Errors: `400` invalid id, `404` quiz/question not found or belongs to another organization.

---

### `PATCH /api/quizzes/:id/questions/:questionId`

- Authentication: Yes
- Role: `OWNER`, `TEACHER`
- Archived quizzes cannot be modified (`409`)
- At least one field is required
- If `options` is provided, it replaces the full option list and must contain exactly one correct option

Request body:

```json
{
  "text": "What is 2 + 3?",
  "points": 750,
  "timeLimitSec": 25,
  "options": [
    { "text": "4", "isCorrect": false },
    { "text": "5", "isCorrect": true }
  ]
}
```

Response `200`: same `data.question` shape.

---

### `DELETE /api/quizzes/:id/questions/:questionId`

- Authentication: Yes
- Role: `OWNER`, `TEACHER`
- Archived quizzes cannot be modified (`409`)

Response `200`:

```json
{
  "success": true,
  "message": "Question deleted successfully",
  "data": {
    "id": "<questionId>"
  }
}
```

---

## Sections and Students (Phase 3)

All section and student endpoints require authentication and an organization.

- Read roles: `OWNER`, `TEACHER`, `ASSISTANT`
- Write roles: `OWNER`, `TEACHER`
- `ADMIN` accounts cannot access organization sections or students
- Every query is scoped to the authenticated user's `organization`; cross-organization IDs return `404`
- Students are roster records, **not** platform accounts. They have no email, password, JWT, or `PLAYER` role.

A section summary has this shape:

```json
{
  "id": "<sectionId>",
  "name": "Grade 10 A",
  "description": "First section",
  "organization": "<organizationId>",
  "createdBy": "<userId>",
  "studentCount": 2,
  "createdAt": "2026-01-01T00:00:00.000Z",
  "updatedAt": "2026-01-01T00:00:00.000Z"
}
```

A student has this shape:

```json
{
  "id": "<studentId>",
  "name": "Student One",
  "nickname": "S1",
  "organization": "<organizationId>",
  "section": "<sectionId>",
  "avatar": {
    "preset": "FOX",
    "color": "#3B82F6"
  },
  "createdAt": "2026-01-01T00:00:00.000Z",
  "updatedAt": "2026-01-01T00:00:00.000Z"
}
```

Avatars use a fixed whitelist of presets and colors. Unsupported values are rejected with `400`.

---

### `GET /api/avatars/options`

- Authentication: Yes
- Role: `OWNER`, `TEACHER`, `ASSISTANT`
- Returns the allowed avatar presets, colors, and defaults

Response `200`:

```json
{
  "success": true,
  "message": "Avatar options retrieved successfully",
  "data": {
    "presets": [
      { "id": "FOX", "label": "Fox" },
      { "id": "PANDA", "label": "Panda" }
    ],
    "colors": [
      { "id": "#EF4444", "label": "Red" },
      { "id": "#3B82F6", "label": "Blue" }
    ],
    "default": {
      "preset": "FOX",
      "color": "#3B82F6"
    }
  }
}
```

---

### `GET /api/sections`

- Authentication: Yes
- Role: `OWNER`, `TEACHER`, `ASSISTANT`
- Query parameter `search` (optional, max 100 chars) matches section name or description case-insensitively
- Returns sections ordered by name, each with a calculated `studentCount`

Example:

```http
GET /api/sections?search=grade
```

Response `200`:

```json
{
  "success": true,
  "message": "Sections retrieved successfully",
  "data": {
    "sections": [
      {
        "id": "<sectionId>",
        "name": "Grade 10 A",
        "description": "First section",
        "organization": "<organizationId>",
        "createdBy": "<userId>",
        "studentCount": 2,
        "createdAt": "2026-01-01T00:00:00.000Z",
        "updatedAt": "2026-01-01T00:00:00.000Z"
      }
    ]
  }
}
```

---

### `POST /api/sections`

- Authentication: Yes
- Role: `OWNER`, `TEACHER`
- Organization and creator are taken from the authenticated user
- Section names are unique inside an organization (`409` on duplicates)

Request body:

```json
{
  "name": "Grade 10 A",
  "description": "First section"
}
```

`name` is required (1-100 characters); `description` is optional (max 500 characters).

Response `201`: same `data.section` summary shape, with `studentCount: 0`.

---

### `GET /api/sections/:id`

- Authentication: Yes
- Role: `OWNER`, `TEACHER`, `ASSISTANT`
- Returns the section summary plus its students ordered by name

Response `200`:

```json
{
  "success": true,
  "message": "Section retrieved successfully",
  "data": {
    "section": {
      "id": "<sectionId>",
      "name": "Grade 10 A",
      "description": "First section",
      "organization": "<organizationId>",
      "createdBy": "<userId>",
      "studentCount": 1,
      "createdAt": "2026-01-01T00:00:00.000Z",
      "updatedAt": "2026-01-01T00:00:00.000Z",
      "students": [
        {
          "id": "<studentId>",
          "name": "Student One",
          "nickname": "S1",
          "organization": "<organizationId>",
          "section": "<sectionId>",
          "avatar": { "preset": "FOX", "color": "#3B82F6" },
          "createdAt": "2026-01-01T00:00:00.000Z",
          "updatedAt": "2026-01-01T00:00:00.000Z"
        }
      ]
    }
  }
}
```

Errors: `400` invalid id, `404` section not found or belongs to another organization.

---

### `PATCH /api/sections/:id`

- Authentication: Yes
- Role: `OWNER`, `TEACHER`
- At least one field is required
- Renaming to an existing section name in the same organization returns `409`

Request body:

```json
{
  "name": "Grade 10 Alpha",
  "description": "Updated section"
}
```

Response `200`: same `data.section` summary shape.

---

### `DELETE /api/sections/:id`

- Authentication: Yes
- Role: `OWNER`, `TEACHER`
- A section that still contains students cannot be deleted (`409`). Move or delete its students first.
- Deleting an empty section is permanent

Response `200`:

```json
{
  "success": true,
  "message": "Section deleted successfully",
  "data": {
    "id": "<sectionId>"
  }
}
```

---

### `GET /api/students`

- Authentication: Yes
- Role: `OWNER`, `TEACHER`, `ASSISTANT`
- Query parameters:

| Parameter | Description |
| --------- | ----------- |
| `search` | Case-insensitive match on student name or nickname (max 100 chars) |
| `section` | ObjectId of a section; returns only students in that section |

- Returns students ordered by name

Example:

```http
GET /api/students?section=<sectionId>&search=ali
```

Response `200`:

```json
{
  "success": true,
  "message": "Students retrieved successfully",
  "data": {
    "students": [
      {
        "id": "<studentId>",
        "name": "Student One",
        "nickname": "S1",
        "organization": "<organizationId>",
        "section": "<sectionId>",
        "avatar": { "preset": "FOX", "color": "#3B82F6" },
        "createdAt": "2026-01-01T00:00:00.000Z",
        "updatedAt": "2026-01-01T00:00:00.000Z"
      }
    ]
  }
}
```

---

### `POST /api/students`

- Authentication: Yes
- Role: `OWNER`, `TEACHER`
- The target section must belong to the authenticated user's organization
- The student's organization is taken from the authenticated user

Request body:

```json
{
  "name": "Student One",
  "nickname": "S1",
  "section": "<sectionId>",
  "avatar": {
    "preset": "FOX",
    "color": "#3B82F6"
  }
}
```

Rules:

- `name`: required, 1-80 characters
- `nickname`: optional, max 50 characters, default `""`
- `section`: required ObjectId
- `avatar`: optional; `preset` and `color` must come from `GET /api/avatars/options`
- Missing avatar fields fall back to the default avatar

Response `201`: same `data.student` shape.

---

### `POST /api/students/import`

- Authentication: Yes
- Role: `OWNER`, `TEACHER`
- Imports up to 500 students into one section in a single request
- This endpoint accepts JSON rows; Excel/CSV file parsing is not part of the backend yet

Request body:

```json
{
  "section": "<sectionId>",
  "students": [
    { "name": "Ali Hassan", "nickname": "Ali" },
    {
      "name": "Mona Adel",
      "avatar": { "preset": "PANDA", "color": "#EC4899" }
    }
  ]
}
```

Response `201`:

```json
{
  "success": true,
  "message": "Students imported successfully",
  "data": {
    "importedCount": 2,
    "students": [
      {
        "id": "<studentId>",
        "name": "Ali Hassan",
        "nickname": "Ali",
        "organization": "<organizationId>",
        "section": "<sectionId>",
        "avatar": { "preset": "FOX", "color": "#3B82F6" },
        "createdAt": "2026-01-01T00:00:00.000Z",
        "updatedAt": "2026-01-01T00:00:00.000Z"
      }
    ]
  }
}
```

---

### `GET /api/students/:id`

- Authentication: Yes
- Role: `OWNER`, `TEACHER`, `ASSISTANT`

Response `200`: same `data.student` shape.

Errors: `400` invalid id, `404` student not found or belongs to another organization.

---

### `PATCH /api/students/:id`

- Authentication: Yes
- Role: `OWNER`, `TEACHER`
- At least one field is required
- Providing `section` moves the student to another section in the same organization
- Providing `avatar` updates the preset and/or color

Request body:

```json
{
  "name": "Student One Renamed",
  "nickname": "S1",
  "section": "<sectionId>",
  "avatar": {
    "preset": "LION",
    "color": "#22C55E"
  }
}
```

Response `200`: same `data.student` shape.

---

### `PATCH /api/students/:id/avatar`

- Authentication: Yes
- Role: `OWNER`, `TEACHER`
- Dedicated avatar customization endpoint
- At least one of `preset` or `color` is required
- Values must come from the allowed avatar options

Request body:

```json
{
  "preset": "ROBOT",
  "color": "#8B5CF6"
}
```

Response `200`: same `data.student` shape.

---

### `DELETE /api/students/:id`

- Authentication: Yes
- Role: `OWNER`, `TEACHER`
- Permanently deletes the student roster record

Response `200`:

```json
{
  "success": true,
  "message": "Student deleted successfully",
  "data": {
    "id": "<studentId>"
  }
}
```

---

## Sessions and Joining (Phase 4)

Teacher-facing session endpoints require authentication and an organization.

- Read roles: `OWNER`, `TEACHER`, `ASSISTANT`
- Write roles: `OWNER`, `TEACHER`
- `ADMIN` accounts cannot access organization sessions
- Every session is scoped to the authenticated user's `organization`; cross-organization session IDs return `404`
- Sessions are created from an existing quiz in the same organization. Archived quizzes and quizzes without questions are rejected (`409`).
- The public `/api/join/*` endpoints require no authentication and expose only public session/participant data.

A session has this teacher-facing shape:

```json
{
  "id": "<sessionId>",
  "quiz": {
    "id": "<quizId>",
    "title": "Algebra Basics",
    "description": "A short algebra quiz",
    "questionCount": 2,
    "estimatedDurationSec": 35
  },
  "organization": "<organizationId>",
  "createdBy": "<userId>",
  "joinCode": "AB3K9M",
  "joinUrl": "http://localhost:3000/join/AB3K9M",
  "status": "LOBBY",
  "joinOpen": true,
  "gameState": "IDLE",
  "currentQuestionIndex": -1,
  "totalQuestions": 2,
  "questionProgress": { "current": 0, "total": 2 },
  "phaseStartedAt": null,
  "phaseEndsAt": null,
  "remainingTimeMs": null,
  "commandSettings": {
    "gift": false,
    "thief": false,
    "rocket": false
  },
  "phaseSettings": {
    "revealMs": 5000,
    "explanationMs": 5000,
    "pointsMs": 3000,
    "leaderboardMs": 5000,
    "phoneLeaderboardMs": 3000,
    "showReveal": true,
    "showExplanation": true,
    "showPoints": true,
    "showLeaderboard": true,
    "showPhoneLeaderboard": true
  },
  "activeCommand": null,
  "participantCount": 0,
  "startedAt": null,
  "endedAt": null,
  "createdAt": "2026-01-01T00:00:00.000Z",
  "updatedAt": "2026-01-01T00:00:00.000Z"
}
```

`questionProgress.current` is 1-based while a question is active and `0` before the first question. `commandSettings` and `phaseSettings` are per-session; the environment `GAME_*` values are only defaults. `activeCommand` is the id of the `SessionCommand` currently `PROCESSING` or `AWAITING_TARGET`.

Game codes are 6 characters from a safe alphabet (`ABCDEFGHJKMNPQRSTUVWXYZ23456789`) and are unique globally. Join URLs are built from `JOIN_BASE_URL` and are suitable for QR encoding.

### Session lifecycle

```text
LOBBY --start--> LIVE --pause--> PAUSED --resume--> LIVE --finish--> FINISHED
   \______________________________________________________finish_______/
```

- `POST /api/sessions/:id/start` only works from `LOBBY`; it records `startedAt`, closes joining, snapshots the quiz questions, and starts the game countdown.
- `POST /api/sessions/:id/pause` only works from `LIVE`; it pauses the current phase timer and stores `remainingTimeMs`.
- `POST /api/sessions/:id/resume` only works from `PAUSED`; it restores the remaining phase time and reschedules the timer.
- `POST /api/sessions/:id/finish` works from `LOBBY`, `LIVE`, or `PAUSED`; it records `endedAt`, closes joining, stops timers, and persists final ranks.
- `FINISHED` sessions are immutable and cannot be started, paused, resumed, or reopened.
- Invalid transitions return `409`.
- The same transitions are available over Socket.IO as `game:start`, `game:pause`, `game:resume`, and `game:finish`.

---

### `GET /api/sessions`

- Authentication: Yes
- Role: `OWNER`, `TEACHER`, `ASSISTANT`
- Returns sessions ordered newest first, each with a calculated `participantCount`

Query parameters:

| Parameter | Description |
| --------- | ----------- |
| `status` | `LOBBY`, `LIVE`, `PAUSED`, or `FINISHED` |
| `quiz` | ObjectId of a quiz in the organization |
| `search` | Case-insensitive match on the quiz title (max 100 chars) |

Example:

```http
GET /api/sessions?status=LOBBY&search=algebra
```

Response `200`:

```json
{
  "success": true,
  "message": "Sessions retrieved successfully",
  "data": {
    "sessions": []
  }
}
```

---

### `POST /api/sessions`

- Authentication: Yes
- Role: `OWNER`, `TEACHER`
- Creates a session in `LOBBY` with joining open
- The quiz must belong to the authenticated user's organization, be `ACTIVE`, and contain at least one question

Request body:

```json
{
  "quiz": "<quizId>"
}
```

Response `201`: same `data.session` shape shown above.

Errors: `400` invalid quiz id, `404` quiz not found or in another organization, `409` archived quiz or quiz without questions.

---

### `GET /api/sessions/:id`

- Authentication: Yes
- Role: `OWNER`, `TEACHER`, `ASSISTANT`
- Returns the session summary and quiz statistics

Response `200`: same `data.session` shape shown above.

Errors: `400` invalid id, `404` session not found or in another organization.

---

### `GET /api/sessions/:id/lobby`

- Authentication: Yes
- Role: `OWNER`, `TEACHER`, `ASSISTANT`
- Returns the session summary plus active participants ordered by join time
- Kicked participants are excluded
- Participant tokens and token hashes are never returned

Response `200`:

```json
{
  "success": true,
  "message": "Session lobby retrieved successfully",
  "data": {
    "session": {
      "id": "<sessionId>",
      "status": "LOBBY",
      "joinCode": "AB3K9M",
      "joinOpen": true,
      "participantCount": 1,
      "participants": [
        {
          "id": "<participantId>",
          "name": "Student One",
          "nickname": "S1",
          "student": "<studentId>",
          "section": "<sectionId>",
          "avatar": {
            "preset": "FOX",
            "color": "#3B82F6"
          },
          "status": "ACTIVE",
          "score": 0,
          "streak": 0,
          "bestStreak": 0,
          "answeredCount": 0,
          "correctCount": 0,
          "totalResponseTimeMs": 0,
          "connected": false,
          "doublePointsActive": false,
          "streakShieldActive": false,
          "colorShards": 0,
          "unlockedColors": [],
          "giftsReceived": 0,
          "lastGiftCards": [],
          "finalRank": null,
          "joinedAt": "2026-01-01T00:00:00.000Z",
          "lastSeenAt": "2026-01-01T00:00:00.000Z",
          "kickedAt": null
        }
      ]
    }
  }
}
```

---

### `PATCH /api/sessions/:id/join-lock`

- Authentication: Yes
- Role: `OWNER`, `TEACHER`
- Opens or closes joining
- Cannot reopen a `FINISHED` session (`409`)

Request body:

```json
{
  "joinOpen": false
}
```

Response `200`: same `data.session` shape shown above.

---

### `POST /api/sessions/:id/start`

- Authentication: Yes
- Role: `OWNER`, `TEACHER`
- `LOBBY` -> `LIVE`
- Records `startedAt`, sets `joinOpen` to `false`, snapshots the quiz, and starts the countdown
- Emits `game:started` to the session room

Response `200`: same `data.session` shape shown above, with `gameState: "COUNTDOWN"`.

Errors: `409` if the session is not in `LOBBY`.

---

### `POST /api/sessions/:id/pause`

- Authentication: Yes
- Role: `OWNER`, `TEACHER`
- `LIVE` -> `PAUSED`
- Pauses the active phase timer and stores `remainingTimeMs`
- Emits `game:paused` to the session room

Response `200`: same `data.session` shape shown above.

Errors: `409` if the session is not `LIVE`.

---

### `POST /api/sessions/:id/resume`

- Authentication: Yes
- Role: `OWNER`, `TEACHER`
- `PAUSED` -> `LIVE`
- Restores the paused phase using `remainingTimeMs` and reschedules its timer
- Emits `game:resumed` to the session room

Response `200`: same `data.session` shape shown above.

Errors: `409` if the session is not `PAUSED`.

---

### `POST /api/sessions/:id/finish`

- Authentication: Yes
- Role: `OWNER`, `TEACHER`
- Any non-finished status -> `FINISHED`
- Records `endedAt`, sets `joinOpen` to `false`, stops timers, and persists final ranks
- Emits `game:finished` with the final leaderboard

Response `200`: same `data.session` shape shown above.

Errors: `409` if the session is already `FINISHED`.

---

### `POST /api/sessions/:id/reveal`

- Authentication: Yes
- Role: `OWNER`, `TEACHER`
- Only valid while the session is `LIVE` and `gameState` is `QUESTION`
- Ends the question early, applies any persisted answers, moves to `REVEAL`, and emits `game:revealed`
- Socket equivalent: `game:reveal`

Response `200`: same `data.session` shape, with `gameState: "REVEAL"`.

Errors: `409` if the game is not live or the current phase is not a question.

---

### `POST /api/sessions/:id/next`

- Authentication: Yes
- Role: `OWNER`, `TEACHER`
- Advances exactly one phase: `COUNTDOWN -> QUESTION`, `QUESTION -> REVEAL`, `REVEAL -> EXPLANATION`, `EXPLANATION -> POINTS`, `POINTS -> LEADERBOARD`, `LEADERBOARD -> PHONE_LEADERBOARD`, `PHONE_LEADERBOARD -> commands/next question`
- If a command is active, it is force-resolved using the normal server-side target rules before the queue continues
- Emits `game:phase-advanced`
- Socket equivalent: `game:next`

Response `200`: same `data.session` shape with the new `gameState`.

Errors: `409` if the game is not live or the current phase cannot be advanced.

---

### `POST /api/sessions/:id/skip`

- Authentication: Yes
- Role: `OWNER`, `TEACHER`
- Skips the current question and any queued/active commands, then starts the next question or finishes the game
- Skipping the last question finishes the session
- Emits `game:skipped`
- Socket equivalent: `game:skip`

Response `200`: same `data.session` shape.

Errors: `409` if the session is `IDLE`/`FINISHED` or not live.

---

### `PATCH /api/sessions/:id/command-settings`

- Authentication: Yes
- Role: `OWNER`, `TEACHER`
- Enables or disables each command independently
- At least one field is required
- Disabling a command cancels its queued or active commands with `COMMAND_DISABLED`
- Emits `game:command-settings-updated`
- Socket equivalent: `game:command-settings`

Request body:

```json
{
  "gift": true,
  "thief": true,
  "rocket": false
}
```

Response `200`: same `data.session` shape with the updated `commandSettings`.

Errors: `400` invalid/missing fields, `409` if the session is already finished.

---

### `PATCH /api/sessions/:id/phase-settings`

- Authentication: Yes
- Role: `OWNER`, `TEACHER`
- Sets per-session phase durations (0-600000 ms) and visibility flags for Reveal, Explanation, Points, Leaderboard, and Phone Leaderboard
- At least one field is required
- If the session is live, the current phase deadline is recalculated from the new duration
- Emits `game:phase-settings-updated`
- Socket equivalent: `game:phase-settings`

Request body:

```json
{
  "revealMs": 4000,
  "explanationMs": 4000,
  "pointsMs": 2500,
  "leaderboardMs": 4000,
  "phoneLeaderboardMs": 2500,
  "showReveal": true,
  "showExplanation": true,
  "showPoints": true,
  "showLeaderboard": true,
  "showPhoneLeaderboard": true
}
```

Response `200`: same `data.session` shape with the updated `phaseSettings`.

Errors: `400` invalid/missing fields, `409` if the session is already finished.

---

### `DELETE /api/sessions/:id/participants/:participantId`

- Authentication: Yes
- Role: `OWNER`, `TEACHER`
- Marks the participant as `KICKED`
- Emits `player:kicked` to the session and `session:kicked` to the participant, then disconnects their live sockets
- The participant cannot reconnect and the nickname remains reserved for that session

Response `200`:

```json
{
  "success": true,
  "message": "Participant removed successfully",
  "data": {
    "id": "<participantId>"
  }
}
```

Errors: `400` invalid id, `404` participant/session not found or in another organization, `409` participant already kicked.

---

### `GET /api/join/:code`

- Authentication: No
- Role: Public
- Looks up a session by its 6-character game code
- Returns only public session data: no organization id, creator id, session id, or quiz id

Response `200`:

```json
{
  "success": true,
  "message": "Session retrieved successfully",
  "data": {
    "session": {
      "joinCode": "AB3K9M",
      "joinUrl": "http://localhost:3000/join/AB3K9M",
      "status": "LOBBY",
      "joinOpen": true,
      "quiz": {
        "title": "Algebra Basics",
        "questionCount": 2,
        "estimatedDurationSec": 35
      },
      "participantCount": 0,
      "startedAt": null,
      "endedAt": null
    }
  }
}
```

Errors: `400` invalid game code format, `404` unknown game code.

---

### `POST /api/join/:code`

- Authentication: No
- Role: Public
- Joins a session using a nickname, a roster student identity, or an existing participant token
- Joining requires `joinOpen: true` and a status of `LOBBY` or `LIVE`
- `PAUSED` and `FINISHED` sessions reject new joins (`403`)

Request body options:

```json
{
  "nickname": "S1",
  "name": "Student One",
  "studentId": "<studentId>",
  "section": "<sectionId>",
  "avatar": {
    "preset": "FOX",
    "color": "#3B82F6"
  }
}
```

Rules:

- `nickname`: required unless `studentId` or `participantToken` is supplied; 1-50 characters
- `name`: optional, max 80 characters
- `studentId`: optional; must belong to the session organization. The student's saved name, nickname, section, and avatar are used as defaults.
- `section`: optional; must belong to the session organization
- `avatar`: optional; values must come from `GET /api/avatars/options`
- `participantToken`: optional; when supplied, the request reconnects to the existing participant instead of creating a new one
- Nicknames are unique per session, case-insensitively (`409` on duplicates)
- A student can participate only once per session (`409` on duplicates; kicked students receive `403`)

Response `201`:

```json
{
  "success": true,
  "message": "Joined session successfully",
  "data": {
    "session": {
      "joinCode": "AB3K9M",
      "joinUrl": "http://localhost:3000/join/AB3K9M",
      "status": "LOBBY",
      "joinOpen": true,
      "quiz": {
        "title": "Algebra Basics",
        "questionCount": 2,
        "estimatedDurationSec": 35
      },
      "participantCount": 1,
      "startedAt": null,
      "endedAt": null
    },
    "participant": {
      "id": "<participantId>",
      "name": "Student One",
      "nickname": "S1",
      "section": "<sectionId>",
      "avatar": {
        "preset": "FOX",
        "color": "#3B82F6"
      },
      "joinedAt": "2026-01-01T00:00:00.000Z",
      "lastSeenAt": "2026-01-01T00:00:00.000Z",
      "participantToken": "<opaque participant token>"
    }
  }
}
```

The `participantToken` is returned only to the joining/reconnecting student. It is stored as a SHA-256 hash and is never exposed in teacher lobby responses.

---

### `POST /api/join/:code/reconnect`

- Authentication: No
- Role: Public
- Reconnects an existing participant using their participant token
- Returns the same participant token and participant record
- Kicked participants receive `403`

Request body:

```json
{
  "participantToken": "<opaque participant token>"
}
```

Response `200`: same `data` shape as `POST /api/join/:code`.

Errors: `400` invalid body, `401` invalid token, `403` kicked participant, `404` unknown game code.

---

## Real-Time Gameplay (Phase 5 + Phase 6)

Phase 5 adds a Socket.IO game engine on the same HTTP server and port as the REST API. Correctness, response time, points, streaks, total scores, ranks, and all phase timers are calculated and persisted on the server. Clients cannot award themselves points. Phase 6 adds teacher live controls and the Gift/Thief/Rocket command layer on top of the same engine.

### Connection

| Setting | Value |
| ------- | ----- |
| URL | Same host and port as the API, for example `http://localhost:4000` |
| Path | `/socket.io` (Socket.IO default) |
| Transports | WebSocket or HTTP long-polling |
| CORS | Uses `CORS_ORIGIN` |
| Scaling | Single Node.js process; no Redis adapter or message broker |

### Socket authentication

Authentication is performed during the Socket.IO handshake. Pass an `auth` object:

Teacher/assistant (platform JWT + session id):

```js
const socket = io('http://localhost:4000', {
  auth: {
    role: 'teacher',
    token: '<jwt>',
    sessionId: '<sessionId>',
  },
});
```

Player (per-session participant token from `POST /api/join/:code`):

```js
const socket = io('http://localhost:4000', {
  auth: {
    role: 'player',
    joinCode: 'AB3K9M',
    participantToken: '<opaque participant token>',
  },
});
```

Rules:

- Teacher sockets require a valid non-suspended `OWNER`, `TEACHER`, or `ASSISTANT` account whose organization owns the session. Cross-organization session ids are rejected with `SESSION_NOT_FOUND` (`404` semantics).
- Player sockets require a valid participant token for that game code. Kicked participants are rejected.
- `role` is optional if exactly one credential is supplied (`token` or `participantToken`).
- A rejected handshake returns a `connect_error` with `error.data = { code, message }`.
- A teacher socket can observe the session; only `OWNER` and `TEACHER` can control the game. Assistants and players receive `FORBIDDEN`.
- REST lifecycle endpoints (`start`, `pause`, `resume`, `finish`) and the equivalent socket events drive the same engine.

### Rooms

| Room | Members |
| ---- | ------- |
| `session:{sessionId}` | All connected teachers and players in the session |
| `session:{sessionId}:teachers` | Connected teachers and assistants |
| `session:{sessionId}:players` | Connected players |
| `player:{participantId}` | All sockets of one participant (multi-tab/reconnect) |

### Client-to-server events

All events use an acknowledgement callback. The callback receives `{ success: true, data }` or `{ success: false, error: { code, message } }`. Errors are also emitted to the socket as `game:error`.

| Event | Allowed role | Payload | Ack data |
| ----- | ------------ | ------- | -------- |
| `game:sync` | Teacher, player | none | Current game state |
| `answer:submit` | Player | `{ "questionId": "<id>", "optionId": "<id>" }` | Submission acknowledgement (no correctness) |
| `game:start` | `OWNER`, `TEACHER` | none | `{ session }` |
| `game:pause` | `OWNER`, `TEACHER` | none | `{ session }` |
| `game:resume` | `OWNER`, `TEACHER` | none | `{ session }` |
| `game:finish` | `OWNER`, `TEACHER` | none | `{ session }` |
| `game:join-lock` | `OWNER`, `TEACHER` | `{ "joinOpen": true }` | `{ session }` |
| `game:reveal` | `OWNER`, `TEACHER` | none | `{ session }` |
| `game:next` | `OWNER`, `TEACHER` | none | `{ session }` |
| `game:skip` | `OWNER`, `TEACHER` | none | `{ session }` |
| `game:command-settings` | `OWNER`, `TEACHER` | `{ "gift": true, "thief": true, "rocket": false }` | `{ session }` |
| `game:phase-settings` | `OWNER`, `TEACHER` | `{ "revealMs": 4000, "showPoints": true }` | `{ session }` |
| `participant:kick` | `OWNER`, `TEACHER` | `{ "participantId": "<id>" }` | `{ participantId }` |
| `command:select-target` | Player (command owner) | `{ "targetParticipantId": "<id>" }` | Command result |

`game:command-settings` and `game:phase-settings` accept either the fields directly or wrapped in `{ commandSettings }` / `{ phaseSettings }`. Assistants and players receive `FORBIDDEN` for every control event. `command:select-target` is accepted only from the participant who owns the `AWAITING_TARGET` command.

`answer:submit` acknowledgement:

```json
{
  "success": true,
  "data": {
    "sessionId": "<sessionId>",
    "questionId": "<questionId>",
    "selectedOptionId": "<optionId>",
    "submittedAt": "2026-01-01T00:00:00.000Z",
    "responseTimeMs": 2140
  }
}
```

The acknowledgement deliberately omits `isCorrect` and `pointsAwarded` so a player cannot learn the answer before the reveal.

### Server-to-client events

| Event | Room | When | Payload summary |
| ----- | ---- | ---- | --------------- |
| `game:state` | Requesting socket | On connect and after `game:sync` | Full resumable game state |
| `game:started` | Session | Game start | `sessionId`, `startedAt`, `gameState`, `totalQuestions`, `phaseStartedAt`, `phaseEndsAt`, `serverTime` |
| `question:started` | Session | Each question opens | `questionId`, `question` (options without correctness), `index`, `totalQuestions`, `phaseStartedAt`, `phaseEndsAt`, `serverTime` |
| `question:ended` | Session | Answer deadline or all players answered | `questionId`, `index`, `answeredCount`, `totalPlayers`, `endedAt`, `serverTime` |
| `answer:revealed` | Session | Correct answer reveal | `questionId`, `index`, `correctOptionId`, `answerCounts[]`, `answeredCount`, `totalPlayers`, `phaseEndsAt`, `serverTime` |
| `answer:revealed:details` | Teachers | Correct answer reveal | `questionId`, `index`, `participantResults[]`, `serverTime` |
| `explanation:shown` | Session | Explanation phase | `questionId`, `index`, `explanation`, `phaseEndsAt`, `serverTime` |
| `points:shown` | Session | Points phase | `questionId`, `index`, `results[]`, `phaseEndsAt`, `serverTime` |
| `leaderboard:updated` | Session | Leaderboard phase or after a command | `questionId`, `index`, `leaderboard[]`, `generatedAt`, `phaseEndsAt`, `serverTime`, optional `reason` |
| `phone-leaderboard:updated` | Session | Phone leaderboard phase | `questionId`, `index`, `leaderboard[]`, `top[]`, `generatedAt`, `phaseEndsAt`, `serverTime` |
| `game:revealed` | Session | Teacher reveals early | `questionId`, `questionIndex`, `gameState`, `serverTime` |
| `game:phase-advanced` | Session | Teacher advances a phase | `fromState`, `toState`, `questionIndex`, `serverTime` |
| `game:skipped` | Session | Teacher skips a question | `fromState`, `skippedQuestionIndex`, `gameState`, `currentQuestionIndex`, `serverTime` |
| `game:command-settings-updated` | Session | Command settings changed | `commandSettings`, `serverTime` |
| `game:phase-settings-updated` | Session | Phase settings changed | `phaseSettings`, `phaseEndsAt`, `serverTime` |
| `session:join-lock-updated` | Session | Join lock changed | `sessionId`, `joinOpen`, `serverTime` |
| `command:queued` | Session | A command is enqueued | `command`, `actor { participantId, nickname }`, `serverTime` |
| `command:started` | Session | A command starts | `command`, `actor { participantId, nickname }`, `serverTime` |
| `command:target-required` | Command owner + teachers | Thief/Rocket needs a target | `commandId`, `type`, `actorId`, `targets[]`, `selectionEndsAt`, `timeoutMs`, `questionId`, `questionIndex`, `serverTime` |
| `command:completed` | Session | A command finishes | `command`, `result`, `serverTime` |
| `command:cancelled` | Session | A command is cancelled | `command`, `reason`, `serverTime` |
| `commands:completed` | Session | The queue is empty and the game advances | `questionIndex`, `serverTime` |
| `command:paused` | Session | Pause during target selection | `command`, `remainingSelectionMs`, `serverTime` |
| `command:resumed` | Session | Resume during target selection | `command`, `selectionEndsAt`, `remainingSelectionMs`, `serverTime` |
| `gift:received` | Command owner's player room | Gift cards are applied | `commandId`, `cards[]`, `effects[]`, `score`, `value`, `colorShards`, `unlockedColors`, `serverTime` |
| `thief:result` | Session | Thief resolves | `commandId`, `actorId`, `targetId`, `targetNickname`, `value`, `ownerScoreBefore`, `ownerScoreAfter`, `targetScoreBefore`, `targetScoreAfter`, `targetStreakBefore`, `targetStreakAfter`, `autoSelected`, `reason`, `serverTime` |
| `rocket:result` | Session | Rocket resolves | `commandId`, `actorId`, `targetId`, `targetNickname`, `value`, `ownerPointsAwarded`, `targetScoreBefore`, `targetScoreAfter`, `targetStreakBefore`, `targetStreakAfter`, `autoSelected`, `reason`, `serverTime` |
| `game:finished` | Session | Last leaderboard ends or teacher finishes | `sessionId`, `endedAt`, `totalQuestions`, `leaderboard[]`, `serverTime` |
| `game:paused` | Session | Teacher pauses | `gameState`, `pausedAt`, `phaseEndsAt`, `remainingTimeMs`, `serverTime` |
| `game:resumed` | Session | Teacher resumes | `gameState`, `resumedAt`, `phaseEndsAt`, `serverTime` |
| `answer:submitted` | Player room | Player submission | `questionId`, `selectedOptionId`, `submittedAt`, `responseTimeMs`, `serverTime` |
| `answer:submitted` | Teachers | Player submission | `questionId`, `participant { id, nickname }`, `answerCount`, `totalPlayers`, `submittedAt`, `serverTime` |
| `answer:result` | Player room | Reveal | `questionId`, `selectedOptionId`, `isCorrect`, `pointsAwarded`, `responseTimeMs`, `score`, `streak`, `bestStreak`, `rank`, `serverTime` |
| `points:updated` | Player room | Reveal | Same fields as `answer:result` |
| `player:joined` | Session | A new participant joins via REST | `participant`, `at` |
| `player:reconnected` | Teachers | A player reconnects | `participant`, `at` |
| `player:left` | Session | A player's last socket disconnects | `participantId`, `nickname`, `reason: "disconnect"`, `at` |
| `player:kicked` | Session | A teacher kicks a participant | `participantId`, `nickname`, `at` |
| `session:kicked` | Player room | Before a kicked player is disconnected | `reason: "kicked"`, `at` |
| `game:error` | Requesting socket | Any rejected socket action | `{ code, message }` |

### Game state payload

`game:state` (and the `game:sync` ack) returns a snapshot that a client can use to rebuild its UI after connecting, reconnecting, or reloading:

```json
{
  "sessionId": "<sessionId>",
  "status": "LIVE",
  "gameState": "QUESTION",
  "currentQuestionIndex": 0,
  "totalQuestions": 2,
  "questionProgress": {
    "current": 1,
    "total": 2,
    "answeredCount": 1,
    "totalPlayers": 2
  },
  "phaseStartedAt": "2026-01-01T00:00:03.000Z",
  "phaseEndsAt": "2026-01-01T00:00:18.000Z",
  "phaseRemainingMs": 11350,
  "remainingTimeMs": null,
  "serverTime": "2026-01-01T00:00:06.650Z",
  "commandSettings": {
    "gift": true,
    "thief": true,
    "rocket": false
  },
  "phaseSettings": {
    "revealMs": 5000,
    "explanationMs": 5000,
    "pointsMs": 3000,
    "leaderboardMs": 5000,
    "phoneLeaderboardMs": 3000,
    "showReveal": true,
    "showExplanation": true,
    "showPoints": true,
    "showLeaderboard": true,
    "showPhoneLeaderboard": true
  },
  "question": {
    "id": "<questionId>",
    "text": "What is 2 + 2?",
    "points": 1000,
    "timeLimitSec": 15,
    "order": 0,
    "options": [
      { "id": "<optionId>", "text": "3" },
      { "id": "<optionId>", "text": "4" }
    ]
  },
  "leaderboard": [
    {
      "rank": 1,
      "position": 1,
      "participantId": "<participantId>",
      "nickname": "S1",
      "name": "Student One",
      "avatar": { "preset": "FOX", "color": "#3B82F6" },
      "score": 900,
      "streak": 1,
      "bestStreak": 1,
      "answeredCount": 1,
      "correctCount": 1,
      "totalResponseTimeMs": 2100
    }
  ],
  "you": {
    "participantId": "<participantId>",
    "nickname": "S1",
    "score": 900,
    "streak": 1,
    "bestStreak": 1,
    "rank": 1,
    "doublePointsActive": false,
    "streakShieldActive": false,
    "colorShards": 1,
    "unlockedColors": [],
    "giftsReceived": 1,
    "lastGiftCards": ["COLOR_SHARDS", "POINTS_BONUS", "DOUBLE_POINTS"]
  },
  "yourAnswer": {
    "selectedOptionId": "<optionId>",
    "responseTimeMs": 2100,
    "submittedAt": "2026-01-01T00:00:05.100Z"
  }
}
```

Teacher sockets also receive `answerCounts`, `answerCount`, `commandQueue[]`, and `participants[]` (each with `commandEligible`). A player whose command is active receives `activeCommand`, `yourCommand`, and, while awaiting a target, `commandTargets[]`.

- `you` and `yourAnswer` are present only for player sockets.
- `question.options[].isCorrect` is added only in `REVEAL`, `EXPLANATION`, `LEADERBOARD`, and `FINISHED`.
- `yourAnswer.isCorrect`, `pointsAwarded`, and `streakAfter` are added only in those same reveal states.
- `answerCounts` and `answerCount` are added for teacher sockets during the question/reveal phases.
- `phaseRemainingMs` is the authoritative remaining time; clients should render timers from `phaseEndsAt` and `serverTime`, not from a local countdown alone.
- The leaderboard is ordered by the server; do not re-sort it client-side.

### Gameplay flow

```text
IDLE
  ↓ game:start
COUNTDOWN
  ↓ (GAME_COUNTDOWN_MS)
QUESTION
  ↓ (question.timeLimitSec, all active players answered, or teacher reveal)
REVEAL
  ↓ (revealMs)
EXPLANATION
  ↓ (explanationMs)
POINTS
  ↓ (pointsMs)
LEADERBOARD
  ↓ (leaderboardMs)
PHONE_LEADERBOARD
  ↓ (phoneLeaderboardMs)
COMMANDS: GIFT -> THIEF -> ROCKET  (only enabled commands with eligible triggers)
  ↓ (one command at a time; target commands wait up to COMMAND_SELECTION_TIMEOUT_MS)
QUESTION (next)  ── or ──  FINISHED
```

The post-question sequence is fixed: **Reveal -> Explanation -> Points -> Leaderboard -> Phone Leaderboard -> Gift -> Thief -> Rocket -> Next Question**. Commands are processed from a single persisted queue and never run simultaneously. If no command is queued, the engine advances directly to the next question or finishes.

- `game:start` snapshots the quiz questions and options into the session. Later question edits or deletions do not change a live game.
- The game automatically advances through all phases. Teachers can reveal, next, skip, pause, resume, or finish at any time; assistants and players cannot.
- Phase durations and visibility are stored per session in `phaseSettings`; `GAME_*` environment values are only the defaults.
- A question can end early when every active player has answered or a teacher reveals it.
- Late players may join while `joinOpen` is true and the session is `LIVE`; they receive the current question state and score 0 for a question they did not answer.
- `FINISHED` sessions reject further answers and control events.
- Paused sessions reject answers until resumed. `remainingTimeMs` is persisted so the same phase continues after resume. Target-selection timers are also paused and restored.
- Commands are disabled by default. A teacher must enable `gift`, `thief`, or `rocket` for the session before they can trigger.

### Scoring and streaks

Phase 5 uses this server-side formula for the **game score**:

```text
responseRatio = clamp(responseTimeMs / (timeLimitSec * 1000), 0, 1)
pointsAwarded = round(question.points * (1 - responseRatio * 0.5))
```

- A correct answer earns 50%–100% of the question's points, linearly decreasing with response time.
- An incorrect answer earns `0`.
- `responseTimeMs` is measured from the server-recorded `phaseStartedAt` to the server receive time.
- A correct answer increments `streak` by 1 and updates `bestStreak`; an incorrect answer resets `streak` to 0.
- Phase 5 has **no streak bonus**. `streak` is recorded and displayed but does not change points.
- `score` is the sum of `pointsAwarded` across all persisted answers, plus direct score effects such as Points Bonus and Leaderboard Strike. In reports it is exposed as `gameScore`; the existing `score` field is kept for API compatibility.
- `Answer.basePointsAwarded` stores the speed-based value before card effects. `Answer.doublePointsApplied` and `Answer.streakShieldApplied` record which card effects were consumed on that answer.
- Double Points doubles `pointsAwarded` for the next answered question and is then consumed. Streak Shield preserves the current streak through one incorrect answer and is then consumed.
- Points Bonus adds 100 score immediately. Leaderboard Strike steals up to 100 score from the player immediately above the owner, or grants the first-place owner a 100 point bonus.
- Client-supplied fields such as `score`, `isCorrect`, `pointsAwarded`, or `participantId` are ignored.
- Each player can submit at most one answer per question. Duplicates return `ALREADY_ANSWERED` and are never scored twice.
- Answers received after `phaseEndsAt` return `DEADLINE_PASSED`.
- Scoring updates are idempotent: an answer is applied to the player only if that question is not already in `answeredQuestions`.

#### Raw score (academic score)

`SessionPlayer.rawScore` is a second, independent score that is never touched by gameplay effects:

```text
rawScore = sum(question.points for every correctly answered question)
```

- A correct answer adds the **full configured base points** of that question (`Answer.rawScoreAwarded`), regardless of response speed.
- An incorrect or unanswered question adds `0`.
- Double Points, Gift, Points Bonus, Leaderboard Strike, Thief, Rocket, Streak Shield, and every other command affect only `score` (`gameScore`), never `rawScore`.
- The value is calculated and persisted server-side from the session question snapshot, so editing a question after the session starts cannot change a finished session's raw score.
- `rawScore` is incremented atomically with the answer application and is also recomputed from `Answer` records for reports, which backfills legacy answers that predate the field.
- The academic best streak (`academicBestStreak`) is derived separately by walking the answers in question order. Unanswered questions break the consecutive-correct run, and Streak Shield does not affect it.

### Leaderboard

The leaderboard includes only `ACTIVE` participants (kicked players are excluded) and is ordered by:

1. `score` descending
2. `totalResponseTimeMs` ascending
3. `joinedAt` ascending
4. participant id ascending (deterministic tie-breaker)

Players with the same score share the same competition `rank` (for example `1, 1, 3`). `position` is always the deterministic 1-based row position (`1, 2, 3`). Final ranks are persisted on `SessionPlayer.finalRank` when the game finishes.

### Disconnects, reconnects, and kicks

- A player may have multiple sockets (for example multiple tabs). `connected` becomes `false` only when the last socket disconnects.
- `player:left` is emitted when the last socket disconnects. The participant remains in the game and keeps their score.
- Reconnecting with the same participant token restores the current state, including `yourAnswer` and the leaderboard. Teachers receive `player:reconnected`.
- Kicking a participant during a live game emits `player:kicked` to the session and `session:kicked` to the participant, then force-disconnects their sockets. Kicked players cannot reconnect and are removed from active player counts and leaderboards.
- Teacher sockets can disconnect and reconnect freely; `game:sync` returns the current state.

### Persistence and restart recovery

The following are persisted in MongoDB:

- Session game state, question snapshot, current index, phase timestamps, remaining paused time, command settings, phase settings, and active command
- Every authoritative answer (selected option, correctness, response time, base/effective points, card-effect flags, streak, applied flag)
- Player score, streak, best streak, answered/correct counts, total response time, connection timestamps, final rank, pending card effects, color shards, unlocked colors, gift history, applied command ids, and offline question tracking
- Every command (`SessionCommand`) with status, actor, target, question, selection deadline, result, and metadata
- Every command/teacher audit record (`SessionEvent`) with a unique dedupe key

On server startup, the engine:

1. Reconciles answers that were persisted but not yet applied to a player (idempotently).
2. Resumes `LIVE` sessions from their persisted `phaseEndsAt`. If a deadline already passed during downtime, the next transition runs immediately.
3. Keeps `PAUSED` sessions paused and restores `remainingTimeMs` when missing.
4. Recovers command queues: completed commands stay completed, interrupted gifts finish once, interrupted target commands are cancelled safely, expired target selections auto-resolve, and future deadlines are rescheduled.

Only one timer is scheduled per session and only one command is processed at a time per session. Timers are cleared before a new phase/command timer is created, so duplicate phase transitions, duplicate score awards, and duplicate command effects are prevented.

### Error codes

| Code | Meaning |
| ---- | ------- |
| `UNAUTHORIZED` | Missing/invalid JWT or participant token |
| `FORBIDDEN` | Wrong role, cross-role action, or assistant/player control attempt |
| `SESSION_NOT_FOUND` | Unknown session or cross-organization session |
| `PARTICIPANT_NOT_FOUND` | Participant record not found |
| `PARTICIPANT_KICKED` | Kicked participant cannot connect or act |
| `INVALID_PARTICIPANT_TOKEN` | Token does not match a participant in the session |
| `GAME_NOT_ACTIVE` | Game is paused or not running |
| `GAME_ALREADY_STARTED` | Start attempted in an invalid state |
| `INVALID_GAME_STATE` | Invalid phase transition or empty quiz |
| `NO_ACTIVE_QUESTION` | No question is accepting answers |
| `QUESTION_MISMATCH` | Submitted `questionId` is not the current question |
| `INVALID_OPTION` | Option does not belong to the current question |
| `DEADLINE_PASSED` | Submission arrived after `phaseEndsAt` |
| `ALREADY_ANSWERED` | Player already answered this question |
| `INVALID_PAYLOAD` | Missing or malformed socket payload |
| `COMMAND_DISABLED` | Command is disabled for this session |
| `COMMAND_NOT_ACTIVE` | No command of this owner is awaiting a target |
| `COMMAND_NOT_FOUND` | Unknown command |
| `COMMAND_ALREADY_RESOLVED` | Command was already completed, cancelled, or timed out |
| `NOT_COMMAND_OWNER` | Participant does not own the active command |
| `INVALID_TARGET` | Target is the command owner or otherwise invalid |
| `TARGET_INELIGIBLE` | Target is disconnected, kicked, stale, or has no positive score when required |
| `NO_ELIGIBLE_TARGET` | No eligible target exists; the command is cancelled |
| `PHASE_NOT_CONTROLLABLE` | Current game phase cannot be revealed/advanced/skipped |

### Phase 5 limitations

- `Question` has no explanation field yet, so `explanation:shown` currently sends `explanation: null`.
- There is no manual grading, answer change, or answer review after submission.
- Question order is the quiz order; randomization and option shuffling are not implemented.
- `GAME_*` values are defaults; per-session `phaseSettings` can override durations and visibility.
- The engine is designed for one API process. Running multiple instances would require a Socket.IO adapter and a shared scheduler; Redis is intentionally not used.
- Recovery uses wall-clock deadlines: time that passes while the server is down still counts against the current phase.
- Attendance and reports are not recorded in Phase 5 (Phase 7).

---

## Teacher Controls and Commands (Phase 6)

Phase 6 adds live teacher controls and three opt-in commands on top of the Phase 5 engine. Every score, streak, unlock decision, target check, card draw, and effect is calculated and persisted by the server. Clients never supply authoritative scores, targets, streaks, or unlock status.

### Teacher controls

| Action | REST | Socket | Effect |
| ------ | ---- | ------ | ------ |
| Reveal | `POST /api/sessions/:id/reveal` | `game:reveal` | Ends the current question early and moves to `REVEAL` |
| Next phase | `POST /api/sessions/:id/next` | `game:next` | Advances exactly one phase; force-resolves an active command if needed |
| Skip question | `POST /api/sessions/:id/skip` | `game:skip` | Cancels the current question and queued commands, then starts the next question or finishes |
| Pause | `POST /api/sessions/:id/pause` | `game:pause` | Pauses the current phase and target-selection timer |
| Resume | `POST /api/sessions/:id/resume` | `game:resume` | Restores the paused phase and target-selection timer |
| Finish | `POST /api/sessions/:id/finish` | `game:finish` | Ends the session and persists final ranks |
| Join lock | `PATCH /api/sessions/:id/join-lock` | `game:join-lock` | Opens/closes joining and broadcasts the change |
| Kick | `DELETE /api/sessions/:id/participants/:participantId` | `participant:kick` | Marks a participant `KICKED` and disconnects their sockets |
| Command settings | `PATCH /api/sessions/:id/command-settings` | `game:command-settings` | Enables/disables Gift, Thief, and Rocket independently |
| Phase settings | `PATCH /api/sessions/:id/phase-settings` | `game:phase-settings` | Sets per-session durations and visibility flags |

Authorization is enforced server-side for both REST and Socket.IO:

- `OWNER` and `TEACHER` can control the game.
- `ASSISTANT` can observe but receives `FORBIDDEN` for control actions.
- Players cannot call teacher control events.
- Every accepted teacher action is broadcast to the session room and recorded as a `SessionEvent` (`TEACHER_START`, `TEACHER_PAUSE`, `TEACHER_RESUME`, `TEACHER_FINISH`, `TEACHER_REVEAL`, `TEACHER_NEXT`, `TEACHER_SKIP`, `TEACHER_JOIN_LOCK`, `TEACHER_KICK`, `TEACHER_COMMAND_SETTINGS`, `TEACHER_PHASE_SETTINGS`).

`showReveal`, `showExplanation`, `showPoints`, `showLeaderboard`, and `showPhoneLeaderboard` control whether the corresponding broadcast is emitted. They do not remove server-side state or scoring. Phase durations are applied to the current live phase when changed.

### Command triggers

Commands are **disabled by default per session**. Enable them with `command-settings` before or during a game.

| Command | Unlock rule | Additional rules |
| ------- | ----------- | ---------------- |
| `GIFT` | The player's streak becomes exactly `2` after a correct answer | Completes immediately; no target selection |
| `THIEF` | The player's streak becomes exactly `1` after a correct answer | `COMMAND_THIEF_CHANCE` (default `0.35`) activation roll; never on the last question; requires at least one eligible target with `score > 0` |
| `ROCKET` (Nuke/Rocket) | The player's streak is `5`, `10`, `15`, or any positive multiple of `5` after a correct answer | Requires at least one eligible target; may trigger on the last question; owner receives no points |

A wrong answer resets the streak to `0`, so it cannot unlock a command.

### Gift cards

Gift always draws **3 unique cards** from the 5-card pool without replacement. Each card has its own independent rarity and draw weight.

| Card | Rarity | Weight | Effect |
| ---- | ------ | ------ | ------ |
| Double Points | `COMMON` | 35 | Doubles the points of the next answered question, then is consumed. Does not stack while already active. |
| Streak Shield | `UNCOMMON` | 25 | Preserves the streak through one incorrect answer, then is consumed. Does not stack while already active. |
| Leaderboard Strike | `RARE` | 10 | Steals up to 100 points from the player immediately above the owner. If the owner is first, the owner receives a 100 point bonus instead. |
| Points Bonus | `COMMON` | 35 | Grants 100 points immediately. |
| Color Shards | `UNCOMMON` | 20 | Adds one shard; every 3 shards unlock the next unused avatar color. |

Card effects are applied exactly once per gift command. A card that is already active is reported with `applied: false` and `alreadyActive: true` instead of stacking.

### Target selection and eligibility

Thief and Rocket pause the game in their command state and ask the owner to choose a target.

- A target must be `ACTIVE`, connected, not the owner, and not offline since two questions ago.
- Thief additionally requires the target's live score to be greater than `0`.
- Eligibility is revalidated at execution time, not only when the target list is built.
- If the owner does not choose within `COMMAND_SELECTION_TIMEOUT_MS` (default `12000`), the first eligible target in join order is selected automatically.
- If the owner disconnects during selection, the timeout still auto-selects the first eligible target.
- If no eligible target exists, the command is cancelled with `NO_ELIGIBLE_TARGET` and the queue continues.
- Selecting yourself returns `INVALID_TARGET`; a stale/disconnected/kicked target returns `TARGET_INELIGIBLE`; selecting after timeout returns `COMMAND_NOT_ACTIVE`/`COMMAND_ALREADY_RESOLVED`.
- Pausing during target selection stores `remainingSelectionMs`; resuming restores the deadline.

Thief steals the target's **entire live score**, sets the target's score and streak to `0`, and adds the stolen value to the owner. Rocket sets the target's score and streak to `0` and awards the owner nothing.

### Queue and ordering

The post-question sequence is fixed:

```text
REVEAL -> EXPLANATION -> POINTS -> LEADERBOARD -> PHONE_LEADERBOARD
       -> GIFT -> THIEF -> ROCKET -> NEXT QUESTION (or FINISHED)
```

- A single persisted queue is used per session.
- Priority is `GIFT=1`, `THIEF=2`, `ROCKET=3`; ties are ordered by creation time and id.
- Only one command can be `PROCESSING` or `AWAITING_TARGET` at a time.
- A target command blocks the queue until the owner selects or the timeout resolves it.
- The next question starts only after the queue is empty (`commands:completed`).
- Disabling a command cancels its queued/active instances with `COMMAND_DISABLED`.
- Teacher `next` force-resolves the active command; teacher `skip` cancels the current question and all pending commands.

### Persistence, idempotency, and recovery

- `SessionCommand` stores each command with a unique deterministic `commandId` (`session:type:questionIndex:actor`), status (`QUEUED`, `PROCESSING`, `AWAITING_TARGET`, `COMPLETED`, `CANCELLED`), actor, target, question, deadline, result, and metadata.
- `SessionEvent` stores every command use and teacher action. Command events use `dedupeKey = commandId` with a unique partial index, so a command cannot create duplicate events.
- `SessionPlayer.appliedCommandIds` marks commands already applied to the owner/target. Gift, Thief, and Rocket effects check these markers and are safe to retry.
- Gift effects are also guarded by the command event dedupe key.
- On restart, the engine recovers queued commands, finishes interrupted gifts, cancels interrupted target commands, resolves expired target selections, and reschedules future deadlines.
- Command decisions never trust client scores, targets, streaks, or unlock state.

### Command events

| Event | Meaning |
| ----- | ------- |
| `SessionEvent.type = GIFT` | Gift cards were drawn/applied |
| `SessionEvent.type = THIEF` | Thief resolved (owner-selected or auto-selected) |
| `SessionEvent.type = ROCKET` | Rocket resolved |
| `TEACHER_*` | A teacher control action was accepted |

Command events include `actorType`, `actorId`, `targetId`, `value`, `question`, `questionIndex`, `timestamp`, and `metadata` (cards, effects, auto-selection reason, scores before/after, and similar details).

### Phase 6 limitations

- Commands are opt-in and disabled by default; existing Phase 5 sessions remain deterministic.
- Gift draws and the Thief activation roll are random and not seeded or replayable. The persisted event records the result, not the random seed.
- Double Points and Streak Shield never stack; drawing them while already active consumes the card without adding another effect.
- Color Shards unlock avatar colors on the participant record, but the backend does not yet expose a dedicated color-selection endpoint or enforce unlocked colors on `PATCH /students/:id/avatar`.
- There is no REST endpoint to list `SessionEvent` history yet; events are persisted for audit and future reporting.
- There is no command inventory, trading, or per-player opt-out.
- Target selection timeout is wall-clock based; pausing/resuming preserves the remaining selection time, but downtime still counts against the deadline.
- The queue and timers are in-process. Restart recovery uses MongoDB state, but horizontal scaling still requires a shared adapter/scheduler.
- `Question` still has no explanation field, so explanation events carry `null`.

---

## Attendance and Reports (Phase 7)

Phase 7 adds attendance, session reports, and per-student history. All three read from persisted `Answer`, `SessionPlayer`, `Session`, `SessionCommand`, and `Attendance` documents. The server never trusts client-supplied attendance, scores, or results.

### Endpoints

| Endpoint | Roles | Purpose |
| -------- | ----- | ------- |
| `GET /api/sessions/:id/attendance` | `OWNER`, `TEACHER`, `ASSISTANT` | Attendance for one session, finalized or live |
| `GET /api/sessions/:id/report` | `OWNER`, `TEACHER`, `ASSISTANT` | Full report for a finished session |
| `GET /api/sessions/:id/report/export` | `OWNER`, `TEACHER`, `ASSISTANT` | Excel workbook for a finished session |
| `GET /api/students/:id/history` | `OWNER`, `TEACHER`, `ASSISTANT` | Organization-scoped attendance/performance history for one roster student |

`ADMIN` is blocked with `403` by `requireOrganization`, because these endpoints are organization-scoped. Cross-organization access returns `404`.

#### `GET /api/sessions/:id/attendance`

Query parameters:

| Param | Type | Notes |
| ----- | ---- | ----- |
| `section` | ObjectId | Scope records/counts to one section |
| `status` | `PRESENT` \| `ABSENT` \| `KICKED` \| `PENDING` | Filter by attendance status |

Behavior:

- A **finished** session returns persisted `Attendance` records and `finalized: true`.
- A **live**, **paused**, or **lobby** session returns a computed live view with `finalized: false` and `PENDING` records. It never writes attendance.
- The response includes `counts`, `sections`, `filters`, `session`, and `records`.

#### `GET /api/sessions/:id/report`

- Authentication: Bearer JWT. Allowed roles: `OWNER`, `TEACHER`, `ASSISTANT`. `ADMIN` receives `403`.
- Only `FINISHED` sessions are reportable. Live, paused, or lobby sessions return `409`.
- Cross-organization sessions return `404` (existence is not leaked).
- Finalizes attendance lazily if it was never finalized (for example after a crash during finish).
- This JSON response is the **primary report contract** for the frontend. Excel export is optional and is generated from the same service, so the frontend must not depend on it.

The report exposes predictable sections:

| Section | Contents |
| ------- | -------- |
| `sessionSummary` | Session id, quiz title, join code, status, timestamps, total questions, participant counts, and attendance summary |
| `attendance` | Finalization flag, counts, and per-section summaries |
| `studentResults` | One row per participant (including absentees) with academic and gameplay scores and aggregate statistics |
| `questionAnalysis` | Per-question aggregates: text, order, base points, answer counts, accuracy, response time, answer distribution |
| `commandStatistics` | Command usage by type/status plus the command log (same value as the existing `commands` field) |

Existing fields (`session`, `summary`, `studentAnalysis`, `commands`) are preserved for API compatibility. `studentResults` is the recommended frontend source.

##### `studentResults` fields

| Field | Type | Description |
| ----- | ---- | ----------- |
| `name` | string | Roster student name, or the guest's display name |
| `rawScore` | number | Sum of the configured base points of correctly answered questions; no speed or gameplay effects |
| `gameScore` | number | Final gameplay score (`SessionPlayer.score`), including speed and all command effects |
| `accuracy` | number | Percentage of correct answers, 0–100, two decimals; `0` when nothing was answered |
| `correctAnswers` | number | Number of correct answers |
| `incorrectAnswers` | number | Number of incorrect answers; unanswered questions are **not** counted |
| `bestStreak` | number | Maximum consecutive correct answers in question order; unaffected by Streak Shield |
| `averageResponseTime` | number | Average answer time in **seconds** (two decimals), answered questions only; `0` when nothing was answered |

Each row also keeps `student`, `participant`, `section`, `sectionName`, `nickname`, `status`, `guest`, `rosterMissing`, `late`, `totalQuestions`, and `finalRank` for display and filtering.

##### Calculation rules

```text
rawScore          = Σ question.points            (correct answers only)
gameScore         = SessionPlayer.score          (existing speed/command formula, unchanged)
accuracy          = correctAnswers / (correctAnswers + incorrectAnswers) * 100
bestStreak        = max consecutive correct answers in question order
averageResponseTime = Σ responseTimeMs / answeredCount / 1000
```

- `accuracy` is rounded to two decimals and is `0` when `correctAnswers + incorrectAnswers === 0`.
- `averageResponseTime` is rounded to two decimals and is `0` when no question was answered. It uses only answered questions; unanswered questions are excluded from both the numerator and denominator.
- Unanswered questions break the `bestStreak` run. An incorrect answer also breaks it.
- `studentAnalysis[].accuracy` remains a 0–1 ratio, and `studentAnalysis[].bestStreak` remains the gameplay best streak. `studentResults[].accuracy` is a percentage and `studentResults[].bestStreak` is the academic streak. `studentAnalysis` also exposes `rawScore`, `gameScore`, `academicBestStreak`, and `averageResponseTime`.
- Guest display names come from the participant `name`/`nickname`; token hashes and other credentials are never included.
- Kicked, disconnected, late, and absent participants are included. Absentees have zeroed statistics.

##### Frontend usage

The table can be sorted client-side by `rawScore`, `gameScore`, `accuracy`, or `bestStreak` and searched by `name`/`nickname`. All values are authoritative server calculations; the frontend does not need to recalculate scores or make per-student requests.

#### `GET /api/students/:id/history`

Query parameters:

| Param | Type | Notes |
| ----- | ---- | ----- |
| `from` | ISO date | Inclusive lower bound on the session end time |
| `to` | ISO date | Inclusive upper bound on the session end time |
| `session` | ObjectId | One session (must belong to the same organization) |
| `quiz` | ObjectId | One quiz (must belong to the same organization) |
| `status` | attendance status | `PRESENT` / `ABSENT` / `KICKED` |
| `limit` | integer 1–100 | Default `50` |
| `offset` | integer ≥ 0 | Default `0` |

The response includes the student, applied filters, pagination, an aggregate `summary`, and the `history` rows. The summary is computed over **all** matching records, not only the current page.

### Attendance rules

- Attendance is based on **actual participation**, not section membership.
- A participant is `PRESENT` when `answeredCount / totalQuestions >= attendanceThreshold`. The default threshold is `0.5` (50%) and is stored per session as `Session.attendanceThreshold`.
- A kicked participant is always `KICKED`, even if they answered enough questions.
- A roster student who never joined is `ABSENT`.
- A finished session with zero questions marks every joined participant `PRESENT` (nothing to answer).
- Live sessions use `PENDING`; `PRESENT`/`ABSENT` are only written after finalization.
- Late joins are detected by comparing `participant.joinedAt` with `session.startedAt` and are stored as `late: true`.
- Guests (participants with no roster `Student`) are tracked with `student: null` and `guest: true`; they do not affect the roster attendance denominator.
- If a participant references a `Student` that was later deleted, the record keeps the historical student id with `rosterMissing: true` and is **not** treated as a guest.
- Absentees are derived from the full organization roster at finalization time; the `section` query filter only filters the returned records.
- `durationMs` uses join time to kick time, last disconnect time, or session end, whichever applies.

### Finalization and idempotency

- `game.engine.finishGame` calls `attendanceService.finalizeSessionAttendance` after final ranks are persisted. A failure is logged and does not block the finish broadcast.
- Reports and attendance reads lazily finalize a finished session if `Session.attendanceFinalizedAt` is empty.
- Finalization is idempotent: records are upserted, unique partial indexes on `(session, student)` and `(session, participant)` prevent duplicates, and a later attendee replaces the earlier absentee row.
- Re-running finalization does not duplicate records or change the record count.

### Report fields

```json
{
  "report": {
    "generatedAt": "2026-01-01T00:00:00.000Z",
    "sessionSummary": {
      "sessionId": "<sessionId>",
      "quizTitle": "Algebra Basics",
      "joinCode": "ABC123",
      "status": "FINISHED",
      "startedAt": "2026-01-01T00:00:00.000Z",
      "endedAt": "2026-01-01T00:10:00.000Z",
      "totalQuestions": 10,
      "totalParticipants": 26,
      "registeredParticipants": 30,
      "joinedParticipants": 26,
      "attendanceSummary": {
        "present": 25,
        "absent": 6,
        "kicked": 1,
        "pending": 0,
        "guests": 2,
        "late": 3,
        "attendanceRate": 0.7667,
        "attendancePercentage": 76.67
      }
    },
    "session": {
      "id": "<sessionId>",
      "status": "FINISHED",
      "joinCode": "ABC123",
      "startedAt": "2026-01-01T00:00:00.000Z",
      "endedAt": "2026-01-01T00:10:00.000Z",
      "totalQuestions": 10,
      "attendanceThreshold": 0.5,
      "attendanceFinalizedAt": "2026-01-01T00:10:00.000Z",
      "quiz": { "id": "<quizId>", "title": "Algebra Basics", "description": "" }
    },
    "attendance": {
      "finalized": true,
      "counts": {
        "registered": 30,
        "joined": 26,
        "present": 25,
        "absent": 6,
        "kicked": 1,
        "pending": 0,
        "guests": 2,
        "late": 3,
        "attendanceRate": 0.7667,
        "attendancePercentage": 76.67,
        "participationRate": 0.8125,
        "participationPercentage": 81.25
      },
      "sections": [
        {
          "section": "<sectionId>",
          "sectionName": "Grade 10 A",
          "registered": 15,
          "joined": 14,
          "present": 14,
          "absent": 2,
          "kicked": 0,
          "pending": 0,
          "guests": 1,
          "late": 2,
          "attendanceRate": 0.8667,
          "attendancePercentage": 86.67,
          "averageScore": 4200,
          "accuracy": 0.72,
          "accuracyPercentage": 72
        }
      ]
    },
    "summary": {
      "registeredParticipants": 30,
      "joinedParticipants": 26,
      "actualAttendees": 25,
      "absentees": 6,
      "present": 25,
      "kicked": 1,
      "guests": 2,
      "late": 3,
      "attendanceRate": 0.7667,
      "attendancePercentage": 76.67,
      "participationRate": 0.8125,
      "participationPercentage": 81.25,
      "totalAnswers": 240,
      "correctAnswers": 180,
      "incorrectAnswers": 60,
      "accuracy": 0.75,
      "accuracyPercentage": 75,
      "averageScore": 4150,
      "averageCorrectAnswers": 6.92,
      "averageAccuracy": 0.72,
      "averageAccuracyPercentage": 72,
      "averageResponseTimeMs": 3400,
      "gameDurationMs": 600000,
      "topPlayers": [
        {
          "position": 1,
          "rank": 1,
          "student": "<studentId>",
          "participant": "<participantId>",
          "name": "Sara Ali",
          "nickname": "sara",
          "section": "<sectionId>",
          "sectionName": "Grade 10 A",
          "score": 9800,
          "answeredCount": 10,
          "correctCount": 9,
          "accuracy": 0.9,
          "accuracyPercentage": 90,
          "averageResponseTimeMs": 2800
        }
      ],
      "hardestQuestion": {
        "questionId": "<questionId>",
        "text": "What is x?",
        "accuracy": 0.3,
        "accuracyPercentage": 30,
        "totalAnswers": 20,
        "correctAnswers": 6
      }
    },
    "questionAnalysis": [
      {
        "index": 0,
        "questionId": "<questionId>",
        "text": "What is 2 + 2?",
        "points": 1000,
        "timeLimitSec": 10,
        "order": 0,
        "correctOptionId": "<optionId>",
        "totalAnswers": 24,
        "correctAnswers": 20,
        "incorrectAnswers": 4,
        "skippedCount": 2,
        "accuracy": 0.8333,
        "accuracyPercentage": 83.33,
        "averageResponseTimeMs": 3100,
        "answerDistribution": [
          { "optionId": "<optionId>", "text": "4", "isCorrect": true, "count": 20, "percentage": 83.33 }
        ],
        "mostCommonWrongOption": {
          "optionId": "<optionId>",
          "text": "5",
          "count": 3,
          "percentage": 12.5
        }
      }
    ],
    "studentResults": [
      {
        "student": "<studentId>",
        "participant": "<participantId>",
        "section": "<sectionId>",
        "sectionName": "Grade 10 A",
        "name": "Sara Ali",
        "nickname": "sara",
        "status": "PRESENT",
        "guest": false,
        "rosterMissing": false,
        "late": false,
        "totalQuestions": 10,
        "rawScore": 8500,
        "gameScore": 9800,
        "accuracy": 90,
        "correctAnswers": 9,
        "incorrectAnswers": 1,
        "bestStreak": 5,
        "averageResponseTime": 2.8,
        "finalRank": 1
      }
    ],
    "studentAnalysis": [
      {
        "student": "<studentId>",
        "participant": "<participantId>",
        "section": "<sectionId>",
        "sectionName": "Grade 10 A",
        "name": "Sara Ali",
        "nickname": "sara",
        "status": "PRESENT",
        "guest": false,
        "rosterMissing": false,
        "late": false,
        "joinedAt": "2026-01-01T00:00:05.000Z",
        "leftAt": "2026-01-01T00:10:00.000Z",
        "durationMs": 595000,
        "answeredCount": 10,
        "correctCount": 9,
        "incorrectCount": 1,
        "totalQuestions": 10,
        "accuracy": 0.9,
        "accuracyPercentage": 90,
        "score": 9800,
        "gameScore": 9800,
        "rawScore": 8500,
        "finalRank": 1,
        "bestStreak": 5,
        "academicBestStreak": 5,
        "totalResponseTimeMs": 28000,
        "averageResponseTimeMs": 2800,
        "averageResponseTime": 2.8,
        "wrongQuestionCount": 1,
        "unansweredCount": 0,
        "wrongQuestions": [
          {
            "index": 3,
            "questionId": "<questionId>",
            "text": "What is x?",
            "selectedOptionId": "<optionId>",
            "responseTimeMs": 2500
          }
        ],
        "unansweredQuestions": [],
        "needsFollowUp": true,
        "followUpReasons": ["LOW_ACCURACY"]
      }
    ],
    "commands": {
      "total": 3,
      "byType": {
        "GIFT": { "total": 1, "completed": 1, "cancelled": 0, "pending": 0 },
        "THIEF": { "total": 1, "completed": 1, "cancelled": 0, "pending": 0 },
        "ROCKET": { "total": 1, "completed": 0, "cancelled": 1, "pending": 0 }
      },
      "byStatus": { "COMPLETED": 2, "CANCELLED": 1 },
      "log": [
        {
          "id": "<commandDocId>",
          "commandId": "<sessionId>:GIFT:0:<actorId>",
          "type": "GIFT",
          "status": "COMPLETED",
          "actorId": "<participantId>",
          "actorName": "Sara Ali",
          "actorNickname": "sara",
          "targetId": null,
          "targetName": null,
          "targetNickname": null,
          "questionId": "<questionId>",
          "questionIndex": 0,
          "value": 300,
          "result": {},
          "error": null,
          "startedAt": "2026-01-01T00:01:00.000Z",
          "completedAt": "2026-01-01T00:01:01.000Z",
          "createdAt": "2026-01-01T00:01:00.000Z"
        }
      ]
    }
  }
}
```

Key semantics:

- `studentResults[].rawScore` is the academic score: the sum of the snapshot `question.points` for correct answers only. It is never changed by speed or commands.
- `studentResults[].gameScore` is the existing `score` (speed formula plus gameplay effects). Both values are persisted server-side.
- `studentResults[].accuracy` is a percentage (`90` means 90%). `studentAnalysis[].accuracy` stays a 0–1 ratio (`0.9`); `accuracyPercentage` is also provided.
- `studentResults[].bestStreak` is the academic consecutive-correct maximum. `studentAnalysis[].bestStreak` is the gameplay streak, which Streak Shield can preserve; `academicBestStreak` is the academic value in both sections.
- `studentResults[].averageResponseTime` is in seconds. `averageResponseTimeMs` remains in milliseconds for existing consumers. Both are `0` when no question was answered.
- Unanswered questions are excluded from accuracy and response-time denominators and are not counted as incorrect. They do break the academic best-streak run.
- `registeredParticipants` counts non-guest attendance records (roster students, joined or absent).
- `joinedParticipants` counts records with a `participant` (everyone who actually joined, including guests).
- `actualAttendees` counts `PRESENT` records only.
- `absentees` counts `ABSENT` records only; `kicked` is reported separately.
- `attendanceRate = roster present / registered` (guests excluded). `participationRate = joined / (registered + guests)`.
- Question `skippedCount = joinedParticipants - totalAnswers` for that question.
- `needsFollowUp` is `true` when a record is `ABSENT`, `KICKED`, has accuracy below 50%, or has unanswered questions.
- `commandStatistics` is the same object as the legacy `commands` field.

### Student history example

```http
GET /api/students/<studentId>/history?from=2026-01-01T00:00:00.000Z&to=2026-02-01T00:00:00.000Z&limit=20&offset=0
```

```json
{
  "history": {
    "student": {
      "id": "<studentId>",
      "name": "Sara Ali",
      "nickname": "sara",
      "section": "<sectionId>",
      "avatar": { "preset": "cat", "color": "blue" }
    },
    "filters": {
      "from": "2026-01-01T00:00:00.000Z",
      "to": "2026-02-01T00:00:00.000Z",
      "session": null,
      "quiz": null,
      "status": null
    },
    "pagination": { "total": 12, "limit": 20, "offset": 0, "hasMore": false },
    "summary": {
      "sessions": 12,
      "attendedSessions": 11,
      "present": 10,
      "absent": 2,
      "kicked": 0,
      "late": 1,
      "totalAnswered": 108,
      "totalCorrect": 84,
      "accuracy": 0.7778,
      "accuracyPercentage": 77.78,
      "averageScore": 4100,
      "bestScore": 9500,
      "averageResponseTimeMs": 3200
    },
    "history": [
      {
        "id": "<attendanceId>",
        "status": "PRESENT",
        "name": "Sara Ali",
        "nickname": "sara",
        "section": "<historicalSectionId>",
        "sectionName": "Grade 10 A",
        "late": false,
        "durationMs": 595000,
        "answeredCount": 10,
        "correctCount": 9,
        "incorrectCount": 1,
        "accuracy": 0.9,
        "accuracyPercentage": 90,
        "score": 9800,
        "finalRank": 1,
        "averageResponseTimeMs": 2800,
        "session": {
          "id": "<sessionId>",
          "startedAt": "2026-01-01T00:00:00.000Z",
          "endedAt": "2026-01-01T00:10:00.000Z"
        },
        "quiz": { "id": "<quizId>", "title": "Algebra Basics" }
      }
    ]
  }
}
```

History rows use the **historical section snapshot** stored at finalization. Moving a student to another section later does not rewrite past attendance.

### Data model

`Attendance` stores a materialized snapshot per `(session, student)` or `(session, participant)`:

| Field | Notes |
| ----- | ----- |
| `session`, `organization` | Required, indexed |
| `student`, `participant` | Either may be `null`; both are indexed |
| `section`, `sectionName` | Historical section snapshot |
| `name`, `nickname` | Historical participant/roster identity |
| `quiz`, `quizTitle` | Historical quiz snapshot |
| `sessionStartedAt`, `sessionEndedAt` | Session window snapshot |
| `status` | `PRESENT`, `ABSENT`, `KICKED`, or `PENDING` |
| `guest`, `rosterMissing`, `late`, `connected` | Participation flags |
| `joinedAt`, `leftAt`, `durationMs` | Timing |
| `answeredCount`, `correctCount`, `totalQuestions` | Participation counts |
| `score`, `finalRank`, `bestStreak`, `totalResponseTimeMs` | Performance snapshot (`score` is the game score) |
| `rawScore`, `academicBestStreak` | Academic score and academic consecutive-correct maximum |
| `finalizedAt` | When the snapshot was written |

`Session` gains `attendanceThreshold` (default `0.5`, range 0–1) and `attendanceFinalizedAt` (set once, used for idempotent lazy finalization).

### Phase 7 limitations

- Reports are available only for `FINISHED` sessions; live/paused sessions return `409` for reports.
- Attendance finalization reads the **current organization roster** at finalization time. Students added to the roster after a session ends are not retroactively marked absent for that session unless attendance is force-finalized.
- There is no manual attendance override, edit, or excuse/leave status yet.
- Absentee records are created for every roster student in the organization, not only students enrolled at the time of the session. There is no historical enrollment snapshot, and finalization has no per-section scoping (the attendance `section` filter only filters the response).
- Student history for a deleted roster `Student` returns `404`; historical attendance rows remain in the database with `rosterMissing: true`.
- `averageAccuracy` in the report averages only participants who answered at least one question; `averageCorrectAnswers` averages over all joined participants.
- `hardestQuestion` ignores questions with zero answers.
- Command logs are read from `SessionCommand`; there is still no standalone endpoint to list `SessionEvent` history.
- History `from`/`to` filter on the session end time, not the join time.
- No email delivery or scheduled report generation (Excel download is implemented in Phase 8).
- `Attendance` is materialized at finish time; a mid-session server crash may leave a finished session unfinalized until the next attendance/report read finalizes it lazily.

### Phase 10 scoring limitations and compatibility notes

- `rawScore` is persisted on new answers (`Answer.rawScoreAwarded`) and players (`SessionPlayer.rawScore`). Answers written before Phase 10 are backfilled from the session question snapshot during reconciliation; report reads also recompute the raw score from `Answer` records, so finished reports remain accurate.
- `Attendance.rawScore` and `Attendance.academicBestStreak` are only written by Phase 10 finalization. Finalized attendance documents from older deployments hydrate to `0` when read directly through the attendance API; use the session report for authoritative recomputed values.
- Question `points` is now validated as `1-10000` on create/update. Existing questions with `0` remain readable, but new or updated values must be at least `1`.
- Academic best streak treats an unanswered question as a break in the consecutive-correct run. This is intentional: the sequence is defined over the full question order.
- `averageResponseTime` is `0` (not `null`) when no question was answered, and uses answered questions only.
- `studentResults` includes one row per attendance record, including absentees and kicked participants. It does not include per-student selected-answer history.
- The report remains available only for `FINISHED` sessions; there is no live report endpoint.

---

## Excel Export (Phase 8)

### `GET /api/sessions/:id/report/export`

Downloads a `.xlsx` workbook for a finished session.

```text
Authorization: Bearer <token>   (OWNER, TEACHER, or ASSISTANT)
```

| Condition | Result |
| --------- | ------ |
| `ADMIN` (SUPER ADMIN) | `403` — admin accounts cannot use organization endpoints |
| Session in another organization | `404` — resource existence is not leaked |
| Session not `FINISHED` | `409` |
| Invalid session id | `400` |
| Missing session | `404` |

Response headers:

```text
Content-Type: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet
Content-Disposition: attachment; filename="yalla-class-report-<JOINCODE>-YYYYMMDD-HHMMSS.xlsx"
Content-Length: <bytes>
```

The workbook is generated in memory with ExcelJS and sent directly; no temporary or permanent file is written to disk.

The export calls the same `getSessionReport()` service used by `GET /api/sessions/:id/report`, so the workbook always matches the JSON report. Organization and teacher names are loaded separately for the summary sheet.

Excel is an optional convenience export. The JSON report is the primary frontend contract; the Student Results sheet mirrors `studentResults` (`Raw Score`/`Game Score` are the same values as `rawScore`/`gameScore`, and `Best Streak` is the academic streak).

### Worksheets

| Sheet | Columns |
| ----- | ------- |
| `Session Summary` | Field, Value (organization name, quiz title, session date, teacher name, total questions, total registered participants, actual attendees, absentees, kicked participants, average accuracy, average response time, session duration) |
| `Attendance` | Student Name, Nickname, Section, Attendance Status, Join Time, Leave Time, Participation Duration, Answered Questions, Correct Answers, Attendance Percentage |
| `Student Results` | Student Name, Nickname, Section, Raw Score, Game Score, Final Rank, Correct Answers, Incorrect Answers, Accuracy Percentage, Average Response Time (ms), Best Streak |
| `Question Analysis` | Question Order, Question Text, Total Answers, Correct Answers, Incorrect Answers, Correct Answer Percentage, Average Response Time (ms) |
| `Commands` | Command Type, Actor, Target, Value / Effect, Question, Timestamp |

Every sheet is always created. Sheets with no records still contain their header row.

### Formatting and safety

- Header rows are frozen, styled, and protected with an auto-filter (except the two-column summary sheet).
- Column widths are sized for readability; long question text wraps.
- Dates use `yyyy-mm-dd hh:mm:ss`, counts use `0`, scores use `#,##0`, and percentages use `0.00`.
- Arabic text is written as UTF-8 and preserved in names, nicknames, sections, quiz titles, and question text.
- User-provided text that begins with `=`, `+`, `-`, `@`, a tab, or a carriage return is prefixed with `'` to prevent spreadsheet formula injection.
- Guest participants export with an empty section, and participants whose roster `Student` was deleted are included with their historical identity (`rosterMissing`).
- Numeric values are written as numbers, not strings, so Excel can sort and aggregate them.

---

## Admin

All `/api/admin/*` endpoints require:

```text
Authentication + ADMIN role
```

Regular organization users receive `403`. In the account model, `ADMIN` is the platform-level **SUPER ADMIN** role.

### `POST /api/admin/organizations`

Creates an organization and its initial `OWNER` in one server-side operation.

- Authentication: Yes
- Role: `ADMIN` (SUPER ADMIN)
- Creates: `Organization` + `User` (role `OWNER`, linked to the new organization)
- Uses a MongoDB transaction when the deployment supports it; otherwise rolls back partial writes on failure

Request body:

```json
{
  "name": "My Classroom",
  "owner": {
    "name": "Omar Ahmed",
    "email": "omar@example.com",
    "password": "temporary-password"
  }
}
```

Validation:

- Organization name: 2-100 characters
- Owner name: 2-80 characters
- Owner email: valid and globally unique
- Owner password: 8-72 characters

Response `201`:

```json
{
  "success": true,
  "message": "Organization and owner created successfully",
  "data": {
    "organization": {
      "id": "<organizationId>",
      "name": "My Classroom",
      "status": "ACTIVE",
      "owner": {
        "id": "<ownerId>",
        "name": "Omar Ahmed",
        "email": "omar@example.com",
        "status": "ACTIVE"
      },
      "memberCount": 1,
      "createdAt": "2026-01-01T00:00:00.000Z",
      "updatedAt": "2026-01-01T00:00:00.000Z"
    },
    "owner": {
      "id": "<ownerId>",
      "name": "Omar Ahmed",
      "email": "omar@example.com",
      "role": "OWNER",
      "status": "ACTIVE",
      "organization": "<organizationId>",
      "avatar": "",
      "createdAt": "2026-01-01T00:00:00.000Z",
      "updatedAt": "2026-01-01T00:00:00.000Z"
    }
  }
}
```

Errors: `400` validation, `409` duplicate email. The password is never returned.

---

### `GET /api/admin/users`

- Authentication: Yes
- Role: `ADMIN`

Response `200`:

```json
{
  "success": true,
  "message": "Users retrieved successfully",
  "data": {
    "users": [
      {
        "id": "<userId>",
        "name": "Omar Ahmed",
        "email": "omar@example.com",
        "role": "OWNER",
        "status": "ACTIVE",
        "organization": "<organizationId>",
        "avatar": "",
        "createdAt": "2026-01-01T00:00:00.000Z",
        "updatedAt": "2026-01-01T00:00:00.000Z"
      }
    ]
  }
}
```

Passwords and password hashes are never returned.

---

### `GET /api/admin/users/:id`

- Authentication: Yes
- Role: `ADMIN`

Response `200`:

```json
{
  "success": true,
  "message": "User retrieved successfully",
  "data": {
    "user": {
      "id": "<userId>",
      "name": "Omar Ahmed",
      "email": "omar@example.com",
      "role": "OWNER",
      "status": "ACTIVE",
      "organization": "<organizationId>",
      "avatar": "",
      "createdAt": "2026-01-01T00:00:00.000Z",
      "updatedAt": "2026-01-01T00:00:00.000Z"
    }
  }
}
```

Errors: `400` invalid id, `404` user not found.

---

### `PATCH /api/admin/users/:id/status`

Suspends or reactivates a user.

- Authentication: Yes
- Role: `ADMIN`
- An admin cannot change their own status

Request body:

```json
{
  "status": "SUSPENDED"
}
```

Allowed values: `ACTIVE`, `SUSPENDED`.

Response `200`:

```json
{
  "success": true,
  "message": "User status updated successfully",
  "data": {
    "user": {
      "id": "<userId>",
      "name": "Omar Ahmed",
      "email": "omar@example.com",
      "role": "OWNER",
      "status": "SUSPENDED",
      "organization": "<organizationId>",
      "avatar": "",
      "createdAt": "2026-01-01T00:00:00.000Z",
      "updatedAt": "2026-01-01T00:00:00.000Z"
    }
  }
}
```

A suspended user cannot log in and cannot use an existing JWT.

Errors: `400` invalid id/status or self-change, `404` user not found.

---

### `GET /api/admin/organizations`

- Authentication: Yes
- Role: `ADMIN`

Response `200`:

```json
{
  "success": true,
  "message": "Organizations retrieved successfully",
  "data": {
    "organizations": [
      {
        "id": "<organizationId>",
        "name": "My Classroom",
        "status": "ACTIVE",
        "owner": {
          "id": "<ownerId>",
          "name": "Omar Ahmed",
          "email": "omar@example.com",
          "status": "ACTIVE"
        },
        "memberCount": 3,
        "createdAt": "2026-01-01T00:00:00.000Z",
        "updatedAt": "2026-01-01T00:00:00.000Z"
      }
    ]
  }
}
```

`memberCount` includes the owner.

---

### `GET /api/admin/organizations/:id`

- Authentication: Yes
- Role: `ADMIN`

Response `200`:

```json
{
  "success": true,
  "message": "Organization retrieved successfully",
  "data": {
    "organization": {
      "id": "<organizationId>",
      "name": "My Classroom",
      "status": "ACTIVE",
      "owner": {
        "id": "<ownerId>",
        "name": "Omar Ahmed",
        "email": "omar@example.com",
        "status": "ACTIVE"
      },
      "memberCount": 3,
      "createdAt": "2026-01-01T00:00:00.000Z",
      "updatedAt": "2026-01-01T00:00:00.000Z"
    }
  }
}
```

Errors: `400` invalid id, `404` organization not found.

---

### `PATCH /api/admin/organizations/:id`

Updates an organization's name.

- Authentication: Yes
- Role: `ADMIN` (SUPER ADMIN)

Request body:

```json
{
  "name": "Renamed Classroom"
}
```

Response `200`:

```json
{
  "success": true,
  "message": "Organization updated successfully",
  "data": {
    "organization": {
      "id": "<organizationId>",
      "name": "Renamed Classroom",
      "status": "ACTIVE",
      "owner": {
        "id": "<ownerId>",
        "name": "Omar Ahmed",
        "email": "omar@example.com",
        "status": "ACTIVE"
      },
      "memberCount": 3,
      "createdAt": "2026-01-01T00:00:00.000Z",
      "updatedAt": "2026-01-01T00:00:00.000Z"
    }
  }
}
```

Errors: `400` invalid id/body, `404` organization not found.

---

### `PATCH /api/admin/organizations/:id/status`

Suspends or reactivates an organization.

- Authentication: Yes
- Role: `ADMIN` (SUPER ADMIN)
- A suspended organization's users cannot log in or use existing REST tokens
- New student joins and new Socket.IO connections for that organization are rejected
- Already-connected Socket.IO clients are not force-disconnected; they are rejected the next time they authenticate

Request body:

```json
{
  "status": "SUSPENDED"
}
```

Allowed values: `ACTIVE`, `SUSPENDED`.

Response `200`: same `data.organization` shape with the new `status`.

Errors: `400` invalid id/status, `404` organization not found.

---

## Data Models

### User

```text
name          String, required, 2-80 chars
email         String, required, unique, lowercase
passwordHash  String, required, bcrypt hash, never selected by default
role          OWNER | TEACHER | ASSISTANT | ADMIN
organization  ObjectId -> Organization (null for ADMIN)
status        ACTIVE | SUSPENDED (default ACTIVE)
avatar        String (default "")
createdAt     Date
updatedAt     Date
```

### Organization

```text
name          String, required, 2-100 chars
owner         ObjectId -> User, required
status        ACTIVE | SUSPENDED (default ACTIVE)
createdAt     Date
updatedAt     Date
```

`owner` is the organization's initial `OWNER`, created with the organization by a SUPER ADMIN. `status` gates login, authenticated requests, student joins, and Socket.IO access for the organization's users.

### Quiz

```text
title         String, required, 1-150 chars
description   String, optional, max 1000 chars
organization  ObjectId -> Organization, required
createdBy     ObjectId -> User, required
status        ACTIVE | ARCHIVED (default ACTIVE)
archivedAt    Date | null
createdAt     Date
updatedAt     Date
```

`questionCount` and `estimatedDurationSec` are calculated from related questions rather than stored on the quiz.

### Question

```text
quiz          ObjectId -> Quiz, required
text          String, required, 1-1000 chars
points        Number, default 1000, 1-10000
timeLimitSec  Number, default 10, 5-120
order         Number, default 0, >= 0
options       Embedded Option array, 2-4 items
createdAt     Date
updatedAt     Date
```

### Option (embedded)

```text
text          String, required, max 500 chars
isCorrect     Boolean, default false
```

A question must have exactly one option with `isCorrect: true`.

### Section

```text
name          String, required, 1-100 chars
description   String, optional, max 500 chars
organization  ObjectId -> Organization, required
createdBy     ObjectId -> User, required
createdAt     Date
updatedAt     Date
```

Section names are unique inside an organization. `studentCount` is calculated from related students rather than stored on the section.

### Student

```text
name          String, required, 1-80 chars
nickname      String, optional, max 50 chars
organization  ObjectId -> Organization, required
section       ObjectId -> Section, required
avatar        Embedded Avatar object
createdAt     Date
updatedAt     Date
```

Students are roster records, not authenticated users. They have no email, password, or JWT.

### Avatar (embedded on Student and SessionPlayer)

```text
preset        One of the allowed avatar presets (default FOX)
color         One of the allowed palette colors (default #3B82F6)
```

Allowed values are exposed by `GET /api/avatars/options`. Arbitrary preset or color values are rejected.

### Session

```text
quiz                  ObjectId -> Quiz, required
organization          ObjectId -> Organization, required
createdBy             ObjectId -> User, required
joinCode              String, required, unique, 6 safe uppercase characters
status                LOBBY | LIVE | PAUSED | FINISHED (default LOBBY)
joinOpen              Boolean, default true
startedAt             Date | null
endedAt               Date | null
gameState             IDLE | COUNTDOWN | QUESTION | REVEAL | EXPLANATION | POINTS |
                      LEADERBOARD | PHONE_LEADERBOARD | GIFT | THIEF | ROCKET | FINISHED
                      (default IDLE)
gameQuestions         Snapshot array: question, text, points, timeLimitSec, order, explanation, options[]
currentQuestionIndex  Number, default -1
phaseStartedAt        Date | null
phaseEndsAt           Date | null
remainingTimeMs       Number | null (paused phase time)
pausedAt              Date | null
commandSettings       { gift, thief, rocket } booleans, all default false
phaseSettings         { revealMs, explanationMs, pointsMs, leaderboardMs, phoneLeaderboardMs,
                        showReveal, showExplanation, showPoints, showLeaderboard,
                        showPhoneLeaderboard }
activeCommand         ObjectId -> SessionCommand | null
attendanceThreshold   Number, default 0.5, range 0-1
attendanceFinalizedAt Date | null
createdAt             Date
updatedAt             Date
```

`gameQuestions` is a snapshot written when the game starts, so editing or deleting quiz questions does not change a live game. `participantCount`, `questionProgress`, and quiz statistics are calculated from related records rather than stored on the session. `commandSettings` and `phaseSettings` are per-session; `GAME_*` environment values are defaults. `attendanceThreshold` is the fraction of questions a participant must answer to be `PRESENT`; `attendanceFinalizedAt` marks a finalized attendance snapshot and makes lazy finalization idempotent.

### SessionPlayer (session participant)

```text
session               ObjectId -> Session, required
organization          ObjectId -> Organization, required
student               ObjectId -> Student | null
section               ObjectId -> Section | null
name                  String, required, 1-80 chars
nickname              String, required, 1-50 chars
nicknameKey           String, required, lowercase, hidden from query results
avatar                Embedded Avatar object
tokenHash             String, required, unique, SHA-256 participant token hash, hidden from query results
status                ACTIVE | KICKED (default ACTIVE)
score                 Number, default 0 (gameplay score, exposed as gameScore)
rawScore              Number, default 0 (academic score, unaffected by speed/commands)
streak                Number, default 0
bestStreak            Number, default 0
answeredCount         Number, default 0
correctCount          Number, default 0
totalResponseTimeMs   Number, default 0
answeredQuestions     ObjectId[] -> Question (idempotency guard)
doublePointsActive    Boolean, default false
streakShieldActive    Boolean, default false
colorShards           Number, default 0
unlockedColors        String[], default []
giftsReceived         Number, default 0
lastGiftCards         String[], default []
appliedCommandIds     String[], default [] (command idempotency guard)
connected             Boolean, default false
connectionCount       Number, default 0
lastConnectedQuestionIndex Number | null
offlineSinceQuestionIndex  Number | null (question index when the player went offline)
lastConnectedAt       Date | null
lastDisconnectedAt    Date | null
lastAnswerAt          Date | null
finalRank             Number | null
joinedAt              Date
lastSeenAt            Date
kickedAt              Date | null
createdAt             Date
updatedAt             Date
```

Nicknames are unique per session (case-insensitive). A roster student can participate only once per session. Participant records are separate from `User` accounts and have no email, password, or JWT.

### Answer

```text
session           ObjectId -> Session, required
organization      ObjectId -> Organization, required
sessionPlayer     ObjectId -> SessionPlayer, required
question          ObjectId -> Question, required
selectedOptionId  ObjectId, required
isCorrect         Boolean, required
responseTimeMs    Number, required, >= 0
basePointsAwarded Number, default 0 (speed-based value before card effects)
rawScoreAwarded   Number, default 0 (full question points when correct, 0 otherwise)
pointsAwarded     Number, required, >= 0 (effective value after Double Points)
doublePointsApplied Boolean, default false
streakShieldApplied Boolean, default false
streakAfter       Number, default 0
applied           Boolean, default false (player score already updated)
submittedAt       Date
createdAt         Date
updatedAt         Date
```

`Answer` has a unique index on `(sessionPlayer, question)`, enforcing one answer per player per question at the database level.

### SessionCommand

```text
session              ObjectId -> Session, required
organization         ObjectId -> Organization, required
commandId            String, required, unique (session:type:questionIndex:actor)
type                 GIFT | THIEF | ROCKET
priority             Number, required, >= 1 (GIFT=1, THIEF=2, ROCKET=3)
actor                ObjectId -> SessionPlayer, required
target               ObjectId -> SessionPlayer | null
question             ObjectId -> Question | null
questionIndex        Number, default -1
status               QUEUED | PROCESSING | AWAITING_TARGET | COMPLETED | CANCELLED
selectionEndsAt      Date | null
remainingSelectionMs Number | null (paused selection time)
startedAt            Date | null
completedAt          Date | null
result               Mixed (target/score/auto-selection details)
metadata             Mixed (actor nickname, unlock streak, eligible target count, etc.)
error                String | null
createdAt            Date
updatedAt            Date
```

`SessionCommand.commandId` is unique. The queue is ordered by `priority`, then creation time, then id. Only one command per session can be `PROCESSING` or `AWAITING_TARGET`.

### SessionEvent

```text
session        ObjectId -> Session, required
organization   ObjectId -> Organization, required
type           String, required (GIFT | THIEF | ROCKET | TEACHER_*)
actorType      PLAYER | TEACHER | SYSTEM
actorId        ObjectId | null
targetId       ObjectId -> SessionPlayer | null
value          Number, default 0
question       ObjectId -> Question | null
questionIndex  Number, default -1
timestamp      Date, default now
metadata       Mixed (cards, effects, scores, selection reason, etc.)
dedupeKey      String | null, unique when present
createdAt      Date
updatedAt      Date
```

Command events use the command's `commandId` as `dedupeKey`. The unique partial index guarantees that retries cannot create duplicate command events.

### Attendance

```text
session              ObjectId -> Session, required
organization         ObjectId -> Organization, required
student              ObjectId -> Student | null
participant          ObjectId -> SessionPlayer | null
section              ObjectId -> Section | null
sectionName          String, default "" (historical snapshot)
name                 String, required, 1-80 chars
nickname             String, required, 1-50 chars
quiz                 ObjectId -> Quiz | null
quizTitle            String, default ""
sessionStartedAt     Date | null
sessionEndedAt       Date | null
status               PRESENT | ABSENT | KICKED | PENDING (default PENDING)
guest                Boolean, default false
rosterMissing        Boolean, default false
late                 Boolean, default false
connected            Boolean, default false
joinedAt             Date | null
leftAt               Date | null
durationMs           Number, default 0
answeredCount        Number, default 0
correctCount         Number, default 0
totalQuestions       Number, default 0
score                Number, default 0 (gameplay score)
rawScore             Number, default 0 (academic score)
finalRank            Number | null
bestStreak           Number, default 0 (gameplay best streak)
academicBestStreak   Number, default 0 (academic consecutive-correct maximum)
totalResponseTimeMs  Number, default 0
finalizedAt          Date | null
createdAt            Date
updatedAt            Date
```

Unique partial indexes on `(session, student)` and `(session, participant)` prevent duplicate attendance. Additional indexes cover `(organization, session, status)`, `(organization, student, sessionEndedAt)`, and `(organization, student, createdAt)`. A record has a `student`, a `participant`, or both; guests have `student: null`, and roster absentees have `participant: null`.

---

## SUPER ADMIN Account Bootstrap

There is no public registration. SUPER ADMIN accounts are created with a CLI script; the script is the only way to provision the first platform administrator.

```bash
npm run create-admin -- --name "Platform Admin" --email admin@example.com --password "strong-password"
```

The script:

- requires a valid email and an 8-72 character password
- hashes the password with bcrypt
- creates a user with role `ADMIN` (SUPER ADMIN) and no organization
- refuses to overwrite an existing email

After logging in, the SUPER ADMIN creates each organization and its initial `OWNER` with `POST /api/admin/organizations`. The `OWNER` then logs in and creates `TEACHER`/`ASSISTANT` members through the organization member endpoints. Run the script from the project root after configuring `.env`.

---

## Testing

### Automated smoke test

```bash
npm run test:smoke
```

This script:

- starts the API on port `4100`
- uses the isolated database `yalla_class_smoke` (override with `SMOKE_MONGODB_URI`)
- creates a temporary SUPER ADMIN account
- runs **1253 checks** covering login, JWT validation, suspended users, role authorization, organization isolation, member management, admin endpoints, quiz/question CRUD, search, archive/unarchive, duplication, section/student CRUD, section deletion guards, student search/filter/move/import, avatar validation, session creation, game code uniqueness, lifecycle transitions, lobby listing, kicking, join locking, public join/reconnect, duplicate nickname/student blocking, closed/paused/finished join blocking, cross-organization blocking, invalid/oversized bodies, invalid IDs, password leakage, and login/join rate limiting
- provisioning checks cover removal of public registration, SUPER ADMIN organization + `OWNER` creation, ownership linking, duplicate-email rejection, rollback on partial creation failure, organization rename/suspend/reactivate, non-admin provisioning rejection, and `OWNER`/`ADMIN` role rejection in member management
- Phase 5 checks cover Socket.IO teacher/player authentication, assistant/player control rejection, game start/countdown, question payload hiding correct answers, correct/incorrect scoring, client score spoofing, duplicate answers, answer deadlines, early question end, streaks and best streaks, leaderboard ordering and ties, reveal/explanation/leaderboard events, pause/resume with remaining time, player disconnect/reconnect, late joining, kicking during a live game, automatic completion, persisted final ranks, server restart recovery, and cleanup of stale `connected` flags after a crash/restart
- Phase 6 checks cover teacher live controls, permissions, command settings, phase settings, Gift/Thief/Rocket rules, card effects and rarity, target eligibility, timeouts, queue ordering, disconnect behavior, duplicate execution prevention, and `SessionEvent` records
- Phase 7 checks cover attendance finalization, the 50% answered-question rule, present/absent/kicked/guest/missing-roster cases, late joins, join/leave timing and duration, historical section snapshots, duplicate prevention and idempotent re-finalization, absentee upgrades, live and paused sessions, report calculations (attendance, accuracy, scores, ranks, response time, hardest question, answer distribution, follow-up flags, section summaries, command usage/log), student history filters and pagination, and cross-organization/permission blocking
- Phase 8 checks cover valid XLSX generation, all five worksheets and headers, Arabic text preservation, empty sheets, guest participants, missing roster records, JSON-report consistency, command records, response headers, safe filenames, invalid/missing session ids, unfinished sessions, unauthorized/cross-organization access, and formula-injection protection
- Phase 9 runs a full product journey: CLI SUPER ADMIN provisioning, admin login, organization + `OWNER` creation, `OWNER` login, `TEACHER`/`ASSISTANT` creation, section/students, quiz/questions, live session, public joins (student + guest), Socket.IO start/pause/resume/answers, streak and leaderboard checks, a real Gift unlock, explicit finish, persisted ranks, finalized attendance, JSON report, Excel export, workbook-to-report consistency, and admin rename/suspend/reactivate
- Phase 10 checks cover configurable question points (create/update/default/invalid/snapshot), raw-score rules (full base points, incorrect/unanswered zero, speed independence, Double Points/Gift/Leaderboard Strike/Thief/Rocket isolation), game-score preservation, academic vs gameplay best streak, attendance persistence, the `studentResults` report contract, guest/kicked/absent statistics, token-hash non-exposure, question base points, `commandStatistics`, Excel/JSON consistency, and report authorization/finished-session restrictions
- stops the server and drops the test database

MongoDB must be running.

### Manual test flow

```powershell
$base = "http://localhost:4000/api"

# One-time CLI provisioning:
# npm run create-admin -- --name "Platform Admin" --email admin@example.com --password "strong-password"

$adminLogin = Invoke-RestMethod -Method Post -Uri "$base/auth/login" `
  -ContentType "application/json" `
  -Body (@{
    email = "admin@example.com"
    password = "strong-password"
  } | ConvertTo-Json)

$adminHeaders = @{ Authorization = "Bearer $($adminLogin.data.token)" }

$created = Invoke-RestMethod -Method Post -Uri "$base/admin/organizations" `
  -Headers $adminHeaders `
  -ContentType "application/json" `
  -Body (@{
    name = "My Classroom"
    owner = @{
      name = "Omar Ahmed"
      email = "omar@example.com"
      password = "temporary-password"
    }
  } | ConvertTo-Json -Depth 4)

# The OWNER logs in with the temporary password supplied by the SUPER ADMIN.
$login = Invoke-RestMethod -Method Post -Uri "$base/auth/login" `
  -ContentType "application/json" `
  -Body (@{
    email = "omar@example.com"
    password = "temporary-password"
  } | ConvertTo-Json)

$token = $login.data.token
$headers = @{ Authorization = "Bearer $token" }

Invoke-RestMethod -Uri "$base/auth/me" -Headers $headers
Invoke-RestMethod -Uri "$base/organization" -Headers $headers
Invoke-RestMethod -Uri "$base/organization/members" -Headers $headers
```

Create a quiz and a question:

```powershell
$quiz = Invoke-RestMethod -Method Post -Uri "$base/quizzes" `
  -Headers $headers `
  -ContentType "application/json" `
  -Body (@{
    title = "Algebra Basics"
    description = "A short algebra quiz"
  } | ConvertTo-Json)

$quizId = $quiz.data.quiz.id

Invoke-RestMethod -Method Post -Uri "$base/quizzes/$quizId/questions" `
  -Headers $headers `
  -ContentType "application/json" `
  -Body (@{
    text = "What is 2 + 2?"
    points = 1000
    timeLimitSec = 15
    options = @(
      @{ text = "3"; isCorrect = $false }
      @{ text = "4"; isCorrect = $true }
      @{ text = "5"; isCorrect = $false }
    )
  } | ConvertTo-Json -Depth 5)

Invoke-RestMethod -Uri "$base/quizzes?search=algebra" -Headers $headers
Invoke-RestMethod -Uri "$base/quizzes/$quizId" -Headers $headers
Invoke-RestMethod -Method Post -Uri "$base/quizzes/$quizId/duplicate" -Headers $headers
Invoke-RestMethod -Method Patch -Uri "$base/quizzes/$quizId/archive" -Headers $headers
```

Create a section, add students, and customize an avatar:

```powershell
$section = Invoke-RestMethod -Method Post -Uri "$base/sections" `
  -Headers $headers `
  -ContentType "application/json" `
  -Body (@{
    name = "Grade 10 A"
    description = "First section"
  } | ConvertTo-Json)

$sectionId = $section.data.section.id

$student = Invoke-RestMethod -Method Post -Uri "$base/students" `
  -Headers $headers `
  -ContentType "application/json" `
  -Body (@{
    name = "Student One"
    nickname = "S1"
    section = $sectionId
    avatar = @{ preset = "FOX"; color = "#3B82F6" }
  } | ConvertTo-Json -Depth 5)

$studentId = $student.data.student.id

Invoke-RestMethod -Uri "$base/avatars/options" -Headers $headers
Invoke-RestMethod -Uri "$base/students?section=$sectionId&search=student" -Headers $headers
Invoke-RestMethod -Uri "$base/sections/$sectionId" -Headers $headers

Invoke-RestMethod -Method Patch -Uri "$base/students/$studentId/avatar" `
  -Headers $headers `
  -ContentType "application/json" `
  -Body (@{ preset = "ROBOT"; color = "#8B5CF6" } | ConvertTo-Json)

Invoke-RestMethod -Method Post -Uri "$base/students/import" `
  -Headers $headers `
  -ContentType "application/json" `
  -Body (@{
    section = $sectionId
    students = @(
      @{ name = "Ali Hassan"; nickname = "Ali" }
      @{ name = "Mona Adel" }
    )
  } | ConvertTo-Json -Depth 5)
```

Create a live session and run the public join flow:

```powershell
$session = Invoke-RestMethod -Method Post -Uri "$base/sessions" `
  -Headers $headers `
  -ContentType "application/json" `
  -Body (@{ quiz = $quizId } | ConvertTo-Json)

$sessionId = $session.data.session.id
$joinCode = $session.data.session.joinCode

Invoke-RestMethod -Uri "$base/sessions?status=LOBBY" -Headers $headers
Invoke-RestMethod -Uri "$base/sessions/$sessionId" -Headers $headers
Invoke-RestMethod -Uri "$base/sessions/$sessionId/lobby" -Headers $headers
Invoke-RestMethod -Uri "$base/join/$joinCode"

$join = Invoke-RestMethod -Method Post -Uri "$base/join/$joinCode" `
  -ContentType "application/json" `
  -Body (@{
    studentId = $studentId
    avatar = @{ preset = "PANDA"; color = "#EC4899" }
  } | ConvertTo-Json -Depth 5)

$participantId = $join.data.participant.id
$participantToken = $join.data.participant.participantToken

Invoke-RestMethod -Method Post -Uri "$base/join/$joinCode/reconnect" `
  -ContentType "application/json" `
  -Body (@{ participantToken = $participantToken } | ConvertTo-Json)

Invoke-RestMethod -Method Delete -Uri "$base/sessions/$sessionId/participants/$participantId" `
  -Headers $headers

Invoke-RestMethod -Method Patch -Uri "$base/sessions/$sessionId/join-lock" `
  -Headers $headers `
  -ContentType "application/json" `
  -Body (@{ joinOpen = $false } | ConvertTo-Json)

Invoke-RestMethod -Method Post -Uri "$base/sessions/$sessionId/start" -Headers $headers
Invoke-RestMethod -Method Post -Uri "$base/sessions/$sessionId/pause" -Headers $headers
Invoke-RestMethod -Method Post -Uri "$base/sessions/$sessionId/resume" -Headers $headers
Invoke-RestMethod -Method Post -Uri "$base/sessions/$sessionId/finish" -Headers $headers
```

Test real-time gameplay with a small Node.js script (`socket.io-client` is already installed):

```js
const { io } = require('socket.io-client');

const teacher = io('http://localhost:4000', {
  auth: { role: 'teacher', token: '<jwt>', sessionId: '<sessionId>' },
});

teacher.on('game:state', (state) => {
  console.log('teacher state:', state.gameState);
});

teacher.on('question:started', (payload) => {
  console.log('question:', payload.question.text);
});

teacher.on('leaderboard:updated', (payload) => {
  console.log('leaderboard:', payload.leaderboard);
});

teacher.on('game:finished', (payload) => {
  console.log('final leaderboard:', payload.leaderboard);
  teacher.close();
});

teacher.emit('game:start', (ack) => console.log('start ack:', ack));

const player = io('http://localhost:4000', {
  auth: {
    role: 'player',
    joinCode: '<joinCode>',
    participantToken: '<participantToken>',
  },
});

player.on('question:started', ({ question }) => {
  player.emit(
    'answer:submit',
    { questionId: question.id, optionId: question.options[0].id },
    (ack) => console.log('answer ack:', ack)
  );
});

player.on('answer:result', (result) => {
  console.log('result:', result.isCorrect, result.pointsAwarded, result.score);
});
```

Create an admin, then test admin endpoints:

```bash
npm run create-admin -- --name "Platform Admin" --email admin@example.com --password "strong-password"
```

```powershell
$adminLogin = Invoke-RestMethod -Method Post -Uri "$base/auth/login" `
  -ContentType "application/json" `
  -Body (@{ email = "admin@example.com"; password = "strong-password" } | ConvertTo-Json)

$adminHeaders = @{ Authorization = "Bearer $($adminLogin.data.token)" }

Invoke-RestMethod -Uri "$base/admin/users" -Headers $adminHeaders
Invoke-RestMethod -Uri "$base/admin/organizations" -Headers $adminHeaders
```

Read attendance, reports, and student history after a game:

```powershell
# Attendance for a finished (or live) session
Invoke-RestMethod -Uri "$base/sessions/$sessionId/attendance" -Headers $headers

# Attendance for one section only
Invoke-RestMethod -Uri "$base/sessions/$sessionId/attendance?section=$sectionId" -Headers $headers

# Only kicked participants
Invoke-RestMethod -Uri "$base/sessions/$sessionId/attendance?status=KICKED" -Headers $headers

# Full report (finished sessions only; live/paused return 409)
Invoke-RestMethod -Uri "$base/sessions/$sessionId/report" -Headers $headers

# Download the Excel report
Invoke-WebRequest -Uri "$base/sessions/$sessionId/report/export" `
  -Headers $headers `
  -OutFile "session-report.xlsx"

# Student attendance history, newest first
Invoke-RestMethod -Uri "$base/students/$($student.data.student.id)/history?limit=20&offset=0" -Headers $headers

# History filtered by date range and status
Invoke-RestMethod -Uri "$base/students/$($student.data.student.id)/history?from=2026-01-01T00:00:00.000Z&to=2026-02-01T00:00:00.000Z&status=PRESENT" -Headers $headers
```

Failed cases to verify manually:

- wrong password -> `401`
- missing/invalid JWT -> `401`
- suspended user -> `403`
- teacher/owner accessing `/api/admin/*` -> `403`
- user from organization A accessing organization B's member ID, quiz ID, section ID, student ID, or session ID -> `404`
- assistant attempting to create/update/delete a quiz, question, section, student, or session, or kick a participant -> `403`
- modifying an archived quiz or its questions -> `409`
- deleting a section that still contains students -> `409`
- duplicate section name in the same organization -> `409`
- unsupported avatar preset or color -> `400`
- student created or moved into another organization's section -> `404`
- session created from an archived quiz, a quiz without questions, or another organization's quiz -> `409` / `404`
- joining a closed, paused, or finished session -> `403`
- duplicate nickname or duplicate student participation in one session -> `409`
- reconnecting with an invalid participant token -> `401`
- kicking an already-kicked participant -> `409`
- requesting a report for a live, paused, or lobby session -> `409`
- attendance/report/history with an invalid ObjectId -> `400`
- attendance/report/history for another organization's session or student -> `404`
- history filtered by another organization's `session` or `quiz` -> `404`
- history with `from` after `to`, an invalid date, or an out-of-range `limit` -> `400`
- `ADMIN` requesting organization attendance, reports, or student history -> `403`
- invalid session lifecycle transition -> `409`
- Socket.IO teacher connection with another organization's session -> `SESSION_NOT_FOUND`
- Socket.IO player connection with an invalid or kicked participant token -> `INVALID_PARTICIPANT_TOKEN` / `PARTICIPANT_KICKED`
- assistant or player attempting `game:start`, `game:pause`, `game:resume`, or `game:finish` -> `FORBIDDEN`
- answering a non-current question -> `QUESTION_MISMATCH`
- answering with an option from another question -> `INVALID_OPTION`
- answering after `phaseEndsAt` -> `DEADLINE_PASSED`
- submitting a second answer for the same question -> `ALREADY_ANSWERED`
- client-supplied `score`, `pointsAwarded`, or `isCorrect` values being ignored by the server
- question with fewer than 2 options, more than 4 options, or not exactly one correct option -> `400`
- duplicate email -> `409`
- invalid body -> `400`

---

## Security Notes

- Passwords are hashed with bcrypt (cost 10) and never stored or returned in plain text.
- `passwordHash` is excluded from queries by default and stripped from JSON output.
- JWTs contain only the user id (`sub`). The user is reloaded from MongoDB on every request, so role changes and suspensions take effect immediately.
- Role checks use reusable middleware, not per-controller duplication.
- Organization data is always derived from `req.user.organization`; client-supplied organization IDs are not trusted.
- Cross-organization member, quiz/question, section, student, and session access returns `404` to avoid leaking resource existence.
- `OWNER` accounts cannot be created through public registration or member management; only a SUPER ADMIN can create them.
- Owners cannot create `ADMIN`/`OWNER` accounts, promote members to `ADMIN`/`OWNER`, or modify/delete the organization owner.
- Organization + initial `OWNER` creation is one server-side operation and uses a transaction when supported, with rollback otherwise.
- A suspended organization blocks login, existing tokens, new student joins, and Socket.IO access for its users.
- Admin accounts cannot use organization, quiz, section, student, session, or avatar endpoints and cannot belong to an organization.
- Admin cannot change their own account status.
- Quiz/question/section/student/session writes require `OWNER` or `TEACHER`; assistants are read-only.
- Archived quizzes and their questions are read-only until unarchived.
- Quiz deletion permanently removes its questions.
- A section cannot be deleted while it still contains students, preventing orphaned student records.
- Student avatar values are restricted to the predefined preset and color whitelist.
- Students are roster records, not users; they cannot authenticate or receive JWTs.
- Session participants are separate from users and authenticate per session with an opaque participant token.
- Participant tokens are stored as SHA-256 hashes, are returned only on join/reconnect, and are never exposed in lobby responses.
- Socket.IO teacher connections verify the same JWT, user status, role, organization, and organization status as REST requests.
- Socket.IO player connections verify the participant token hash, the organization status, and reject kicked participants.
- Assistants can connect to teacher rooms to observe but cannot control the game; players cannot call teacher control events.
- The server never trusts client-supplied correctness, points, score, streak, participant id, target id, command unlock state, or deadline values.
- Command triggers, card draws, target eligibility, and all score/streak effects are decided and persisted server-side.
- Command targets are revalidated at execution time; self-targeting, disconnected, kicked, stale, and (for Thief) zero-score targets are rejected.
- Command execution is idempotent via `SessionCommand.commandId`, `SessionPlayer.appliedCommandIds`, and the unique `SessionEvent.dedupeKey`.
- Only the owner of the active `AWAITING_TARGET` command can select its target; other players receive `NOT_COMMAND_OWNER`.
- `Answer` has a unique `(sessionPlayer, question)` index, and player score updates are guarded by `answeredQuestions` to prevent duplicate awards.
- Attendance is derived from stored `Answer`/`SessionPlayer` data; clients cannot submit attendance status, scores, or attendance counts.
- `Attendance` has unique partial indexes on `(session, student)` and `(session, participant)`, and finalization uses idempotent upserts.
- Attendance, report, and history reads are scoped by `req.user.organization`; cross-organization IDs return `404` and `ADMIN` is blocked by `requireOrganization`.
- Reports are read-only and only available for `FINISHED` sessions; live/paused sessions cannot expose completed-report data.
- Correct answers are hidden from question payloads until the reveal phase.
- Answer acknowledgements do not reveal correctness or points before the reveal.
- Game codes use a safe 6-character alphabet and are globally unique.
- Public session lookup omits organization, creator, session, and quiz identifiers.
- Sessions cannot be created from archived or empty quizzes.
- Closed, paused, and finished sessions reject new participants; kicked participants cannot reconnect.
- Request bodies reject unknown fields, preventing fields such as `role`, `owner`, `organization`, or `createdBy` from being changed unexpectedly.
- JSON bodies are capped at 1 MB; oversized payloads return `413` instead of a generic `500`.
- Login attempts are rate limited per IP + email (default 20 per 15 minutes), which slows credential stuffing without locking out unrelated accounts behind the same NAT.
- Public join lookups and joins are rate limited per IP (default 120 per minute), which slows game-code enumeration and join spam.
- Excel export uses the same organization-scoped report service and the same role middleware as the JSON report; `ADMIN` is blocked and cross-organization ids return `404`.
- Workbook cells are generated in memory, never written to a permanent path, and user-provided text that could be interpreted as a spreadsheet formula is neutralized with a leading `'`.
- `.env` is git-ignored.

---

## Implementation Assumptions (Phases 1–10)

1. Organization `PATCH` is owner-only, while all organization members can read organization details and the member list.
2. Member creation creates an active account immediately with a temporary password supplied by the owner. There is no email invitation flow yet.
3. Removing a member deletes the account. Quizzes they created remain in the organization with their historical `createdBy` id; there is no ownership-transfer flow yet.
4. SUPER ADMIN (`ADMIN` role) accounts are provisioned with `npm run create-admin`, not self-registration. The CLI is the only bootstrap path.
5. Logout is client-side only because JWTs are stateless.
6. Suspending a user takes effect immediately for both new logins and existing tokens.
7. Any `OWNER` or `TEACHER` in an organization can read and manage all quizzes in that organization. This matches the future "sharing inside the organization" library model.
8. Assistants can read quizzes and questions but cannot modify them.
9. Archive is a soft status; delete is permanent and removes the quiz's questions.
10. Every question has exactly one correct option for Phase 2 scoring.
11. `order` defaults to appending a question to the end; explicit ordering is allowed.
12. `estimatedDurationSec` is the sum of question time limits, not a separately stored value.
13. Platform admins do not access organization quiz data; admin monitoring is limited to users and organizations in this phase.
14. Sections are organization-wide; any `OWNER` or `TEACHER` in the organization can manage them.
15. Section names are unique inside an organization (case-sensitive exact match).
16. Deleting a section that still contains students is blocked with `409`; move or delete the students first.
17. Students are roster records, not platform users. There is no `PLAYER` account role and students cannot log in.
18. Avatar customization uses a fixed preset/color whitelist. There is no image upload or cosmetic economy yet.
19. Student import accepts JSON rows. Excel/CSV file parsing is left to the client or a later phase.
20. Student nicknames are not unique at the roster level; per-session nickname uniqueness is enforced when joining.
21. Sessions belong to one organization and one quiz. Any `OWNER` or `TEACHER` in the organization can manage them.
22. A session can be created only from an active quiz that has at least one question.
23. Session lifecycle is `LOBBY -> LIVE -> PAUSED -> LIVE -> FINISHED`. Finishing from the lobby is allowed.
24. Starting a session closes joining automatically. A teacher can reopen joining while the session is `LIVE`.
25. New participants can join only when `joinOpen` is true and the session is `LOBBY` or `LIVE`. Joining is blocked while `PAUSED` or `FINISHED`.
26. Kicked participants remain stored as `KICKED` records. They cannot reconnect, and their nickname stays reserved for that session.
27. Participant tokens are opaque per-session credentials, not JWTs. Phase 5 Socket.IO authentication uses the participant token; there is still no token refresh flow.
28. Per-session game settings live in `commandSettings` and `phaseSettings`; randomization is still not configurable.
29. Deleting a quiz does not delete or block its sessions; session/quiz lifecycle cleanup can be added in a later phase.
30. Session list and lobby endpoints are not paginated, consistent with the existing quiz/section/student endpoints.
31. Phase 5 has no exact scoring formula in the specification. It uses the documented 50%–100% speed-based formula; incorrect answers score 0.
32. Streaks are recorded but do not add bonus points; they only unlock commands.
33. Tied scores share a competition rank; `position` remains a deterministic row number.
34. A question ends early when every active player has answered, or at `phaseEndsAt`, whichever comes first.
35. Game question text, points, time limits, and options are snapshotted at start; later quiz edits do not affect a live game.
36. `Question` has no explanation field yet, so explanation events carry `null`.
37. Late joiners are allowed while `joinOpen` is true and the session is `LIVE`; they score 0 for the in-progress question.
38. Phase timers are in-process `setTimeout` timers backed by persisted deadlines. Horizontal scaling would need a shared scheduler/adapter.
39. Recovery uses wall-clock time; phases that expired during downtime advance immediately after restart.
40. Kicked participants remain in the database for audit but are excluded from active counts and leaderboards.
41. Gift, Thief, and Rocket are disabled per session by default; a teacher must enable them explicitly.
42. Gift always draws exactly 3 unique cards using independent per-card rarity weights; the draw is not seeded.
43. Thief triggers only on a streak of 1 (with a 35% roll) and never on the last question; Rocket triggers on every positive multiple of 5, including the last question.
44. Command queues, target-selection timers, and phase timers are in-process. Persisted state enables restart recovery, but horizontal scaling would need a shared scheduler/adapter.
45. Command effects are recorded on `SessionPlayer.appliedCommandIds` and `SessionEvent.dedupeKey`; retries never re-apply a command.
46. Phase visibility flags only suppress broadcasts; they do not skip server-side scoring or state transitions.
47. Public registration is removed. The only way to create an `OWNER` is `POST /api/admin/organizations` as a SUPER ADMIN.
48. Organization creation requires the initial owner's name, email, and temporary password. There is no email invitation flow; the SUPER ADMIN delivers the temporary password out of band.
49. Organizations default to `ACTIVE`. Suspension blocks organization users and student joins but does not delete data; reactivation restores access.
50. Organization + owner creation uses a MongoDB transaction when the deployment supports it (replica set/sharded cluster) and a manual rollback path on standalone MongoDB. The rollback covers operation failures; a process crash between the two writes on standalone MongoDB could still leave a partial record, so a replica set is recommended for production.
51. Organization deletion is not implemented; suspension is the reversible administrative control.
52. This repository is backend-only. The SUPER ADMIN dashboard is a separate client that consumes the documented admin endpoints.
53. Organization suspension is enforced when a Socket.IO connection authenticates. Sockets that are already connected remain until they disconnect or reconnect; immediate eviction would require a shared presence/disconnect hook.
54. Attendance is based on participation, not section membership: `answeredCount / totalQuestions >= attendanceThreshold` (default `0.5`). Kicked participants are always `KICKED`.
55. Absentees are derived from the organization roster at finalization time. Students added to the roster after a session ends are not retroactively absent for that session unless finalization is forced.
56. `Attendance` is a materialized snapshot, not a live view. Live sessions compute `PENDING` records on read and never persist them.
57. Attendance finalization is idempotent and also runs lazily on the first attendance/report read of a finished session, covering a crash during finish.
58. Guest participants (no roster `Student`) are tracked with `student: null` and excluded from the roster attendance denominator.
59. A participant whose roster `Student` was deleted keeps the historical student id with `rosterMissing: true`; it is not reclassified as a guest.
60. Historical section snapshots are stored on `Attendance`; later student section moves do not rewrite past attendance.
61. Reports require `FINISHED`; `409` is returned for live, paused, or lobby sessions.
62. Report `actualAttendees` counts `PRESENT` only; `joinedParticipants` counts everyone who joined (including guests), and `kicked` is reported separately from `absentees`.
63. Student history date filters (`from`/`to`) match the session end time, and the summary aggregates all matching records rather than the current page.
64. Report sharing, email delivery, and manual attendance overrides are left to later phases.
65. Excel export reads the same `getSessionReport()` result as the JSON endpoint; it never recalculates attendance, scores, ranks, or question statistics independently.
66. The exported workbook is generated in memory and streamed to the client. No report files are retained on the server.
67. Export text is sanitized against spreadsheet formula injection, but the workbook still contains the underlying user-provided names, nicknames, and question text.
68. Rate limiting is an in-process fixed-window map. It is sufficient for a single-instance MVP; a multi-instance deployment needs a shared store and a proxy-aware `req.ip` configuration.
69. `CORS_ORIGIN` defaults to `*` for local development. Production deployments should list explicit frontend origins.
70. Report exports and JSON reports are read-only snapshots; they do not support editing, annotations, or manual attendance overrides.
71. Question `points` is a positive integer from `1` to `10000`, defaulting to `1000`. It is the base value for both the speed-based game score and the academic raw score.
72. Raw score is the sum of the session question-snapshot points for correct answers only. It is independent of response speed, Double Points, Gift, Points Bonus, Leaderboard Strike, Thief, Rocket, and Streak Shield.
73. The report's academic `bestStreak` walks the answers in question order. Unanswered and incorrect answers both break the run; gameplay Streak Shield only protects the separate gameplay `bestStreak`.
74. `studentResults[].accuracy` is a percentage rounded to two decimals and is `0` when no question was answered. `averageResponseTime` is in seconds rounded to two decimals, uses answered questions only, and is `0` when no question was answered. Unanswered questions are never counted as incorrect.

---

## Known Limitations and Production Readiness

The repository is ready for a university MVP demonstration: every documented REST and Socket.IO path is implemented, the full journey is covered by an automated end-to-end test, and the Excel export is verified against the JSON report.

It is not a production-hardened deployment. Known limitations:

- Rate limiting and phase/command timers are process-local. Horizontal scaling needs a shared store and a Socket.IO adapter.
- `CORS_ORIGIN=*` is the default; production must restrict it.
- JWTs are stateless, so logout is client-side only and there is no token revocation list.
- There is no email invitation, password reset, or email verification flow.
- Attendance finalization uses the current organization roster; historical enrollment is not snapshotted.
- There is no manual attendance override, report sharing, or scheduled report delivery.
- MongoDB transactions are used when available; standalone MongoDB uses a best-effort rollback path.
- `npm audit` reports two moderate `uuid` advisories transitively through ExcelJS. They concern `uuid` v3/v5/v6 usage with `buf`; ExcelJS uses `uuid.v4()` only, so the advisories are accepted and documented for the MVP.
- No load, penetration, or browser-based UI testing is included; this repository is backend-only.

---

## Out of Scope (Post-MVP)

- Quiz folders/tags, AI generation, billing/payments
- Excel/CSV file parsing for student import (the API accepts JSON rows)
- Email invitations, report email delivery, scheduled reports
- Shared/distributed rate limiting and horizontal Socket.IO scaling
- Enterprise infrastructure (Redis, Kafka, RabbitMQ, Kubernetes, microservices)

---

## Troubleshooting

| Problem | Fix |
| ------- | --- |
| `Could not connect to MongoDB` | Start MongoDB or fix `MONGODB_URI` |
| `Invalid environment variables` | Check `.env` against `.env.example`; `JWT_SECRET` must be at least 32 characters |
| `Port already in use` | Change `PORT` in `.env`, or stop the process using it |
| `401` on every protected request | Send `Authorization: Bearer <token>` with a non-expired token |
| `403 Your account has been suspended` | Ask an admin to reactivate the account |
