const express = require('express');
const http = require('http');
const WebSocket = require('ws');
// Kahoot client disabled for testing

const app = express();
app.use(express.static('.'));

const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

wss.on('connection', ws => {
  ws.on('message', async raw => {
    try {
      const msg = JSON.parse(raw);

      if (msg.action === 'join') {
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

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server listening on http://localhost:${PORT}`));
