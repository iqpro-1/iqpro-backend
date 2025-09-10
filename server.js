// backend/server.js
const express = require('express');
const cors = require('cors');

const app = express();

// — Body parser com limite generoso (para HTML grande futuramente)
app.use(express.json({ limit: '15mb' }));

// — CORS (ajuste a origin para seu domínio Netlify quando souber)
app.use(cors({
  origin: '*', // ex.: 'https://SEU-SITE.netlify.app'
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type'],
}));


// Responder qualquer preflight sem usar app.options('*')
app.use((req, res, next) => {
  if (req.method === 'OPTIONS') {
    // se quiser, pode manter os headers aqui também:
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    return res.sendStatus(204);
  }
  next();
});


// — Rota de saúde
app.get('/health', (req, res) => {
  res.json({ ok: true, ts: new Date().toISOString() });
});

// — Home simples
app.get('/', (req, res) => {
  res.type('text/plain').send('IQPro backend OK');
});

// — Stub provisório para gerar PDF (só pra testar POST)
app.post('/api/gerar-pdf', (req, res) => {
  const { html } = req.body || {};
  if (!html || typeof html !== 'string') {
    return res.status(400).json({ error: 'Envie { html: "<html...>" }' });
  }
  // Por enquanto, só confirma recebimento
  return res.json({ received: true, length: html.length });
});

// — Porta do Render vem de process.env.PORT
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Servidor ouvindo em http://localhost:${PORT}`);
});
