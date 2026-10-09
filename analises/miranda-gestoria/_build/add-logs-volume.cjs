const fs = require('fs');
const p = 'docker-compose.yml';
let h = fs.readFileSync(p, 'utf8');

const anchor = '      - ./relatorios/data/cambios:/app/data/cambios\n';
if (!h.includes(anchor)) { console.error('ANCORA NAO ENCONTRADA'); process.exit(1); }
h = h.replace(anchor, anchor + '      # log de acessos do portal (auditoria: quem entrou/viu, quando, de onde)\n      - ./relatorios/data/logs:/app/data/logs\n');
fs.writeFileSync(p, h);
console.log('volume de logs adicionado');
