const { app } = require('electron');
app.on('browser-window-created', (_, window) => window.hide());
require('../out/main/main.js');
