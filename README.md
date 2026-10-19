# Yalla Class API

Backend API for **Yalla Class** — a live classroom quiz platform.

> **Phase 1 (current): Project Foundation + Database.**
> This phase contains only the project structure, configuration, MongoDB connection, Mongoose models, a health endpoint, and error handling. Authentication, quizzes, live game logic, and Socket.IO come in later phases.

## Tech Stack

| Layer          | Choice                          |
| -------------- | -------------------------------- |
| Runtime        | Node.js (>= 20)                  |
| Web framework  | Express.js 5                     |
| Database       | MongoDB + Mongoose 9             |
| Validation     | Zod (env vars; request validation is added in later phases) |
| Language       | JavaScript (CommonJS)            |

### Why CommonJS?

The whole project uses `require` / `module.exports` (`"type": "commonjs"` in `package.json`) because:

- No build step is needed — plain Node.js runs the code directly.
- Most Express, Mongoose, and Jest documentation/examples use CommonJS.
- It avoids common ESM pitfalls (mandatory file extensions, `__dirname` workarounds).

The codebase stays consistent: CommonJS everywhere, never mixed with `import`.

## Requirements

- **Node.js 20+** (tested on Node 24)
- **MongoDB Server** running locally on port `27017` (tested on Windows)

## Project Structure

```
yalla-class-api/
├── src/
│   ├── config/
│   │   ├── env.js                 # Loads .env and validates it with Zod
│   │   └── database.js            # MongoDB connection helpers (connect/disconnect/status)
│   ├── middlewares/
│   │   ├── not-found.middleware.js    # JSON 404 handler
│   │   └── error-handler.middleware.js # Central error handler
│   ├── models/                    # Mongoose schemas & models
│   │   ├── user.model.js
│   │   ├── classroom.model.js
│   │   ├── quiz.model.js
│   │   ├── option.model.js        # Embedded subdocument schema (used inside Question)
│   │   ├── question.model.js
│   │   ├── session.model.js
│   │   ├── session-player.model.js
│   │   └── answer.model.js
│   ├── modules/                   # Feature modules (routes/controllers/services)
│   │   └── health/
│   │       └── health.routes.js   # GET /health
│   ├── utils/
│   │   └── app-error.js           # AppError class (statusCode + message)
│   ├── app.js                     # Express app (middlewares + routes), no listen()
│   └── server.js                  # Entry point: connect DB, then listen
├── .env                           # Real environment values (git-ignored)
├── .env.example                   # Template for .env
├── .gitignore
└── package.json
```

## Setup

### 1. Install dependencies

```bash
npm install
```

### 2. Make sure MongoDB is running

On Windows, MongoDB is typically installed as a service named `MongoDB`:

```powershell
# Check the service status
Get-Service MongoDB

# Start it if it is stopped (run PowerShell as Administrator)
Start-Service MongoDB
```

Verify that MongoDB responds:

```bash
mongosh --eval "db.runCommand({ ping: 1 })"
```

You should see `{ ok: 1 }`. If MongoDB is not installed, install **MongoDB Community Server** from https://www.mongodb.com/try/download/community.

### 3. Configure environment variables

Copy the example file and adjust values if needed:

```powershell
Copy-Item .env.example .env
```

| Variable      | Default                                    | Description                        |
| ------------- | ------------------------------------------ | ---------------------------------- |
| `NODE_ENV`    | `development`                              | `development` / `test` / `production` |
| `PORT`        | `4000`                                     | HTTP port of the API               |
| `MONGODB_URI` | `mongodb://localhost:27017/yalla_class`    | MongoDB connection string          |

The database `yalla_class` is created automatically on first write — no manual migration step is needed.

### 4. Start the server

```bash
npm run dev    # development, auto-restarts on file changes (node --watch)
# or
npm start      # plain start
```

Expected console output:

```
MongoDB connected: localhost/yalla_class
Yalla Class API is running on http://localhost:4000
```

### 5. Verify

Open http://localhost:4000/health in a browser, or run:

```bash
curl http://localhost:4000/health
```

Expected response:

```json
{
  "success": true,
  "message": "Yalla Class API is running",
  "database": "connected"
}
```

`"database": "connected"` confirms that the API is connected to MongoDB. Any unknown route returns a JSON `404`, and thrown errors return JSON with the proper status code.

## NPM Scripts

| Script  | Command                  | Purpose                        |
| ------- | ------------------------ | ------------------------------ |
| `dev`   | `node --watch src/server.js` | Run in development with auto-restart |
| `start` | `node src/server.js`         | Run the server normally        |

## Database Models

Mongoose creates each collection automatically, and indexes are built when the app uses the models (`autoIndex` is on in development).

| Model         | Collection       | Key fields / relationships                                            |
| ------------- | ---------------- | --------------------------------------------------------------------- |
| `User`        | `users`          | `name`, `email` (unique), `passwordHash`                              |
| `Classroom`   | `classrooms`     | `name`, `teacher` → User; unique `(teacher, name)`                    |
| `Quiz`        | `quizzes`        | `title`, `description`, `teacher` → User                              |
| `Question`    | `questions`      | `quiz` → Quiz, `text`, `points`, `timeLimitSec`, embedded `options`   |
| `Option`      | *(embedded)*     | `text`, `isCorrect` — stored inside `Question.options` (2–4 items)    |
| `Session`     | `sessions`       | `quiz` → Quiz, `joinCode` (unique), `status` (`created`/`live`/`finished`), `startedAt`, `endedAt` |
| `SessionPlayer` | `sessionplayers` | `session` → Session, `nickname`, `score`; unique `(session, nickname)` |
| `Answer`      | `answers`        | `sessionPlayer` → SessionPlayer, `question` → Question, `selectedOptionId`, `isCorrect`; unique `(sessionPlayer, question)` |

**Why are options embedded?** A question's options are always read and written together with the question, are small and bounded (2–4), and are never queried on their own — the textbook case for embedding in MongoDB instead of a separate collection. `Answer.selectedOptionId` simply references the embedded option's `_id`.

All schemas use `{ timestamps: true }`, so every document has `createdAt` and `updatedAt`.

## Troubleshooting

| Problem | Fix |
| ------- | --- |
| `Could not connect to MongoDB` on startup | MongoDB service is not running (`Start-Service MongoDB`) or `MONGODB_URI` in `.env` is wrong |
| Port `4000` already in use | Change `PORT` in `.env` |
| `Invalid environment variables` on startup | A required variable is missing in `.env` — compare with `.env.example` |

## Out of Scope (Later Phases)

Authentication (JWT + bcrypt), quiz/classroom CRUD, question management, AI question generation, live sessions with Socket.IO, scoring, and leaderboards are **not** part of Phase 1.
