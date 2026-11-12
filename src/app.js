const express = require("express");
const cors = require("cors");

const env = require("./config/env");
const healthRoutes = require("./modules/health/health.routes");
const authRoutes = require("./modules/auth/auth.routes");
const organizationRoutes = require("./modules/organization/organization.routes");
const quizRoutes = require("./modules/quiz/quiz.routes");
const sectionRoutes = require("./modules/section/section.routes");
const studentRoutes = require("./modules/student/student.routes");
const avatarRoutes = require("./modules/avatar/avatar.routes");
const sessionRoutes = require("./modules/session/session.routes");
const joinRoutes = require("./modules/join/join.routes");
const adminRoutes = require("./modules/admin/admin.routes");
const requestLogger = require("./middlewares/request-logger.middleware");
const notFound = require("./middlewares/not-found.middleware");
const errorHandler = require("./middlewares/error-handler.middleware");

const app = express();

const corsOrigin =
  env.CORS_ORIGIN === "*"
    ? "*"
    : env.CORS_ORIGIN.split(",").map((origin) => origin.trim());

app.disable("x-powered-by");
app.use(cors({ origin: corsOrigin }));
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true }));

if (env.NODE_ENV === "development") {
  app.use(requestLogger);
}

app.use("/api", healthRoutes);
app.use("/api/auth", authRoutes);
app.use("/api/organization", organizationRoutes);
app.use("/api/quizzes", quizRoutes);
app.use("/api/sections", sectionRoutes);
app.use("/api/students", studentRoutes);
app.use("/api/avatars", avatarRoutes);
app.use("/api/sessions", sessionRoutes);
app.use("/api/join", joinRoutes);
app.use("/api/admin", adminRoutes);

app.use(notFound);
app.use(errorHandler);

module.exports = app;
