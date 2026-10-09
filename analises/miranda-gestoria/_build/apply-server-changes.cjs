const fs = require('fs');
const p = 'server.js';
let h = fs.readFileSync(p, 'utf8');
let n = 0;
const rep = (oldStr, newStr) => {
  if (!h.includes(oldStr)) { console.error('ANCORA NAO ENCONTRADA: ' + oldStr.slice(0, 60)); process.exit(1); }
  h = h.replace(oldStr, newStr);
  n++;
};

// 1) consts do log de acessos
rep(
  "const CAMBIOS_DIR = path.join(DATA_DIR, 'cambios');",
  "const CAMBIOS_DIR = path.join(DATA_DIR, 'cambios');\nconst ACCESS_LOG_DIR = path.join(DATA_DIR, 'logs');\nconst ACCESS_LOG = path.join(ACCESS_LOG_DIR, 'access.log');"
);

// 2) helper logAccess antes da sessao
rep(
  '// --- sessão assinada (HMAC) -------------------------------------------------',
  `// --- log de acessos (quem entrou, quando, de onde, o que viu) ---------------
function logAccess(rec) {
  try {
    if (!fs.existsSync(ACCESS_LOG_DIR)) fs.mkdirSync(ACCESS_LOG_DIR, { recursive: true });
    try {
      const st = fs.statSync(ACCESS_LOG);
      if (st.size > 5 * 1024 * 1024) fs.renameSync(ACCESS_LOG, ACCESS_LOG + '.1');
    } catch {}
    const line = JSON.stringify({ ts: new Date().toISOString(), ...rec }) + '\\n';
    fs.appendFileSync(ACCESS_LOG, line, { mode: 0o600 });
  } catch (e) {
    console.error('falha ao gravar access.log:', e.message);
  }
}

// --- sessão assinada (HMAC) -------------------------------------------------`
);

// 3) log de login ok / falha
rep(
  "    if (!session) {\n      noteFail(ip);",
  "    if (session) {\n      logAccess({ ev: 'login', email, role: isTeam ? 'team' : 'client', slug: (user && user.slug) || null, ip, ua: (req.headers['user-agent'] || '').slice(0, 200) });\n    }\n    if (!session) {\n      logAccess({ ev: 'login_fail', email, ip, ua: (req.headers['user-agent'] || '').slice(0, 200) });\n      noteFail(ip);"
);

// 4) API de acessos (equipe) antes do 404 da api
rep(
  "      return json(res, 404, { error: 'ruta_api_no_encontrada' });",
  `      // GET /nexo/api/acessos => últimos acessos ao portal (log de auditoria)
      if (api === 'acessos' && req.method === 'GET') {
        const limit = Math.max(1, Math.min(500, parseInt((url.searchParams.get('limit') || '100'), 10)));
        let lines = [];
        try { lines = fs.readFileSync(ACCESS_LOG, 'utf8').split('\\n').filter(Boolean); } catch {}
        const rows = lines.slice(-limit).reverse().map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
        return json(res, 200, { total: lines.length, acessos: rows });
      }

      return json(res, 404, { error: 'ruta_api_no_encontrada' });`
);

// 5) log de view nas paginas de cliente
rep(
  "    if (!allowed) return deny(res);\n    const rest = m[2];",
  "    if (!allowed) return deny(res);\n    logAccess({ ev: 'view', email: session.e, role: session.r, slug, path: rel, ip });\n    const rest = m[2];"
);

// 6) home: cliente -> propria pagina; equipe -> listagem com cards; anonimo -> so login
rep(
  "  // Portal (home pública, estilo jornal)\n  if (rel === '/' || rel === '/index.html') {\n    return sendFile(res, path.join(PUBLIC_DIR, 'index.html'), { cache: 'no-cache' });\n  }",
  `  // Portal: cliente logado vai direto ao próprio relatório; equipe vê a
  // listagem completa (cards); anônimo vê apenas a página de login (sem cards).
  if (rel === '/' || rel === '/index.html') {
    if (session && session.r === 'client') {
      return redirect(res, BASE + '/clientes/' + session.s + '/');
    }
    if (session && session.r === 'team') {
      logAccess({ ev: 'home', email: session.e, role: 'team', ip });
      return sendFile(res, path.join(PUBLIC_DIR, 'index.html'), { cache: 'no-store' });
    }
    return sendFile(res, path.join(PUBLIC_DIR, 'index-public.html'), { cache: 'no-store' });
  }`
);

fs.writeFileSync(p, h);
console.log('server.js atualizado (' + n + ' mudancas)');
