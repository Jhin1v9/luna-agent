const path = require('path');
const fs = require('fs');

const CONTACTS_FILE = path.join(__dirname, '..', 'data', 'schema', 'contacts-map.json');
const CLIENTS_FILE = path.join(__dirname, '..', 'data', 'schema', 'clients-registry.json');

function loadJson(file) {
  if (!fs.existsSync(file)) return null;
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; }
}

/**
 * Detecta se um contato é cliente/lead baseado em email, phone ou instagram
 */
function detectClient({ email, phone, instagram, name }) {
  const contacts = loadJson(CONTACTS_FILE);
  const clients = loadJson(CLIENTS_FILE);
  const normalizedEmail = (email || '').toLowerCase().trim();
  const normalizedPhone = (phone || '').replace(/\D/g, '');
  const normalizedIg = (instagram || '').toLowerCase().trim().replace('@', '');
  const normalizedName = (name || '').toLowerCase().trim();

  // Verificar em contacts-map
  if (contacts?.contacts) {
    for (const [key, c] of Object.entries(contacts.contacts)) {
      const cEmail = (c.email || '').toLowerCase();
      const cPhone = (c.whatsapp || c.phones?.primary || '').replace(/\D/g, '');
      const cIg = (c.instagram || c.social?.instagram || '').toLowerCase().replace('@', '');
      const cName = (c.displayName || c.shortName || '').toLowerCase();

      if (normalizedEmail && cEmail === normalizedEmail) return { isClient: true, source: 'contacts', id: key, name: c.displayName };
      if (normalizedPhone && cPhone && (cPhone.includes(normalizedPhone) || normalizedPhone.includes(cPhone))) return { isClient: true, source: 'contacts', id: key, name: c.displayName };
      if (normalizedIg && cIg === normalizedIg) return { isClient: true, source: 'contacts', id: key, name: c.displayName };
      if (normalizedName && cName === normalizedName) return { isClient: true, source: 'contacts', id: key, name: c.displayName };
    }
  }

  // Verificar em clients-registry
  if (clients?.clients) {
    for (const [key, c] of Object.entries(clients.clients)) {
      const cEmail = (c.email || '').toLowerCase();
      const cPhone = (c.phone || '').replace(/\D/g, '');
      const cName = (c.displayName || '').toLowerCase();

      if (normalizedEmail && cEmail === normalizedEmail) return { isClient: true, source: 'clients', id: key, name: c.displayName, type: c.type };
      if (normalizedPhone && cPhone && (cPhone.includes(normalizedPhone) || normalizedPhone.includes(cPhone))) return { isClient: true, source: 'clients', id: key, name: c.displayName, type: c.type };
      if (normalizedName && cName === normalizedName) return { isClient: true, source: 'clients', id: key, name: c.displayName, type: c.type };
    }
  }

  return { isClient: false };
}

module.exports = { detectClient };
