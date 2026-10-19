const express = require('express');

const healthRoutes = require('./modules/health/health.routes');
const notFound = require('./middlewares/not-found.middleware');
const errorHandler = require('./middlewares/error-handler.middleware');

const app = express();

app.disable('x-powered-by');
app.use(express.json());

app.use('/', healthRoutes);

app.use(notFound);
app.use(errorHandler);

module.exports = app;
