/**
 * Endpoint de debug para diagnosticar configuração do Gmail OAuth2
 */
const express = require('express');
const router = express.Router();

router.get('/api/debug/gmail-config', (req, res) => {
  const clientId = process.env.GMAIL_CLIENT_ID || '';
  const clientSecret = process.env.GMAIL_CLIENT_SECRET || '';
  const redirectUri = process.env.GMAIL_REDIRECT_URI || '';

  // Mostrar caracteres especiais, espaços, quebras de linha
  const analyze = (str) => ({
    length: str.length,
    startsWithSpace: str.startsWith(' '),
    endsWithSpace: str.endsWith(' '),
    hasNewline: str.includes('\n'),
    hasCarriageReturn: str.includes('\r'),
    hasTab: str.includes('\t'),
    firstChars: str.slice(0, 20),
    lastChars: str.slice(-20),
    masked: str.length > 10 
      ? str.slice(0, 5) + '...' + str.slice(-5) 
      : str
  });

  res.json({
    nodeEnv: process.env.NODE_ENV,
    clientId: analyze(clientId),
    clientSecret: analyze(clientSecret),
    redirectUri: analyze(redirectUri),
    expectedClientId: '644081746963-86dupr1e9i9ma17f049ui530cenkjfs2.apps.googleusercontent.com',
    expectedClientIdLength: '644081746963-86dupr1e9i9ma17f049ui530cenkjfs2.apps.googleusercontent.com'.length,
  });
});

module.exports = router;
