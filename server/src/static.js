const fs = require('fs');
const path = require('path');
const express = require('express');

function serveClient(app, dist) {
  const index = path.join(dist, 'index.html');
  if (!fs.existsSync(index)) return false;
  app.use(express.static(dist, { index: false, dotfiles: 'ignore', maxAge: '1h' }));
  app.get(/^(?!\/api(\/|$)).*/, (req, res, next) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') return next();
    res.set('Cache-Control', 'no-cache');
    res.sendFile(index);
  });
  return true;
}
module.exports = { serveClient };
