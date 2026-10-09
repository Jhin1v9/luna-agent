const fs = require('fs');
const p = 'index.html';
let h = fs.readFileSync(p, 'utf8');

const anchor = '        <article class="card">\n          <span class="badge">Em breve</span>\n          <span class="kicker">Cliente</span>\n          <h3>Santafe</h3>';
if (!h.includes(anchor)) { console.error('ANCORA NAO ENCONTRADA'); process.exit(1); }

const card = [
  '        <article class="card">',
  '          <span class="badge" style="background:rgba(217,119,6,0.15);color:#d97706">Lead · Novo</span>',
  '          <span class="kicker">Lead · Gestoria contábil</span>',
  '          <h3>Miranda Gestión Contable</h3>',
  '          <p>Plataforma SaaS multiempresa para gestoria espanhola: faturação, motor fiscal AEAT/Navarra, VERI*FACTU/SIF, OCR, conciliação bancária, portal do cliente e gestão de honorários. Relatório completo: visão, escopo, módulos, MVP e roadmap.</p>',
  '          <a class="cta" href="#entrar">Entrar com e-mail</a>',
  '        </article>',
  ''
].join('\n');

h = h.replace(anchor, card + anchor);
fs.writeFileSync(p, h);
console.log('card inserido');
