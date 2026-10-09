const fs = require('fs');
const p = 'server.js';
let h = fs.readFileSync(p, 'utf8');

const broken = "  if (p === BASE + '/voltar') {\n    if (session && session.r === 'client') return redirect(res, BASE + '/sair');\n    return redirect(res, BASE + '/');\n  }";
if (!h.includes(broken)) { console.error('TRECHO NAO ENCONTRADO'); process.exit(1); }

h = h.replace(broken, "  if (p === BASE + '/voltar') {\n    const s = readSession(req);\n    if (s && s.r === 'client') return redirect(res, BASE + '/sair');\n    return redirect(res, BASE + '/');\n  }");
fs.writeFileSync(p, h);
console.log('/voltar usa readSession local');
