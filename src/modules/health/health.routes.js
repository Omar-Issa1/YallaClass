const express = require('express');

const { getDatabaseStatus } = require('../../config/database');

const router = express.Router();

router.get('/health', (req, res) => {
  res.json({
    success: true,
    message: 'Yalla Class API is running',
    database: getDatabaseStatus(),
  });
});

module.exports = router;
