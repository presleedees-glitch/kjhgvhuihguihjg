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

const DB_FILE = process.env.DB_FILE || path.join(__dirname, 'db.json');
const PUBLIC_DIR = path.join(__dirname, 'public');

function ensureDbFile(filePath) {
  try {
    if (!fs.existsSync(filePath)) {
      fs.writeFileSync(filePath, JSON.stringify({ conversations: [], templates: [] }, null, 2), { flag: 'w' });
    }
    // quick permission check
    fs.accessSync(filePath, fs.constants.R_OK | fs.constants.W_OK);
  } catch (err) {
    console.error('DB file error:', err);
    // fallback to temp file to avoid crash on platforms with restricted FS
    const tmp = path.join(require('os').tmpdir(), `matery-db-${Date.now()}.json`);
    fs.writeFileSync(tmp, JSON.stringify({ conversations: [], templates: [] }, null, 2));
    return tmp;
  }
  return filePath;
}

const resolvedDbFile = ensureDbFile(DB_FILE);
const adapter = new JSONFile(resolvedDbFile);
const db = new Low(adapter);

async function initDb(){
  await db.read();
  db.data = db.data || { conversations: [], templates: [] };
  if (!Array.isArray(db.data.templates) || db.data.templates.length === 0) {
    db.data.templates = [
      { id: 'tpl-pricing-a', variant: 'A', body: 'Hi {{name}}, pricing starts at ${{price}}/mo. Quick compare?' },
      { id: 'tpl-pricing-b', variant: 'B', body: 'Hey {{name}} — our plans start at ${{price}}/mo. Many customers pick Pro for X.' }
    ];
    await db.write();
  }
}
initDb().catch(e => console.error('initDb error', e));

app.use(express.static(PUBLIC_DIR));
app.get('/', (req, res) => res.sendFile(path.join(PUBLIC_DIR, 'widget.html')));

function classifyIntent(text){
  const t = (text || '').toLowerCase();
  if (t.includes('price') || t.includes('pricing') || t.includes('cost')) return { intent: 'pricing', confidence: 0.9 };
  if (t.includes('demo') || t.includes('trial')) return { intent: 'demo', confidence: 0.85 };
  return { intent: 'unknown', confidence: 0.4 };
}

function pickTemplate(intent){
  if (intent === 'pricing') {
    const variants = (db.data.templates || []).filter(t => t.id && t.id.startsWith('tpl-pricing'));
    if (!variants.length) return { body: 'Pricing info coming soon.' };
    return variants[Math.random() < 0.5 ? 0 : 1];
  }
  return { body: "Sorry, I didn't get that. Would you like a human?" };
}

wss.on('connection', ws => {
  ws.id = nanoid();
  ws.on('message', async raw => {
    try {
      const msg = JSON.parse(raw);
      if (msg.type === 'user_message') {
        await db.read();
        const convId = msg.conversationId || nanoid();
        db.data.conversations.push({
          conversationId: convId,
          messageId: nanoid(),
          sender: 'user',
          text: msg.text,
          createdAt: Date.now()
        });
        await db.write();

        const cls = classifyIntent(msg.text);
        let action = { type: 'reply', html: '<p>Let me check...</p>' };

        if (cls.intent === 'pricing' && cls.confidence > 0.6) {
          const tpl = pickTemplate('pricing');
          const html = mustache.render(tpl.body, { name: msg.name || 'there', price: process.env.DEFAULT_PRICE || '29' });
          action = { type: 'reply', html, quickReplies: ['Compare', 'Demo', 'Talk to human'], variant: tpl.variant };
        } else if ((msg.text || '').toLowerCase().includes('human') || cls.confidence < 0.5) {
          action = { type: 'escalate', reason: 'low_confidence_or_user_request' };
        } else {
          action = { type: 'reply', html: '<p>Thanks — can you say more?</p>', quickReplies: ['Pricing', 'Demo', 'Human'] };
        }

        db.data.conversations.push({
          conversationId: convId,
          messageId: nanoid(),
          sender: 'bot',
          text: action.html,
          meta: { actionType: action.type, variant: action.variant || null },
          createdAt: Date.now()
        });
        await db.write();

        ws.send(JSON.stringify({ type: 'action', conversationId: convId, action }));
      }
    } catch (e) {
      console.error('ws message error', e);
      try { ws.send(JSON.stringify({ type: 'error', message: 'Server error processing message' })); } catch {}
    }
  });

  ws.on('error', err => console.error('ws error', err));
});

app.get('/admin/conversations', async (req, res) => {
  try {
    await db.read();
    res.json((db.data.conversations || []).slice(-200));
  } catch (e) {
    res.status(500).json({ error: 'failed to read conversations' });
  }
});

const PORT = parseInt(process.env.PORT, 10) || 3000;
server.listen(PORT, '0.0.0.0', () => console.log(`listening on ${PORT}`));
