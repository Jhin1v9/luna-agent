#!/usr/bin/env node
/**
 * Troca o code de autorização do Gmail OAuth por tokens e grava em .brain/.gmail_token.json.
 *
 * Uso (uma vez, depois do Abner autorizar no navegador):
 *   1. Abner cria o OAuth client no Google Cloud Console (Desktop app) e me manda GMAIL_CLIENT_ID + GMAIL_CLIENT_SECRET.
 *   2. Eu abro a URL de autorização (escopo gmail.send + gmail.readonly) e ele autoriza com nexodigital.sys@gmail.com.
 *   3. Com o ?code= retornado: node scripts/gmail-token.mjs "<code>"
 *
 * Escopo mínimo decretado (02/10): rascunhos sem envio automático virou OBSOLETO — decreto 08/10
 * pede agente que ENVIA e-mail. Escopos: https://www.googleapis.com/auth/gmail.send
 * (+ gmail.readonly se formos ler resumos). Access token dura 1h; o refresh token fica gravado
 * aqui e a automação de envio renova sozinha.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const env = fs.readFileSync(path.join(ROOT, '.env'), 'utf8');
const get = (k) => (env.match(new RegExp('^' + k + '=(.*)$', 'm')) || [])[1];
const CLIENT_ID = get('GMAIL_CLIENT_ID');
const CLIENT_SECRET = get('GMAIL_CLIENT_SECRET');
const code = process.argv[2];

if (!CLIENT_ID || !CLIENT_SECRET) {
  console.error('GMAIL_CLIENT_ID/GMAIL_CLIENT_SECRET ausentes no .env — pedir ao Abner (Google Cloud Console → OAuth client, Desktop app, escopo gmail.send).');
  process.exit(1);
}
if (!code) {
  const url = 'https://accounts.google.com/o/oauth2/v2/auth?' + new URLSearchParams({
    client_id: CLIENT_ID,
    redirect_uri: 'http://localhost:3000/oauth2callback',
    response_type: 'code',
    scope: 'https://www.googleapis.com/auth/gmail.send https://www.googleapis.com/auth/gmail.readonly',
    access_type: 'offline',
    prompt: 'consent',
  });
  console.log('Abra esta URL e autorize com nexodigital.sys@gmail.com:\n' + url);
  process.exit(0);
}

fetch('https://oauth2.googleapis.com/token', {
  method: 'POST',
  headers: { 'content-type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams({
    code,
    client_id: CLIENT_ID,
    client_secret: CLIENT_SECRET,
    redirect_uri: 'http://localhost:3000/oauth2callback',
    grant_type: 'authorization_code',
  }).toString(),
})
  .then(async (res) => {
    const data = await res.json();
    if (!res.ok) { console.error('ERRO', res.status, JSON.stringify(data)); process.exit(1); }
    if (!data.refresh_token) console.warn('ATENÇÃO: Google não devolveu refresh_token (já autorizou antes?) — reautorize com prompt=consent.');
    const out = path.join(ROOT, '.brain', '.gmail_token.json');
    fs.writeFileSync(out, JSON.stringify({ ...data, savedAt: new Date().toISOString() }, null, 2));
    console.log('OK — tokens gravados em', out);
  })
  .catch((e) => { console.error('ERR', e.message); process.exit(1); });
