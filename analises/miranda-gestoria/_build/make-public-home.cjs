const fs = require('fs');
let h = fs.readFileSync('index.html', 'utf8');

const start = h.indexOf('  <main class="edicoes">');
const end = h.indexOf('</main>');
if (start === -1 || end === -1) { console.error('SECAO EDICOES NAO ENCONTRADA'); process.exit(1); }

const notice = `  <main class="edicoes">
    <div class="wrap">
      <div class="section-head">
        <h2>Acesso restrito</h2>
        <small>clientes e equipe Nexo Digital</small>
      </div>
      <p style="max-width:640px;color:var(--muted);font-size:.95rem">
        Esta central é privada. Clientes entram com o e-mail de cadastro no formulário acima
        e vão direto ao seu relatório. A listagem de projetos fica disponível apenas para a
        equipe Nexo Digital autenticada.
      </p>
    </div>
  </main>`;

h = h.slice(0, start) + notice + h.slice(end + '</main>'.length);
h = h.replace('<title>Nexo Digital — Central de Relatórios</title>', '<title>Nexo Digital — Central de Relatórios · Acesso</title>');
h = h.replace('Edição contínua · vol. 2026', 'Acesso restrito · vol. 2026');
fs.writeFileSync('index-public.html', h);
console.log('index-public.html criado');
