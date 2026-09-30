const express = require('express');
const { requireRole } = require('../auth');
const { buildRecommendations } = require('../recommendations');
module.exports = function recommendationRoutes(db) {
  const r = express.Router();
  r.get('/', requireRole('student'), (req, res) => res.json(buildRecommendations(db, req.user.id)));
  return r;
};
