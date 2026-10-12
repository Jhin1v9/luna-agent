/**
 * NEXO Mail — Gmail OAuth2 Service
 * Fluxo de autenticação, refresh token e armazenamento seguro
 */

const { google } = require('googleapis');
const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');
const TOKEN_PATH = path.join(DATA_DIR, 'gmail-tokens.json');

// Scopes necessários para operação completa do email
const SCOPES = [
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/gmail.modify',
  'https://www.googleapis.com/auth/gmail.send',
  'https://www.googleapis.com/auth/gmail.labels',
  'https://www.googleapis.com/auth/userinfo.email',
  'https://www.googleapis.com/auth/userinfo.profile',
];

class GmailOAuthService {
  constructor() {
    this.clientId = process.env.GMAIL_CLIENT_ID;
    this.clientSecret = process.env.GMAIL_CLIENT_SECRET;
    this.redirectUri = process.env.GMAIL_REDIRECT_URI || 'http://localhost:3457/email/oauth/callback';

    if (!this.clientId || !this.clientSecret) {
      console.error('[GmailOAuth] ⚠️ GMAIL_CLIENT_ID ou GMAIL_CLIENT_SECRET não configurados');
    }

    this.oauth2Client = new google.auth.OAuth2(
      this.clientId,
      this.clientSecret,
      this.redirectUri
    );

    // Carregar tokens salvos se existirem
    this.loadTokens();
  }

  /**
   * Gera a URL de autorização para o usuário clicar
   */
  getAuthUrl() {
    if (!this.clientId || !this.clientSecret) {
      throw new Error('Credenciais OAuth2 não configuradas. Verifique GMAIL_CLIENT_ID e GMAIL_CLIENT_SECRET no .env');
    }

    return this.oauth2Client.generateAuthUrl({
      access_type: 'offline',
      scope: SCOPES,
      prompt: 'consent', // Força o refresh_token mesmo se já autorizado antes
      include_granted_scopes: true,
    });
  }

  /**
   * Troca o código de autorização por tokens de acesso
   */
  async exchangeCode(code) {
    try {
      const { tokens } = await this.oauth2Client.getToken(code);
      this.oauth2Client.setCredentials(tokens);
      await this.saveTokens(tokens);

      // Buscar dados do perfil
      const oauth2 = google.oauth2({ auth: this.oauth2Client, version: 'v2' });
      const profile = await oauth2.userinfo.get();

      return {
        success: true,
        email: profile.data.email,
        name: profile.data.name,
        picture: profile.data.picture,
        connected: true,
      };
    } catch (error) {
      console.error('[GmailOAuth] ❌ Erro ao trocar código:', error.message);
      console.error('[GmailOAuth]   → response:', error.response?.data);
      console.error('[GmailOAuth]   → clientId presente:', !!this.clientId);
      console.error('[GmailOAuth]   → clientSecret presente:', !!this.clientSecret);
      console.error('[GmailOAuth]   → redirectUri:', this.redirectUri);
      return { success: false, error: error.message, details: error.response?.data };
    }
  }

  /**
   * Revoga o acesso do usuário
   */
  async revokeAccess() {
    try {
      const tokens = this.getTokens();
      if (tokens && tokens.access_token) {
        await this.oauth2Client.revokeToken(tokens.access_token);
      }
      this.clearTokens();
      return { success: true, message: 'Acesso revogado com sucesso' };
    } catch (error) {
      console.error('[GmailOAuth] ❌ Erro ao revogar:', error.message);
      // Mesmo com erro, limpar tokens locais
      this.clearTokens();
      return { success: true, message: 'Tokens locais removidos' };
    }
  }

  /**
   * Retorna o estado atual da conexão
   */
  getStatus() {
    const tokens = this.getTokens();
    if (!tokens || !tokens.access_token) {
      return { connected: false };
    }

    const isExpired = tokens.expiry_date && Date.now() > tokens.expiry_date;
    return {
      connected: true,
      email: tokens.email || null,
      name: tokens.name || null,
      picture: tokens.picture || null,
      expiryDate: tokens.expiry_date || null,
      isExpired,
    };
  }

  /**
   * Retorna o cliente OAuth2 autenticado (com refresh automático)
   */
  async getAuthenticatedClient() {
    const tokens = this.getTokens();
    if (!tokens || !tokens.access_token) {
      throw new Error('Usuário não autenticado. Faça login em /api/email/auth/url');
    }

    this.oauth2Client.setCredentials(tokens);

    // Se o token estiver expirado, tenta refresh automaticamente
    if (tokens.expiry_date && Date.now() > tokens.expiry_date) {
      try {
        const { credentials } = await this.oauth2Client.refreshAccessToken();
        await this.saveTokens(credentials);
        this.oauth2Client.setCredentials(credentials);
      } catch (error) {
        console.error('[GmailOAuth] ❌ Falha ao refresh token:', error.message);
        throw new Error('Sessão expirada. Faça login novamente.');
      }
    }

    return this.oauth2Client;
  }

  /**
   * Retorna o cliente Gmail API autenticado
   */
  async getGmailClient() {
    const auth = await this.getAuthenticatedClient();
    return google.gmail({ version: 'v1', auth });
  }

  // ── Persistência de tokens ──

  loadTokens() {
    try {
      if (fs.existsSync(TOKEN_PATH)) {
        const data = JSON.parse(fs.readFileSync(TOKEN_PATH, 'utf8'));
        this.oauth2Client.setCredentials(data);
      }
    } catch (error) {
      console.error('[GmailOAuth] ⚠️ Erro ao carregar tokens:', error.message);
    }
  }

  async saveTokens(tokens) {
    try {
      if (!fs.existsSync(DATA_DIR)) {
        fs.mkdirSync(DATA_DIR, { recursive: true });
      }
      fs.writeFileSync(TOKEN_PATH, JSON.stringify(tokens, null, 2));
    } catch (error) {
      console.error('[GmailOAuth] ❌ Erro ao salvar tokens:', error.message);
    }
  }

  getTokens() {
    try {
      if (fs.existsSync(TOKEN_PATH)) {
        return JSON.parse(fs.readFileSync(TOKEN_PATH, 'utf8'));
      }
    } catch (error) {
      console.error('[GmailOAuth] ⚠️ Erro ao ler tokens:', error.message);
    }
    return null;
  }

  clearTokens() {
    try {
      if (fs.existsSync(TOKEN_PATH)) {
        fs.unlinkSync(TOKEN_PATH);
      }
      this.oauth2Client.setCredentials({});
    } catch (error) {
      console.error('[GmailOAuth] ❌ Erro ao limpar tokens:', error.message);
    }
  }
}

module.exports = new GmailOAuthService();
