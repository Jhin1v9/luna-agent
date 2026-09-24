import fs from 'node:fs';
import path from 'node:path';

const dir = path.join(process.env.USERPROFILE || '', '.luna/chrome-whatsapp/Default/IndexedDB/https_web.whatsapp.com_0.indexeddb.leveldb');
const files = fs.readdirSync(dir).filter((f) => f.endsWith('.ldb') || f.endsWith('.log'));
const pats = ['Reformas integrales', 'HDM - Indu', 'Production - 2026', 'Production'];
const jidRe = /[0-9]{8,20}(-[0-9]{1,4})?@g\.us/g;

for (const pat of pats) {
  const hits = new Map(); // jid -> count
  for (const f of files) {
    const buf = fs.readFileSync(path.join(dir, f));
    let idx = 0;
    while ((idx = buf.indexOf(pat, idx)) !== -1) {
      const start = Math.max(0, idx - 2000);
      const chunk = buf.slice(start, idx + 2000).toString('latin1');
      jidRe.lastIndex = 0;
      let m;
      while ((m = jidRe.exec(chunk))) {
        hits.set(m[0], (hits.get(m[0]) || 0) + 1);
      }
      idx += pat.length;
    }
  }
  console.log(pat, '=>', JSON.stringify([...hits.entries()]));
}
