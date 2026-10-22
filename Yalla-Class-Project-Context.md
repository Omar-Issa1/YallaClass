# Yalla Class --- Project Context & Backend Specification

> **Purpose of this file:** This is the permanent project
> context/reference for AI coding assistants working on the Yalla Class
> repository.\
> Read this file before making backend changes. Do not invent
> requirements that are not defined here.

------------------------------------------------------------------------

## 1. Project Overview

**Yalla Class** is a live classroom quiz/game platform inspired by the
live-quiz model of Kahoot, designed for Arabic/Egyptian classrooms.

The core experience is:

``` text
Teacher creates Quiz
        ↓
Teacher creates Live Session
        ↓
Students join using Game Code / QR
        ↓
Students enter their name/nickname/section/avatar
        ↓
Teacher starts the game
        ↓
Questions run in real time
        ↓
Students answer
        ↓
Server calculates score / response time / streak
        ↓
Live leaderboard
        ↓
Teacher can use live controls and Commands
        ↓
Session finishes
        ↓
Attendance + Reports
        ↓
Excel Export
```

The project is intended to feel like a game rather than a normal
administrative dashboard.

The teacher controls the session, students participate from their
phones, and a large screen/projector can show the shared game state.

------------------------------------------------------------------------

# 2. Important Scope

This is a **university project**.

We want a **working, understandable, maintainable implementation**, not
an enterprise-scale platform.

Do NOT over-engineer the project.

Avoid introducing unnecessary:

-   Microservices
-   Kubernetes
-   Kafka
-   RabbitMQ
-   Complex distributed systems
-   Enterprise billing infrastructure
-   Excessive abstraction
-   Production-scale infrastructure unless specifically required later

The current backend stack is:

-   Node.js
-   JavaScript
-   Express.js
-   MongoDB
-   Mongoose
-   JWT
-   bcrypt/bcryptjs
-   Socket.IO for real-time gameplay (later phase)

**Use JavaScript, not TypeScript.**

------------------------------------------------------------------------

# 3. Users and Roles

The platform has these concepts:

## OWNER

The owner belongs to an Organization.

The owner can manage the organization and its members.

## TEACHER

The main user of Yalla Class.

Eventually the teacher can:

-   Create quizzes
-   Edit questions
-   Manage sections/classes
-   Start live sessions
-   Control the live game
-   Use Commands
-   View reports
-   Export results

## ASSISTANT

An organization member who can eventually assist the teacher during live
sessions.

The role must exist in authorization even if some assistant-specific
functionality is implemented later.

## PLAYER

A student participating in a live session.

**Important:** Player is NOT a normal platform account.

A player eventually joins a live session using a Game Code / QR and
enters:

-   Full name
-   Nickname
-   Section
-   Avatar

Player/session functionality is implemented in later phases.

## ADMIN

A platform-level administrator.

Admin is NOT the same as Organization Owner.

Admin can eventually:

-   View users
-   View organizations
-   Monitor usage
-   Suspend/activate users

Admin functionality is separate from organization membership.

------------------------------------------------------------------------

# 4. Multi-Tenancy / Organizations

Yalla Class is organization-based.

Conceptually:

``` text
Organization A
├── Owner
├── Teachers
├── Assistants
├── Quizzes
├── Sections
└── Sessions

Organization B
├── Owner
├── Teachers
├── Assistants
├── Quizzes
├── Sections
└── Sessions
```

A user from Organization A must never access Organization B's
organization data.

The authenticated user's organization should be the source of truth.

Do not trust arbitrary `organizationId` values sent by clients when the
organization can be derived from the authenticated user.

------------------------------------------------------------------------

# 5. Main Product Areas

The full product contains:

1.  Authentication
2.  Organization management
3.  Organization members
4.  Admin
5.  Quiz Library
6.  Quiz creation/editor
7.  Questions
8.  Sections/classes
9.  Students
10. Live Sessions
11. Lobby
12. Real-time Game Engine
13. Scoring
14. Leaderboard
15. Teacher live controls
16. Commands
17. Attendance
18. Reports
19. Excel Export
20. Avatar customization

------------------------------------------------------------------------

# 6. Main Teacher Pages

The teacher dashboard eventually contains these major areas:

## Library

Features:

-   Folders
-   Tags
-   Search
-   Duplicate
-   Archive
-   Sharing inside the organization
-   Quiz information such as question count and estimated duration

## Create Quiz

Two possible flows eventually meet in the same editor:

``` text
Manual Editor ──────┐
                    ├──> Quiz Editor
AI Import ──────────┘
```

AI Import is NOT part of the current MVP backend phases.

## Classes & Students

Teacher can:

-   Create sections/classes
-   Manage students
-   Import student lists from Excel/CSV

## Sessions

Teacher can:

-   Select a Quiz
-   Configure a Session
-   Open the Lobby
-   Start the game
-   Control the live game

## Reports

Teacher can eventually see:

-   Session summary
-   Question analysis
-   Student analysis
-   Attendance
-   Command log
-   Excel export

## Settings

Eventually contains:

-   Profile
-   Organization
-   Members
-   Billing
-   Preferences

Billing is NOT part of the university MVP.

------------------------------------------------------------------------

# 7. Live Gameplay

The live game is the most important non-CRUD part of the backend.

The server is the **source of truth** for the game state.

Clients should not decide:

-   Correctness
-   Score
-   Ranking
-   Official game state
-   Command validity

The server decides these.

Conceptual game state:

``` text
LOBBY
  ↓
COUNTDOWN
  ↓
QUESTION
  ↓
REVEAL
  ↓
EXPLANATION
  ↓
LEADERBOARD
  ↓
NEXT QUESTION
  ↓
...
  ↓
FINISHED
```

The session can also be:

``` text
PAUSED
```

Real-time communication will eventually use Socket.IO.

------------------------------------------------------------------------

# 8. Student Gameplay

The eventual player flow is:

``` text
Game Code / QR
      ↓
Full Name
      ↓
Nickname
      ↓
Section
      ↓
Avatar
      ↓
Join Session
      ↓
Question
      ↓
Answer
      ↓
Result
      ↓
Leaderboard
```

Students do not need a normal platform account.

The server records their participation in the Session.

------------------------------------------------------------------------

# 9. Scoring

When a player answers, the server eventually records information such
as:

``` text
player
session
question
selected answer
correct/incorrect
response time
points
streak
```

The server calculates:

-   Correctness
-   Response time
-   Points
-   Streak
-   Total score
-   Rank

The frontend must not be trusted to calculate official scores.

------------------------------------------------------------------------

# 10. Leaderboard

The live leaderboard eventually shows player ranking.

It should be updated in a controlled way rather than blindly
broadcasting every internal change to every client.

The project specification describes batched leaderboard updates to avoid
unnecessary real-time traffic.

------------------------------------------------------------------------

# 11. Commands

Commands are part of the MVP.

The main Commands are:

-   Gift
-   Thief
-   Rocket

Each Session can enable/disable Commands.

Conceptually:

``` text
Player uses Command
        ↓
Server validates eligibility
        ↓
Server validates target/effect
        ↓
Apply effect
        ↓
Create SessionEvent
        ↓
Broadcast event
        ↓
Update relevant state
```

Every Command usage should eventually be recorded in `SessionEvent`.

A SessionEvent should be able to represent information such as:

``` text
type
actorId
targetId
value
questionId
timestamp
metadata
```

The exact game rules for each Command must follow the project
specification when implemented.

------------------------------------------------------------------------

# 12. Attendance

Attendance is part of the MVP.

The project specification defines attendance based on
participation/answers.

Default rule:

``` text
answered questions >= 50%
        ↓
PRESENT
```

The threshold can eventually be configurable per Session.

Attendance data can include:

-   Join time
-   Leave time
-   Duration
-   Number of answered questions
-   Attendance status

------------------------------------------------------------------------

# 13. Reports

After a Session finishes, reports should use real stored data.

## Session Summary

Expected information includes:

-   Participants
-   Average score
-   Correct percentage
-   Game duration
-   Top players
-   Hardest question

## Question Analysis

Expected information includes:

-   Correct percentage
-   Answer distribution
-   Skipped answers
-   Most common wrong answer

## Student Analysis

Expected information includes:

-   Score
-   Speed/response time
-   Wrong questions
-   Follow-up indicators

## Command Log

Expected information includes:

-   Who used the Command
-   What Command was used
-   Target
-   Value/effect
-   Question/context

**Never generate fake statistics.**

------------------------------------------------------------------------

# 14. Excel Export

Excel Export is part of the MVP.

A finished Session should eventually be exportable as an `.xlsx` file.

Expected sheets:

1.  Attendance
2.  Results
3.  Answer Details
4.  Question Analysis
5.  Commands
6.  Summary

The export must contain real database data.

Arabic/RTL content should remain readable.

------------------------------------------------------------------------

# 15. Avatar Customization

Avatar customization is part of the MVP.

The player can eventually have an avatar/custom appearance.

The project also contains game-progression concepts such as:

-   Colors
-   Shards
-   Streak
-   Best streak
-   Unlockable elements

Do not build an unnecessarily complex cosmetic economy unless explicitly
required.

For the MVP, a simple avatar/color customization system is enough.

------------------------------------------------------------------------

# 16. Admin

Admin is a platform-level role.

Basic MVP Admin functionality:

``` text
View users
View organizations
View basic usage
Suspend user
Activate user
```

Admin endpoints must require:

``` text
Authentication
+
ADMIN role
```

Regular organization users must never access Admin APIs.

------------------------------------------------------------------------

# 17. MVP Scope

The following are explicitly IN the MVP:

``` text
✓ Authentication
✓ Organization
✓ Organization members
✓ Roles
✓ Admin
✓ Quiz
✓ Questions
✓ Sections
✓ Students
✓ Avatar customization
✓ Sessions
✓ Lobby
✓ Player joining
✓ Real-time game
✓ Scoring
✓ Leaderboard
✓ Teacher controls
✓ Commands
✓ Attendance
✓ Reports
✓ Excel export
```

------------------------------------------------------------------------

# 18. Not in the University MVP

The following should NOT be implemented unless explicitly requested
later:

``` text
✗ AI Quiz Generation
✗ PDF/DOCX/PPTX AI processing
✗ Subscription billing
✗ Payment gateway
✗ Production-grade 500-player scaling
✗ Complex backup infrastructure
✗ Advanced analytics
✗ Enterprise infrastructure
```

These can exist in the product vision but are outside the current
university implementation.

------------------------------------------------------------------------

# 19. Backend Development Phases

The backend should be implemented in this order.

## Phase 0 --- Project Setup & Architecture

Implement:

-   Node.js project
-   Express
-   MongoDB/Mongoose
-   Environment variables
-   Project structure
-   Error handling
-   Validation foundation
-   CORS
-   Logging
-   Health endpoint
-   Authentication middleware foundation
-   Role middleware foundation

Done when:

``` text
Server starts
MongoDB connects
GET /api/health works
Errors are handled consistently
Project structure is ready for future modules
```

------------------------------------------------------------------------

## Phase 1 --- Authentication + Organization + Admin

Implement:

### Authentication

``` text
POST /api/auth/register
POST /api/auth/login
POST /api/auth/logout
GET  /api/auth/me
```

### Organization

``` text
GET   /api/organization
PATCH /api/organization
```

### Members

``` text
GET    /api/organization/members
POST   /api/organization/members
PATCH  /api/organization/members/:id
DELETE /api/organization/members/:id
```

### Admin

``` text
GET   /api/admin/users
GET   /api/admin/users/:id
PATCH /api/admin/users/:id/status

GET   /api/admin/organizations
GET   /api/admin/organizations/:id
```

Phase 1 must establish:

-   JWT authentication
-   Password hashing
-   Role authorization
-   ACTIVE/SUSPENDED status
-   Organization isolation
-   Owner/Teacher/Assistant/Admin roles

Do NOT implement Quiz functionality in Phase 1.

------------------------------------------------------------------------

## Phase 2 --- Quiz + Questions

Implement:

-   Quiz model
-   Question model
-   Quiz CRUD
-   Question CRUD
-   Search
-   Archive
-   Duplicate

------------------------------------------------------------------------

## Phase 3 --- Sections + Students + Avatar

Implement:

-   Sections/classes
-   Students
-   Student import
-   Student management
-   Player/avatar foundations
-   Avatar customization

------------------------------------------------------------------------

## Phase 4 --- Sessions + Lobby + Join

Implement:

-   Session model
-   Game Code
-   Session settings
-   Lobby
-   Player joining
-   QR-related join flow if needed

------------------------------------------------------------------------

## Phase 5 --- Real-Time Game Engine

Implement:

-   Socket.IO
-   Game state machine
-   Question lifecycle
-   Timers
-   Answer submission
-   Server-side scoring
-   Streaks
-   Leaderboard
-   Reconnection handling
-   Teacher/Player/Big Screen synchronization

This is the most important technical phase.

------------------------------------------------------------------------

## Phase 6 --- Teacher Controls + Commands

Implement:

-   Start
-   Pause
-   Resume
-   Skip
-   Reveal
-   Next
-   Finish
-   Lock/unlock joining
-   Kick player
-   Gift
-   Thief
-   Rocket
-   SessionEvent logging

------------------------------------------------------------------------

## Phase 7 --- Attendance + Reports

Implement:

-   Attendance calculation
-   Session summary
-   Question analysis
-   Student analysis
-   Command log

------------------------------------------------------------------------

## Phase 8 --- Excel Export

Implement:

``` text
Attendance
Results
Answer Details
Question Analysis
Commands
Summary
```

as a real `.xlsx` export.

------------------------------------------------------------------------

## Phase 9 --- Integration + Testing + Polish

Test the complete flow:

``` text
Register Teacher
      ↓
Create Organization
      ↓
Create Section
      ↓
Add Students
      ↓
Create Quiz
      ↓
Create Session
      ↓
Players Join
      ↓
Start Game
      ↓
Answer Questions
      ↓
Leaderboard
      ↓
Commands
      ↓
Attendance
      ↓
Finish
      ↓
Reports
      ↓
Excel Export
```

------------------------------------------------------------------------

# 20. Current Development Rule

When an AI coding assistant opens this project:

1.  Read this file first.
2.  Understand the current phase.
3.  Inspect existing code before changing anything.
4.  Reuse correct existing code.
5.  Do not rewrite working modules unnecessarily.
6.  Do not implement future phases automatically.
7.  Do not invent requirements.
8.  Keep the architecture simple.
9.  Use JavaScript.
10. Use MongoDB/Mongoose.
11. Keep business logic on the server.
12. Never trust the frontend with official scores or permissions.
13. Never allow cross-organization data access.
14. Never expose passwords or password hashes.

------------------------------------------------------------------------

# 21. Current Target

The immediate target is:

``` text
PHASE 0
   ↓
PHASE 1
   ↓
PHASE 2
   ↓
...
```

**Do not start Phase 2 until Phase 0 and Phase 1 are tested and
working.**

The immediate goal is not to build the entire platform in one pass.

The immediate goal is to build a solid, working foundation that can
safely grow into the complete Yalla Class MVP.

------------------------------------------------------------------------

# 22. Important Architecture Principle

Keep the distinction clear between:

### Platform users

``` text
OWNER
TEACHER
ASSISTANT
ADMIN
```

and:

### Live participants

``` text
PLAYER
```

A Player is a session participant, not a normal authenticated platform
user.

This distinction is important for the database design, authentication,
authorization, and future Session/Game Engine.

------------------------------------------------------------------------

# 23. Definition of a Successful MVP

The MVP is successful when a teacher can realistically perform this
complete flow:

``` text
Create account
      ↓
Create/manage organization
      ↓
Create section
      ↓
Add students
      ↓
Create quiz
      ↓
Create live session
      ↓
Students join with code
      ↓
Run live quiz
      ↓
Students answer
      ↓
Scores update
      ↓
Leaderboard updates
      ↓
Teacher uses Commands
      ↓
Attendance is calculated
      ↓
Session ends
      ↓
Teacher sees reports
      ↓
Teacher exports Excel
```

The system should work end-to-end with real stored data.

------------------------------------------------------------------------

# 24. Final Rule

**Working functionality is more important than architectural
complexity.**

If there is a choice between:

``` text
A complicated architecture that looks impressive
```

and:

``` text
A simple architecture that is correct, testable, and easy to understand
```

choose the second one for this project.

Build only what the project needs.
