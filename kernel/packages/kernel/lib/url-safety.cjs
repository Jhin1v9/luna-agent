'use strict';

// Wave3-fix G: SSRF guard for the LLM-facing network tools (fetchURL,
// downloadFile, browser). Default-DENY private/loopback/link-local/metadata/
// CGNAT destinations; the owner can punch holes with the
// LUNA_FETCH_ALLOW_HOSTS=host1,host2:port env allowlist.
//
// RESIDUAL (deferred, see wave3 plan "Out of scope"): DNS-rebinding — a
// public hostname that resolves to a private IP at connect time is NOT
// checked here; hostnames are validated literally. A full fix needs a
// custom `lookup` that resolves-then-validates before connecting.

const BLOCKED_HOSTNAMES = new Set(['localhost', 'ip6-localhost', 'ip6-loopback']);

function isPrivateIPv4(parts) { // parts: [a,b,c,d] numbers
  const [a, b] = parts;
  return a === 10 || a === 127 || (a === 172 && b >= 16 && b <= 31) ||
         (a === 192 && b === 168) || (a === 169 && b === 254) ||
         (a === 100 && b >= 64 && b <= 127) || a === 0 || a >= 224;
}

// Normalizes IPv4 literals incl. integer (2130706433), octal (0177.0.0.1),
// hex (0x7f000001) and short (127.1) forms to dotted parts, or null.
function parseIPv4(host) {
  const m = host.match(/^(\d+|0x[0-9a-f]+)(\.(\d+|0x[0-9a-f]+)){0,3}$/i);
  if (!m) return null;
  const parts = host.split('.').map(p => parseInt(p, p.startsWith('0x') ? 16 : (/^0\d/.test(p) ? 8 : 10)));
  if (parts.some(isNaN)) return null;
  let a, b, c, d;
  if (parts.length === 4) [a, b, c, d] = parts;
  else if (parts.length === 3) { [a, b] = parts; c = parts[2] >> 8; d = parts[2] & 255; }
  else if (parts.length === 2) { a = parts[0]; b = parts[1] >> 16; c = (parts[1] >> 8) & 255; d = parts[1] & 255; }
  else { a = parts[0] >> 24; b = (parts[0] >> 16) & 255; c = (parts[0] >> 8) & 255; d = parts[0] & 255; }
  if ([a, b, c, d].some(n => n > 255)) return null;
  return [a, b, c, d];
}

// Returns { ok: true } or { ok: false, reason }. allowList: ['host', 'host:port'].
function checkUrlSafety(rawUrl, allowList = []) {
  let u;
  try { u = new URL(rawUrl); } catch { return { ok: false, reason: 'URL inválida' }; }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return { ok: false, reason: `protocolo bloqueado: ${u.protocol}` };
  const host = u.hostname.toLowerCase().replace(/^\[/, '').replace(/\]$/, '').replace(/\.+$/, '');
  if (allowList.some(a => a === host || a === `${host}:${u.port}`)) return { ok: true };
  if (BLOCKED_HOSTNAMES.has(host) || host.endsWith('.localhost') || host.endsWith('.internal')) {
    return { ok: false, reason: `host local bloqueado: ${host}` };
  }
  const v4 = parseIPv4(host);
  if (v4) {
    if (isPrivateIPv4(v4)) return { ok: false, reason: `IP privado/loopback bloqueado: ${v4.join('.')}` };
    return { ok: true };
  }
  if (host.includes(':')) { // IPv6 literal
    if (host === '::1' || host === '::' || host.startsWith('fe80:') || host.startsWith('fc') || host.startsWith('fd') || host.startsWith('::ffff:') || host.startsWith('fec0:')) {
      return { ok: false, reason: `IPv6 local/privado bloqueado: ${host}` };
    }
    // IPv4 embedded in IPv6 tails: v4-compat ::/96 (e.g. [::127.0.0.1] →
    // canonical [::7f00:1]) and NAT64 64:ff9b::/96. WHATWG normalizes the
    // dotted form to hextets, so parse the last two hextets as IPv4.
    const compat = host.match(/^::([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
    const nat64 = host.match(/^64:ff9b::([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
    const embedded = compat || nat64;
    if (embedded) {
      const hi = parseInt(embedded[1], 16), lo = parseInt(embedded[2], 16);
      const parts = [(hi >> 8) & 255, hi & 255, (lo >> 8) & 255, lo & 255];
      if (isPrivateIPv4(parts)) {
        return { ok: false, reason: `IPv4 privado embutido em IPv6 bloqueado: ${parts.join('.')}` };
      }
    }
  }
  return { ok: true };
}

function fetchAllowList(env = process.env) {
  return (env.LUNA_FETCH_ALLOW_HOSTS || '').split(',').map(s => s.trim()).filter(Boolean);
}

module.exports = { checkUrlSafety, parseIPv4, isPrivateIPv4, fetchAllowList };
