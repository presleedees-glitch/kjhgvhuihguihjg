const express = require('express');
const http = require('http');
const WebSocket = require('ws');
// Kahoot client temporarily disabled to allow server to start
// const Kahoot = require('kahoot.js-updated');

const app = express();
app.use(express.static('.'));

const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

wss.on('connection', ws => {
  ws.on('message', async raw => {
    try {
      const msg = JSON.parse(raw);

      if (msg.action === 'join') {
        // Kahoot client disabled for now
        ws.send(JSON.stringify({ event: 'info', message: 'Kahoot client disabled for testing' }));
      }

      if (msg.action === 'answer') {
        ws.send(JSON.stringify({ event: 'answered', choice: msg.choice }));
      }

      if (msg.action === 'leave') {
        ws.send(JSON.stringify({ event: 'left' }));
      }
    } catch (e) {
      ws.send(JSON.stringify({ event: 'error', message: 'Invalid message' }));
    }
  });

  ws.on('close', () => {});
});

server.listen(3000, () => console.log('Server listening on http://localhost:3000'));
