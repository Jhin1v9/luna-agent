const Imap = require('imap');
const { simpleParser } = require('mailparser');
const nodemailer = require('nodemailer');
const path = require('path');
const fs = require('fs');

const EMAIL_CONFIG_FILE = path.join(__dirname, '..', 'data', 'email-config.json');
const EMAILS_FILE = path.join(__dirname, '..', 'data', 'emails.json');
const ATTACHMENTS_DIR = path.join(__dirname, '..', 'data', 'attachments');

if (!fs.existsSync(ATTACHMENTS_DIR)) fs.mkdirSync(ATTACHMENTS_DIR, { recursive: true });

class EmailAgent {
  constructor() {
    this.config = this.loadConfig();
  }

  loadConfig() {
    if (!fs.existsSync(EMAIL_CONFIG_FILE)) {
      return {
        imap: { host: 'imap.gmail.com', port: 993, tls: true },
        smtp: { host: 'smtp.gmail.com', port: 465, secure: true },
        user: '',
        password: '',
        checkInterval: 5 * 60 * 1000,
        folders: ['INBOX', 'Sent', 'Drafts', 'Trash']
      };
    }
    return JSON.parse(fs.readFileSync(EMAIL_CONFIG_FILE, 'utf8'));
  }

  saveConfig(config) {
    fs.writeFileSync(EMAIL_CONFIG_FILE, JSON.stringify(config, null, 2));
  }

  async fetchEmails(folder = 'INBOX', limit = 50) {
    return new Promise((resolve, reject) => {
      const imap = new Imap({
        user: this.config.user,
        password: this.config.password,
        host: this.config.imap.host,
        port: this.config.imap.port,
        tls: this.config.imap.tls,
        tlsOptions: { rejectUnauthorized: false },
        connTimeout: 30000,
        authTimeout: 30000
      });

      imap.once('ready', () => {
        imap.openBox(folder, false, (err, box) => {
          if (err) { imap.end(); return reject(err); }
          imap.search(['ALL'], (err, results) => {
            if (err) { imap.end(); return reject(err); }
            if (!results || results.length === 0) { imap.end(); return resolve([]); }

            const fetch = imap.fetch(results.slice(-limit), { bodies: '', struct: true });
            const emails = [];

            fetch.on('message', (msg, seqno) => {
              let raw = '';
              msg.on('body', (stream) => {
                stream.on('data', chunk => raw += chunk.toString('utf8'));
              });
              msg.once('attributes', (attrs) => {
                msg.once('end', async () => {
                  try {
                    const parsed = await simpleParser(raw);
                    emails.push({
                      id: `email-${seqno}`,
                      uid: attrs.uid,
                      folder,
                      messageId: parsed.messageId,
                      subject: parsed.subject || '(sem assunto)',
                      from: parsed.from?.text || parsed.from,
                      to: parsed.to?.text || parsed.to,
                      date: parsed.date,
                      text: parsed.text,
                      html: parsed.html,
                      isRead: attrs.flags?.includes('\\Seen') || false,
                      attachments: (parsed.attachments || []).map(a => ({
                        filename: a.filename,
                        contentType: a.contentType,
                        size: a.size
                      }))
                    });
                  } catch (e) {}
                });
              });
            });

            fetch.once('error', reject);
            fetch.once('end', () => { imap.end(); resolve(emails); });
          });
        });
      });

      imap.once('error', reject);
      imap.connect();
    });
  }

  async sendEmail({ to, subject, text, html, attachments = [] }) {
    const transporter = nodemailer.createTransport({
      host: this.config.smtp.host,
      port: this.config.smtp.port,
      secure: this.config.smtp.secure,
      auth: { user: this.config.user, pass: this.config.password }
    });

    const info = await transporter.sendMail({
      from: `"NEXO Digital" <${this.config.user}>`,
      to, subject, text, html,
      attachments: attachments.map(a => ({
        filename: a.filename,
        path: a.path || a.content
      }))
    });

    return { messageId: info.messageId, accepted: info.accepted, rejected: info.rejected };
  }

  loadEmailIndex() {
    if (!fs.existsSync(EMAILS_FILE)) return { emails: [], lastSync: null };
    return JSON.parse(fs.readFileSync(EMAILS_FILE, 'utf8'));
  }

  saveEmailIndex(index) {
    fs.writeFileSync(EMAILS_FILE, JSON.stringify(index, null, 2));
  }
}

module.exports = EmailAgent;
