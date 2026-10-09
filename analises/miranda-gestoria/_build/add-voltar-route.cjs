const fs = require('fs');
const p = 'server.js';
let h = fs.readFileSync(p, 'utf8');

const anchor = "  // Logout\n  if (p === BASE + '/sair') {\n    return redirect(res, BASE + '/', sessionCookie('sair', 0));\n  }\n";
if (!h.includes(anchor)) { console.error('ANCORA NAO ENCONTRADA'); process.exit(1); }

h = h.replace(anchor, anchor + `
  // Voltar de dentro de um relatório: equipe vai à listagem (continua logada);
  // cliente encerra a sessão e cai no campo de login (evita o loop / -> /clientes/<slug>).
  if (p === BASE + '/voltar') {
    if (session && session.r === 'client') return redirect(res, BASE + '/sair');
    return redirect(res, BASE + '/');
  }
`);
fs.writeFileSync(p, h);
console.log('rota /voltar adicionada');
