// server.js
const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const Kahoot = require('kahoot.js-updated');

const app = express();
app.use(express.static('.'));

const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

wss.on('connection', ws => {
  ws.on('message', async raw => {
    try {
      const msg = JSON.parse(raw);
      if (msg.action === 'join') {
        const client = new Kahoot();
        ws.kahootClient = client;

        client.on('joined', () => ws.send(JSON.stringify({ event: 'joined' })));
        client.on('quizStart', quiz => ws.send(JSON.stringify({ event: 'quizStart', quiz })));
        client.on('questionStart', q => ws.send(JSON.stringify({ event: 'questionStart', question: q })));
        client.on('questionEnd', () => ws.send(JSON.stringify({ event: 'questionEnd' })));
        client.on('quizEnd', () => ws.send(JSON.stringify({ event: 'quizEnd' })));
        client.on('error', err => ws.send(JSON.stringify({ event: 'error', message: String(err) })));

        try {
          await client.join(msg.pin, msg.nick);
        } catch (err) {
          ws.send(JSON.stringify({ event: 'error', message: String(err) }));
        }
      }

      if (msg.action === 'answer' && ws.kahootClient && ws.kahootClient.question) {
        // msg.choice is 0-based index of answer
        try {
          ws.kahootClient.question.answer(msg.choice);
          ws.send(JSON.stringify({ event: 'answered', choice: msg.choice }));
        } catch (err) {
          ws.send(JSON.stringify({ event: 'error', message: String(err) }));
        }
      }

      if (msg.action === 'leave' && ws.kahootClient) {
        try { ws.kahootClient.leave(); } catch(e){}
        delete ws.kahootClient;
        ws.send(JSON.stringify({ event: 'left' }));
      }
    } catch (e) {
      ws.send(JSON.stringify({ event: 'error', message: 'Invalid message' }));
    }
  });

  ws.on('close', () => {
    if (ws.kahootClient) try { ws.kahootClient.leave(); } catch(e){}
  });
});

server.listen(3000, () => console.log('Server listening on http://localhost:3000'));
