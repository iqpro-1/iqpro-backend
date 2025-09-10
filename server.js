// backend/server.js
const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer');

const app = express();

// Body parser (HTML grande)
app.use(express.json({ limit: '15mb' }));

// CORS (ajuste origin depois)
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type'],
}));

// Preflight genérico
app.use((req, res, next) => {
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    return res.sendStatus(204);
  }
  next();
});

// Health
app.get('/health', (req, res) => {
  res.json({ ok: true, ts: new Date().toISOString() });
});

// Home
app.get('/', (req, res) => {
  res.type('text/plain').send('IQPro backend OK');
});

/**
 * Utilitário: tenta retornar o primeiro caminho existente na lista.
 */
function firstExisting(paths) {
  for (const p of paths) {
    if (p && fs.existsSync(p)) return p;
  }
  return null;
}

/**
 * Busca recursiva (rasteira) por um arquivo chamado "chrome" (ou "chrome-headless-shell")
 * dentro de um diretório base. Limita profundidade para evitar custos altos.
 */
function findChromeBinary(baseDir, maxDepth = 4) {
  try {
    if (!baseDir || !fs.existsSync(baseDir)) return null;

    const targetNames = new Set(['chrome', 'chrome-headless-shell']);
    function walk(dir, depth) {
      if (depth > maxDepth) return null;
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const e of entries) {
        const full = path.join(dir, e.name);
        if (e.isFile() && targetNames.has(e.name) && fs.existsSync(full)) {
          return full;
        }
      }
      for (const e of entries) {
        if (e.isDirectory()) {
          const found = walk(path.join(dir, e.name), depth + 1);
          if (found) return found;
        }
      }
      return null;
    }
    return walk(baseDir, 0);
  } catch {
    return null;
  }
}

// PDF
app.post('/api/gerar-pdf', async (req, res) => {
  const { html } = req.body;
  console.log('🚀 /api/gerar-pdf chamado. HTML length:', html?.length || 0);

  if (!html) return res.status(400).json({ error: 'HTML ausente' });

  let browser;
  try {
    const projectRoot = process.cwd();

    // 1) Prioriza caminho explícito via ENV (se você definiu em Render → Environment)
    const envExec = process.env.PUPPETEER_EXECUTABLE_PATH;

    // 2) Tenta em .puppeteer dentro do projeto (artefato de build)
    //    - casos comuns: chrome for testing e chrome-headless-shell
    const localCache = path.join(projectRoot, '.puppeteer');
    const localChromeGuess = firstExisting([
      path.join(localCache, 'chrome', 'linux-140.0.7339.80', 'chrome-linux64', 'chrome'),
      path.join(localCache, 'chrome-headless-shell', 'linux-140.0.7339.80', 'chrome-headless-shell-linux64', 'chrome-headless-shell'),
    ]) || findChromeBinary(localCache);

    // 3) Últimos candidatos: diretórios padrão do Render (se o cache do build sobrevive)
    const renderCache = process.env.PUPPETEER_CACHE_DIR || '/opt/render/.cache/puppeteer';
    const renderGuess = firstExisting([
      path.join(renderCache, 'chrome', 'linux-140.0.7339.80', 'chrome-linux64', 'chrome'),
      path.join(renderCache, 'chrome-headless-shell', 'linux-140.0.7339.80', 'chrome-headless-shell-linux64', 'chrome-headless-shell'),
    ]) || findChromeBinary(renderCache);

    // 4) Por fim, deixa o Puppeteer resolver (pode apontar para Chrome for Testing baixado)
    let execPath = firstExisting([envExec, localChromeGuess, renderGuess]);

    if (!execPath) {
      try {
        const p = await puppeteer.executablePath();
        if (p && fs.existsSync(p)) execPath = p;
      } catch {
        // ignora — vamos reportar melhor abaixo
      }
    }

    // 5) Se ainda não achou, retorna erro com caminhos tentados para facilitar debug
    if (!execPath) {
      const tried = [
        envExec,
        localChromeGuess ? '(dinâmico: encontrado via scan em .puppeteer)' : path.join(localCache, '...'),
        renderGuess ? '(dinâmico: encontrado via scan em cache do Render)' : path.join(renderCache, '...'),
        '(puppeteer.executablePath() falhou ou não existe no filesystem)',
      ];
      return res.status(500).json({
        error: 'Chrome não encontrado no runtime',
        details: 'Nenhum executável válido foi localizado.',
        tried,
      });
    }

    console.log('🧭 Usando Chrome em:', execPath);

    browser = await puppeteer.launch({
      headless: 'new',
      executablePath: execPath,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--single-process',
        '--no-zygote',
      ],
    });

    const page = await browser.newPage();
    page.setDefaultNavigationTimeout(0);
    page.setDefaultTimeout(0);

    await page.setContent(html, { waitUntil: 'networkidle0', timeout: 0 });

    const pdfBuffer = await page.pdf({
      format: 'A4',
      printBackground: true,
      margin: { top: '20px', bottom: '20px', left: '20px', right: '20px' },
    });
    console.log('✅ PDF gerado. Bytes:', pdfBuffer.length);

    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': 'attachment; filename="prova.pdf"',
    });
    res.send(pdfBuffer);
  } catch (err) {
    console.error('❌ Erro ao gerar PDF:', err);
    res.status(500).json({ error: 'Erro ao gerar PDF', details: err.message });
  } finally {
    if (browser) await browser.close();
  }
});

// Start
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Servidor ouvindo em http://localhost:${PORT}`);
});
