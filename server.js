app.post('/api/gerar-pdf', async (req, res) => {
  const { html } = req.body;
  console.log("🚀 /api/gerar-pdf chamado. HTML length:", html?.length || 0);

  if (!html) {
    return res.status(400).json({ error: "HTML ausente" });
  }

  let browser;
  try {
    browser = await puppeteer.launch({
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'networkidle0' });

    const pdfBuffer = await page.pdf({ format: 'A4', printBackground: true });
    console.log("✅ PDF gerado. Bytes:", pdfBuffer.length);

    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': 'attachment; filename="prova.pdf"',
    });
    res.send(pdfBuffer);

  } catch (err) {
    console.error("❌ Erro ao gerar PDF:", err);
    res.status(500).json({ error: "Erro ao gerar PDF", details: err.message });
  } finally {
    if (browser) await browser.close();
  }
});
