const fs = require('fs');
const path = require('path');
const base = '/home/nexo/Documentos/VPS/VPS/relatorios/public/clientes';
const btn = '<a href="/relatorios/" aria-label="Voltar aos relatórios" style="position:fixed;bottom:1.25rem;left:1.25rem;z-index:200;display:inline-flex;align-items:center;gap:.4rem;background:#1a1a1a;color:#f7f4ef;text-decoration:none;font:600 .82rem Inter,system-ui,sans-serif;padding:.6rem 1rem;border-radius:999px;box-shadow:0 8px 20px -8px rgba(0,0,0,.5);border:1px solid rgba(255,255,255,.12)">&#8592; Voltar</a>';
const files = ['jr-reformas/index.html', 'hdm/index.html', 'onadance/index.html', 'eduardo-transporte/index.html', 'miranda-gestoria/index.html', '_em-breve.html'];
let ok = 0;
for (const f of files) {
  const p = path.join(base, f);
  if (!fs.existsSync(p)) { console.log('SKIP (nao existe):', f); continue; }
  let h = fs.readFileSync(p, 'utf8');
  if (h.includes('Voltar aos relatórios')) { console.log('JA TEM:', f); continue; }
  if (!h.includes('</body>')) { console.log('SEM </body> (nao alterado):', f); continue; }
  fs.copyFileSync(p, p + '.bak-voltar20261001');
  h = h.replace('</body>', btn + '\n</body>');
  fs.writeFileSync(p, h);
  ok++;
  console.log('OK:', f);
}
console.log('alterados:', ok);
