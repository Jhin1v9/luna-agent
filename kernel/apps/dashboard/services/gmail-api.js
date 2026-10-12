/**
 * NEXO Mail — Gmail API Service
 * Wrapper completo sobre a Gmail API REST
 */

const gmailOAuth = require('./gmail-oauth');

class GmailAPIService {
  // ═════════════════════════════════════════════════════════════════
  // LISTAGEM & BUSCA
  // ═════════════════════════════════════════════════════════════════

  /**
   * Lista mensagens com filtros
   * @param {Object} options - { labelIds, q, maxResults, pageToken }
   */
  async listMessages(options = {}) {
    const gmail = await gmailOAuth.getGmailClient();
    const { labelIds, q, maxResults = 50, pageToken } = options;

    const res = await gmail.users.messages.list({
      userId: 'me',
      labelIds: labelIds || undefined,
      q: q || undefined,
      maxResults,
      pageToken: pageToken || undefined,
    });

    const messages = res.data.messages || [];
    const nextPageToken = res.data.nextPageToken || null;

    // Buscar detalhes básicos de cada mensagem (headers, snippet, labels)
    const detailed = await Promise.all(
      messages.slice(0, 20).map(async (msg) => {
        try {
          return await this.getMessage(msg.id, 'metadata');
        } catch (e) {
          return { id: msg.id, error: true };
        }
      })
    );

    return {
      messages: detailed,
      nextPageToken,
      resultSizeEstimate: res.data.resultSizeEstimate || messages.length,
    };
  }

  /**
   * Busca uma mensagem completa
   * @param {string} messageId
   * @param {string} format - 'full' | 'metadata' | 'minimal'
   */
  async getMessage(messageId, format = 'full') {
    const gmail = await gmailOAuth.getGmailClient();

    const res = await gmail.users.messages.get({
      userId: 'me',
      id: messageId,
      format,
    });

    return this.parseMessage(res.data);
  }

  /**
   * Busca uma thread completa
   */
  async getThread(threadId) {
    const gmail = await gmailOAuth.getGmailClient();

    const res = await gmail.users.threads.get({
      userId: 'me',
      id: threadId,
      format: 'full',
    });

    const thread = res.data;
    const messages = (thread.messages || []).map((msg) => this.parseMessage(msg));

    return {
      id: thread.id,
      historyId: thread.historyId,
      messages,
    };
  }

  // ═════════════════════════════════════════════════════════════════
  // AÇÕES SOBRE MENSAGENS
  // ═════════════════════════════════════════════════════════════════

  /**
   * Modifica labels de uma mensagem (lido, estrela, arquivar, etc.)
   * @param {string} messageId
   * @param {Object} options - { addLabelIds, removeLabelIds }
   */
  async modifyMessage(messageId, { addLabelIds = [], removeLabelIds = [] }) {
    const gmail = await gmailOAuth.getGmailClient();

    const res = await gmail.users.messages.modify({
      userId: 'me',
      id: messageId,
      requestBody: {
        addLabelIds,
        removeLabelIds,
      },
    });

    return { success: true, message: this.parseMessage(res.data) };
  }

  /**
   * Marca como lido
   */
  async markAsRead(messageId) {
    return this.modifyMessage(messageId, { removeLabelIds: ['UNREAD'] });
  }

  /**
   * Marca como não lido
   */
  async markAsUnread(messageId) {
    return this.modifyMessage(messageId, { addLabelIds: ['UNREAD'] });
  }

  /**
   * Estrelar / Desestrelar
   */
  async toggleStar(messageId, starred) {
    if (starred) {
      return this.modifyMessage(messageId, { addLabelIds: ['STARRED'] });
    }
    return this.modifyMessage(messageId, { removeLabelIds: ['STARRED'] });
  }

  /**
   * Arquivar (remove INBOX)
   */
  async archive(messageId) {
    return this.modifyMessage(messageId, { removeLabelIds: ['INBOX'] });
  }

  /**
   * Mover para lixeira
   */
  async trash(messageId) {
    const gmail = await gmailOAuth.getGmailClient();
    await gmail.users.messages.trash({ userId: 'me', id: messageId });
    return { success: true };
  }

  /**
   * Mover para spam
   */
  async spam(messageId) {
    return this.modifyMessage(messageId, { addLabelIds: ['SPAM'], removeLabelIds: ['INBOX'] });
  }

  /**
   * Restaurar da lixeira/spam
   */
  async untrash(messageId) {
    const gmail = await gmailOAuth.getGmailClient();
    await gmail.users.messages.untrash({ userId: 'me', id: messageId });
    return { success: true };
  }

  /**
   * Deletar permanentemente
   */
  async delete(messageId) {
    const gmail = await gmailOAuth.getGmailClient();
    await gmail.users.messages.delete({ userId: 'me', id: messageId });
    return { success: true };
  }

  // ═════════════════════════════════════════════════════════════════
  // ENVIO DE EMAIL
  // ═════════════════════════════════════════════════════════════════

  /**
   * Envia um email via Gmail API (raw MIME base64)
   */
  async sendEmail({ to, subject, text, html, cc, bcc, attachments = [], threadId, inReplyTo }) {
    const gmail = await gmailOAuth.getGmailClient();

    const boundary = `NEXO_MAIL_${Date.now()}`;
    let mimeBody = '';

    // Headers
    mimeBody += `To: ${to}\r\n`;
    if (cc) mimeBody += `Cc: ${cc}\r\n`;
    if (bcc) mimeBody += `Bcc: ${bcc}\r\n`;
    mimeBody += `Subject: ${subject}\r\n`;
    mimeBody += `MIME-Version: 1.0\r\n`;
    mimeBody += `Content-Type: multipart/mixed; boundary="${boundary}"\r\n`;
    if (threadId) mimeBody += `References: ${threadId}\r\n`;
    if (inReplyTo) mimeBody += `In-Reply-To: ${inReplyTo}\r\n`;
    mimeBody += `\r\n`;

    // Corpo do email (texto + HTML)
    const innerBoundary = `NEXO_BODY_${Date.now()}`;
    mimeBody += `--${boundary}\r\n`;
    mimeBody += `Content-Type: multipart/alternative; boundary="${innerBoundary}"\r\n`;
    mimeBody += `\r\n`;

    // Texto plano
    if (text) {
      mimeBody += `--${innerBoundary}\r\n`;
      mimeBody += `Content-Type: text/plain; charset=UTF-8\r\n`;
      mimeBody += `Content-Transfer-Encoding: base64\r\n`;
      mimeBody += `\r\n`;
      mimeBody += Buffer.from(text).toString('base64') + `\r\n`;
    }

    // HTML
    if (html) {
      mimeBody += `--${innerBoundary}\r\n`;
      mimeBody += `Content-Type: text/html; charset=UTF-8\r\n`;
      mimeBody += `Content-Transfer-Encoding: base64\r\n`;
      mimeBody += `\r\n`;
      mimeBody += Buffer.from(html).toString('base64') + `\r\n`;
    }

    mimeBody += `--${innerBoundary}--\r\n`;

    // Anexos
    for (const att of attachments) {
      const content = att.content || Buffer.from(att.data, 'base64');
      mimeBody += `--${boundary}\r\n`;
      mimeBody += `Content-Type: ${att.mimeType || 'application/octet-stream'}; name="${att.filename}"\r\n`;
      mimeBody += `Content-Disposition: attachment; filename="${att.filename}"\r\n`;
      mimeBody += `Content-Transfer-Encoding: base64\r\n`;
      mimeBody += `\r\n`;
      mimeBody += content.toString('base64') + `\r\n`;
    }

    mimeBody += `--${boundary}--\r\n`;

    const encoded = Buffer.from(mimeBody)
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');

    const res = await gmail.users.messages.send({
      userId: 'me',
      requestBody: {
        raw: encoded,
        threadId: threadId || undefined,
      },
    });

    return { success: true, messageId: res.data.id, threadId: res.data.threadId };
  }

  // ═════════════════════════════════════════════════════════════════
  // RASCUNHOS
  // ═════════════════════════════════════════════════════════════════

  async createDraft({ to, subject, text, html, cc, bcc }) {
    const gmail = await gmailOAuth.getGmailClient();

    const boundary = `NEXO_DRAFT_${Date.now()}`;
    let mimeBody = '';

    mimeBody += `To: ${to}\r\n`;
    if (cc) mimeBody += `Cc: ${cc}\r\n`;
    mimeBody += `Subject: ${subject}\r\n`;
    mimeBody += `MIME-Version: 1.0\r\n`;
    mimeBody += `Content-Type: multipart/alternative; boundary="${boundary}"\r\n`;
    mimeBody += `\r\n`;

    if (text) {
      mimeBody += `--${boundary}\r\n`;
      mimeBody += `Content-Type: text/plain; charset=UTF-8\r\n\r\n`;
      mimeBody += text + `\r\n`;
    }

    if (html) {
      mimeBody += `--${boundary}\r\n`;
      mimeBody += `Content-Type: text/html; charset=UTF-8\r\n\r\n`;
      mimeBody += html + `\r\n`;
    }

    mimeBody += `--${boundary}--\r\n`;

    const encoded = Buffer.from(mimeBody)
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');

    const res = await gmail.users.drafts.create({
      userId: 'me',
      requestBody: {
        message: { raw: encoded },
      },
    });

    return { success: true, draftId: res.data.id, messageId: res.data.message?.id };
  }

  // ═════════════════════════════════════════════════════════════════
  // LABELS
  // ═════════════════════════════════════════════════════════════════

  async listLabels() {
    const gmail = await gmailOAuth.getGmailClient();
    const res = await gmail.users.labels.list({ userId: 'me' });
    return res.data.labels || [];
  }

  // ═════════════════════════════════════════════════════════════════
  // SINCRONIZAÇÃO INCREMENTAL (history.list)
  // ═════════════════════════════════════════════════════════════════

  async sync(historyId) {
    const gmail = await gmailOAuth.getGmailClient();

    const res = await gmail.users.history.list({
      userId: 'me',
      startHistoryId: historyId,
      historyTypes: ['messageAdded', 'messageDeleted', 'labelAdded', 'labelRemoved'],
      maxResults: 100,
    });

    return {
      history: res.data.history || [],
      nextPageToken: res.data.nextPageToken,
      historyId: res.data.historyId,
    };
  }

  async getProfile() {
    const gmail = await gmailOAuth.getGmailClient();
    const res = await gmail.users.getProfile({ userId: 'me' });
    return res.data;
  }

  // ═════════════════════════════════════════════════════════════════
  // PARSING DE MENSAGENS
  // ═════════════════════════════════════════════════════════════════

  parseMessage(data) {
    const headers = this.parseHeaders(data.payload?.headers || []);

    const parts = this.flattenParts(data.payload);
    const body = this.extractBody(parts);
    const attachments = this.extractAttachments(parts);

    return {
      id: data.id,
      threadId: data.threadId,
      labelIds: data.labelIds || [],
      snippet: data.snippet || '',
      historyId: data.historyId,
      internalDate: data.internalDate,
      isUnread: (data.labelIds || []).includes('UNREAD'),
      isStarred: (data.labelIds || []).includes('STARRED'),
      isImportant: (data.labelIds || []).includes('IMPORTANT'),
      isDraft: (data.labelIds || []).includes('DRAFT'),
      isSpam: (data.labelIds || []).includes('SPAM'),
      isTrash: (data.labelIds || []).includes('TRASH'),
      from: headers.from,
      to: headers.to,
      cc: headers.cc,
      bcc: headers.bcc,
      subject: headers.subject || '(sem assunto)',
      date: headers.date,
      replyTo: headers['reply-to'],
      messageId: headers['message-id'],
      references: headers.references,
      body: body,
      attachments: attachments,
      sizeEstimate: data.sizeEstimate,
    };
  }

  parseHeaders(headers) {
    const result = {};
    for (const h of headers) {
      const key = h.name.toLowerCase();
      result[key] = h.value;
    }
    return result;
  }

  flattenParts(payload) {
    const parts = [];
    const traverse = (part) => {
      if (!part) return;
      parts.push(part);
      if (part.parts) {
        for (const child of part.parts) traverse(child);
      }
    };
    traverse(payload);
    return parts;
  }

  extractBody(parts) {
    // Prefer HTML, fallback to text
    let html = '';
    let text = '';

    for (const part of parts) {
      const mime = part.mimeType || '';
      const data = part.body?.data;
      if (!data) continue;

      const decoded = Buffer.from(data, 'base64').toString('utf8');

      if (mime === 'text/html') html = decoded;
      else if (mime === 'text/plain') text = decoded;
    }

    return { html, text };
  }

  extractAttachments(parts) {
    return parts
      .filter((p) => p.body?.attachmentId)
      .map((p) => ({
        filename: p.filename || 'anexo',
        mimeType: p.mimeType || 'application/octet-stream',
        size: p.body?.size || 0,
        attachmentId: p.body.attachmentId,
      }));
  }

  /**
   * Baixa o conteúdo de um anexo
   */
  async getAttachment(messageId, attachmentId) {
    const gmail = await gmailOAuth.getGmailClient();
    const res = await gmail.users.messages.attachments.get({
      userId: 'me',
      messageId,
      id: attachmentId,
    });
    return res.data;
  }
}

module.exports = new GmailAPIService();
