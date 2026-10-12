/**
 * Script utilitário para descobrir o chat_id do grupo do Telegram
 * 
 * Uso:
 * 1. Pare o bot do Telegram temporariamente (ou rode este script rapidamente)
 * 2. Envie uma mensagem no grupo/conversa onde quer receber notificações
 * 3. Rode: node scripts/discover-telegram-chat-id.js
 * 4. O script vai mostrar o chat.id
 * 5. Adicione ao .env: TELEGRAM_NOTIFICATION_CHAT_ID=<valor>
 */

require('dotenv').config();

const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
if (!TOKEN) {
  console.error('❌ TELEGRAM_BOT_TOKEN não configurado no .env');
  process.exit(1);
}

async function discover() {
  try {
    const res = await fetch(`https://api.telegram.org/bot${TOKEN}/getUpdates?limit=10`);
    const data = await res.json();
    
    if (!data.ok || !data.result.length) {
      console.log('⚠️ Nenhuma mensagem recente encontrada.');
      console.log('   Envie uma mensagem no grupo e rode novamente.');
      return;
    }
    
    console.log('\n📨 Mensagens recentes encontradas:\n');
    
    const seen = new Set();
    for (const update of data.result) {
      const msg = update.message || update.edited_message;
      if (!msg) continue;
      
      const chatId = msg.chat.id;
      const chatTitle = msg.chat.title || msg.chat.first_name || 'Privado';
      const chatType = msg.chat.type;
      const from = msg.from?.username || msg.from?.first_name || 'Desconhecido';
      const text = msg.text || '(mídia)';
      
      const key = `${chatId}-${chatTitle}`;
      if (seen.has(key)) continue;
      seen.add(key);
      
      console.log(`  🆔 chat_id: ${chatId}`);
      console.log(`     Título:  ${chatTitle}`);
      console.log(`     Tipo:    ${chatType}`);
      console.log(`     Última:  "${text.substring(0, 40)}" por ${from}`);
      console.log('');
    }
    
    console.log('👉 Adicione ao .env:');
    console.log(`   TELEGRAM_NOTIFICATION_CHAT_ID=${Array.from(seen).map(k => k.split('-')[0]).join(' ou ')}`);
    
  } catch (e) {
    console.error('❌ Erro:', e.message);
  }
}

discover();
