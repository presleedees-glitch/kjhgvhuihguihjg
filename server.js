// server.js
const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const mustache = require('mustache');
const { Low, JSONFile } = require('lowdb');
const { nanoid } = require('nanoid');
const path = require('path');
const fs = require('fs');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

/* --- Simple JSON DB (file persistence) --- */
const dbFile = path.join(__dirname, 'db.json');
if (!fs.existsSync(dbFile)) fs.writeFileSync(dbFile, JSON.stringify({ conversations: [], templates: [] }));
const adapter = new JSONFile(dbFile);
const db = new Low(adapter);

async function initDb(){
  await db.read();
  db.data = db.data || { conversations: [], templates: [] };
  // seed templates if empty
  if (!db.data.templates.length) {
    db.data.templates.push(
      { id: 'tpl-pricing-a', variant: 'A', body: 'Hi {{name}}, pricing starts at ${{price}}/mo. Quick compare?' },
      { id: 'tpl-pricing-b', variant: 'B', body: 'Hey {{name}} — our plans start at ${{price}}/mo. Many customers pick Pro for X.' }
    );
    await db.write();
  }
}
initDb();

/* --- Static widget --- */
app.use(express.static(path.join(__dirname, 'public')));
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'widget.html')));

/* --- Minimal rule engine --- */
function classifyIntent(text){
  const t = text.toLowerCase();
  if (t.includes('price') || t.includes('pricing') || t.includes('cost')) return { intent: 'pricing', confidence: 0.9 };
  if (t.includes('demo') || t.includes('trial')) return { intent: 'demo', confidence: 0.85 };
  return { intent: 'unknown', confidence: 0.4 };
}

function pickTemplate(intent){
  // A/B: alternate by random
  if (intent === 'pricing') {
    const variants = db.data.templates.filter(t => t.id.startsWith('tpl-pricing'));
    return variants[Math.random() < 0.5 ? 0 : 1];
  }
  return { body: "Sorry, I didn't get that. Would you like a human?" };
}

/* --- WebSocket handling --- */
wss.on('connection', ws => {
  ws.id = nanoid();
  ws.on('message', async raw => {
    try {
      const msg = JSON.parse(raw);
      if (msg.type === 'user_message') {
        await db.read();
        const convId = msg.conversationId || nanoid();
        // store message
        db.data.conversations.push({
          id: convId,
          messageId: nanoid(),
          sender: 'user',
          text: msg.text,
          createdAt: Date.now()
        });
        await db.write();

        // classify and decide
        const cls = classifyIntent(msg.text);
        let action = { type: 'reply', html: '<p>Let me check...</p>' };

        if (cls.intent === 'pricing' && cls.confidence > 0.6) {
          const tpl = pickTemplate('pricing');
          const html = mustache.render(tpl.body, { name: msg.name || 'there', price: '29' });
          action = { type: 'reply', html, quickReplies: ['Compare', 'Demo', 'Talk to human'], variant: tpl.variant };
        } else if (msg.text.toLowerCase().includes('human') || cls.confidence < 0.5) {
          action = { type: 'escalate', reason: 'low_confidence_or_user_request' };
        } else {
          action = { type: 'reply', html: '<p>Thanks — can you say more?</p>', quickReplies: ['Pricing', 'Demo', 'Human'] };
        }

        // persist bot action
        db.data.conversations.push({
          id: convId,
          messageId: nanoid(),
          sender: 'bot',
          text: action.html,
          meta: { actionType: action.type, variant: action.variant || null },
          createdAt: Date.now()
        });
        await db.write();

        // send back to client
        ws.send(JSON.stringify({ type: 'action', conversationId: convId, action }));
      }
    } catch (e) {
      console.error(e);
    }
  });
});

/* --- Health and simple admin endpoints --- */
app.get('/admin/conversations', async (req, res) => {
  await db.read();
  res.json(db.data.conversations.slice(-200));
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log('listening on', PORT));
