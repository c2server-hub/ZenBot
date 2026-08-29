const express = require('express');
const path = require('path');
const SnapchatBot = require('./bot-core');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'dashboard.html'));
});

const bot = new SnapchatBot();

const clients = new Set();
app.get('/api/events', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();
  clients.add(res);
  req.on('close', () => clients.delete(res));
});
const broadcast = (event, data) => {
  for (const res of clients) res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
};
bot.on('log', l => broadcast('log', l));
bot.on('status', s => broadcast('status', s));

const needRunning = (req, res, next) =>
  bot.running ? next() : res.status(409).json({ error: 'Bot non démarré' });

app.get('/api/status', (req, res) => res.json(bot.status()));
app.get('/api/commands', (req, res) => res.json(bot.commandsDoc()));
app.get('/api/logs', (req, res) => res.json(bot.logs.slice(-200)));

app.post('/api/start', async (req, res) => { await bot.start(); res.json({ ok: true }); });
app.post('/api/stop', async (req, res) => { await bot.stop(); res.json({ ok: true }); });
app.post('/api/restart', async (req, res) => { await bot.restart(); res.json({ ok: true }); });

app.post('/api/send', needRunning, async (req, res) => {
  try { await bot.send(req.body.message || ''); res.json({ ok: true }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/mention', needRunning, async (req, res) => {
  try { await bot.send(req.body.message || '👋', { mentionUser: req.body.user }); res.json({ ok: true }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/config', (req, res) => {
  if (req.body.groupName) {
    require('./bot-core').CONFIG.groupName = req.body.groupName.trim();
    broadcast('status', bot.status());
  }
  res.json({ ok: true, note: 'Redémarre le bot pour appliquer le nouveau groupe' });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🖥️  Dashboard : http://localhost:${PORT}`);
  bot.start();
});

process.on('SIGINT', async () => { await bot.stop(); process.exit(0); });