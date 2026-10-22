# Yalla Class API

Backend API for **Yalla Class**, a live classroom quiz platform for Arabic/Egyptian classrooms.

**Current status: Phase 0 + Phase 1 complete.**

Implemented:

- Project foundation (Express, MongoDB/Mongoose, environment config, centralized errors, validation, CORS, logging, health endpoint)
- JWT authentication and password hashing
- Organizations and organization members
- Roles: `OWNER`, `TEACHER`, `ASSISTANT`, `ADMIN`
- Account status: `ACTIVE`, `SUSPENDED`
- Admin user/organization management

Not implemented yet: quizzes, questions, sections, students, live sessions, players, Socket.IO game engine, commands, attendance, reports, Excel export, AI generation, billing.

---

## Tech Stack

| Layer          | Choice                                      |
| -------------- | ------------------------------------------- |
| Runtime        | Node.js 20+ (tested on Node 24)            |
| Language       | JavaScript (CommonJS)                      |
| Web framework  | Express 5                                  |
| Database       | MongoDB + Mongoose                         |
| Auth           | JWT (`jsonwebtoken`) + `bcryptjs`          |
| Validation     | Zod                                        |
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
    validate.middleware.js       # Zod body validation + ObjectId param check
    error-handler.middleware.js  # Central error handler
    not-found.middleware.js      # JSON 404 handler
    request-logger.middleware.js # Development request logging
  models/
    user.model.js                # Phase 1 user model
    organization.model.js        # Phase 1 organization model
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
    serializers.js               # Safe user/organization output
    token.js                     # JWT sign/verify helpers
  app.js                         # Express app (no listen)
  server.js                      # Entry point: connect DB, listen, shutdown
scripts/
  create-admin.js                # Creates a platform ADMIN account
  smoke-test.js                  # End-to-end API verification
```

The feature-module layout (`routes -> controller -> service -> model`) is ready for future Quiz, Session, Reports, and Socket.IO modules.

Repository note: earlier draft files for future-phase models (`classroom`, `quiz`, `question`, `option`, `answer`, `session`, `session-player`) are still present in `src/models/`. They are **not loaded or used** by the Phase 0/1 API and are intentionally left for Phase 2/3 work.

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
| `CORS_ORIGIN`    | No       | `*`                                      | `*` or comma-separated allowed origins |

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
| `npm run create-admin`| Create a platform-level ADMIN account |
| `npm run test:smoke`  | Run the end-to-end API smoke test |

---

## Roles and Account Model

Platform accounts use these roles:

| Role        | Scope               | Phase 1 capabilities |
| ----------- | ------------------- | -------------------- |
| `OWNER`     | Organization        | Read/rename organization, manage members, list members |
| `TEACHER`   | Organization        | Read organization and members |
| `ASSISTANT` | Organization        | Read organization and members |
| `ADMIN`     | Platform            | View users, view organizations, suspend/reactivate users |

`PLAYER` is **not** a platform account. Players will join live sessions later with a game code, name, nickname, section, and avatar. Do not create PLAYER users through these endpoints.

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
| `403` | Wrong role, suspended account, owner-protected action |
| `404` | Resource not found (also used for cross-organization access) |
| `409` | Duplicate email |
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

### `POST /api/auth/register`

Creates a new organization and an `OWNER` account.

- Authentication: No
- Role: Public
- Creates: `User` (role `OWNER`) + `Organization`

Request body:

```json
{
  "name": "Omar Ahmed",
  "email": "omar@example.com",
  "password": "password123",
  "organizationName": "My Classroom"
}
```

Validation:

- `name`: 2-80 characters
- `email`: valid and unique
- `password`: 8-72 characters
- `organizationName`: 2-100 characters

Response `201`:

```json
{
  "success": true,
  "message": "Registration successful",
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
    },
    "organization": {
      "id": "<organizationId>",
      "name": "My Classroom",
      "owner": "<userId>",
      "createdAt": "2026-01-01T00:00:00.000Z",
      "updatedAt": "2026-01-01T00:00:00.000Z"
    }
  }
}
```

Errors: `400` validation, `409` duplicate email.

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

## Admin

All `/api/admin/*` endpoints require:

```text
Authentication + ADMIN role
```

Regular organization users receive `403`.

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
        "owner": {
          "id": "<ownerId>",
          "name": "Omar Ahmed",
          "email": "omar@example.com"
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
      "owner": {
        "id": "<ownerId>",
        "name": "Omar Ahmed",
        "email": "omar@example.com"
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
createdAt     Date
updatedAt     Date
```

Future phases will add quizzes, sections, and sessions to the organization scope.

---

## Admin Account Bootstrap

Registration always creates an `OWNER`. Platform admins are created with a CLI script, not a public endpoint.

```bash
npm run create-admin -- --name "Platform Admin" --email admin@example.com --password "strong-password"
```

The script:

- requires a valid email and an 8-72 character password
- hashes the password with bcrypt
- creates a user with role `ADMIN` and no organization
- refuses to overwrite an existing email

Run it from the project root after configuring `.env`.

---

## Testing

### Automated smoke test

```bash
npm run test:smoke
```

This script:

- starts the API on port `4100`
- uses the isolated database `yalla_class_smoke` (override with `SMOKE_MONGODB_URI`)
- creates a temporary admin account
- runs 101 checks covering registration, login, JWT validation, suspended users, role authorization, organization isolation, member management, admin endpoints, duplicate emails, invalid bodies, invalid IDs, and password leakage
- stops the server and drops the test database

MongoDB must be running.

### Manual test flow

```powershell
$base = "http://localhost:4000/api"

$register = Invoke-RestMethod -Method Post -Uri "$base/auth/register" `
  -ContentType "application/json" `
  -Body (@{
    name = "Omar Ahmed"
    email = "omar@example.com"
    password = "password123"
    organizationName = "My Classroom"
  } | ConvertTo-Json)

$token = $register.data.token
$headers = @{ Authorization = "Bearer $token" }

Invoke-RestMethod -Uri "$base/auth/me" -Headers $headers
Invoke-RestMethod -Uri "$base/organization" -Headers $headers
Invoke-RestMethod -Uri "$base/organization/members" -Headers $headers
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

Failed cases to verify manually:

- wrong password -> `401`
- missing/invalid JWT -> `401`
- suspended user -> `403`
- teacher/owner accessing `/api/admin/*` -> `403`
- user from organization A accessing organization B's member ID -> `404`
- duplicate email -> `409`
- invalid body -> `400`

---

## Security Notes

- Passwords are hashed with bcrypt (cost 10) and never stored or returned in plain text.
- `passwordHash` is excluded from queries by default and stripped from JSON output.
- JWTs contain only the user id (`sub`). The user is reloaded from MongoDB on every request, so role changes and suspensions take effect immediately.
- Role checks use reusable middleware, not per-controller duplication.
- Organization data is always derived from `req.user.organization`; client-supplied organization IDs are not trusted.
- Cross-organization member updates/deletes return `404` to avoid leaking resource existence.
- Owners cannot create `ADMIN` accounts, promote members to `ADMIN`, or modify/delete the organization owner.
- Admin accounts cannot use organization endpoints.
- Admin cannot change their own account status.
- Request bodies reject unknown fields, preventing fields such as `role` or `owner` from being changed unexpectedly.
- `.env` is git-ignored.

---

## Phase 1 Assumptions

1. Organization `PATCH` is owner-only, while all organization members can read organization details and the member list.
2. Member creation creates an active account immediately with a temporary password supplied by the owner. There is no email invitation flow yet.
3. Removing a member deletes the account because Phase 1 has no cross-organization membership or owned data.
4. Platform admins are provisioned with `npm run create-admin`, not self-registration.
5. Logout is client-side only because JWTs are stateless.
6. Suspending a user takes effect immediately for both new logins and existing tokens.

---

## Out of Scope (Later Phases)

- Phase 2: Quiz and Question models/CRUD
- Phase 3: Sections, students, imports, avatar customization
- Phase 4: Sessions, game codes, lobby, player joining
- Phase 5: Socket.IO game engine, scoring, leaderboard
- Phase 6: Teacher controls and commands (`Gift`, `Thief`, `Rocket`)
- Phase 7: Attendance and reports
- Phase 8: Excel export
- Phase 9: Full integration testing and polish
- Not in the university MVP: AI generation, billing/payments, enterprise infrastructure

---

## Troubleshooting

| Problem | Fix |
| ------- | --- |
| `Could not connect to MongoDB` | Start MongoDB or fix `MONGODB_URI` |
| `Invalid environment variables` | Check `.env` against `.env.example`; `JWT_SECRET` must be at least 32 characters |
| `Port already in use` | Change `PORT` in `.env`, or stop the process using it |
| `401` on every protected request | Send `Authorization: Bearer <token>` with a non-expired token |
| `403 Your account has been suspended` | Ask an admin to reactivate the account |
