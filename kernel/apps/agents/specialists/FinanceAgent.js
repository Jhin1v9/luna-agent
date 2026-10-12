// ============================================================
// FINANCE AGENT v18.0 — Especialista em Números
// Sabe tudo sobre pagamentos, orçamentos, cash flow, e dívidas.
// ============================================================

class FinanceAgent {
  constructor(dataAPI, knowledgeGraph) {
    this.dataAPI = dataAPI;
    this.kg = knowledgeGraph;
    this.name = 'Financeiro';
  }

  async answer(question, context = {}) {
    const q = question.toLowerCase();

    // Quanto entrou/saiu este mês?
    if (/quanto (entrou|saiu|recebemos|pagamos|faturamos)|cash flow|balanço/i.test(q)) {
      return this.getCashFlowSummary();
    }

    // Status de pagamento de um cliente
    if (/pagou|pagamento|fatura|status (de )?pagamento/i.test(q)) {
      const client = this._extractClientFromQuestion(q);
      if (client) return this.getClientPaymentStatus(client);
      return this.getPendingPaymentsSummary();
    }

    // Orçamentos
    if (/orçamento|presupuesto|quote|proposta/i.test(q)) {
      return this.getQuotesSummary();
    }

    // Gastos
    if (/gasto|despesa|expense|custo/i.test(q)) {
      return this.getExpensesSummary();
    }

    // Resumo financeiro geral
    return this.getFinancialOverview();
  }

  getCashFlowSummary() {
    const now = new Date();
    const cashBox = this.dataAPI.getCashBox();
    const income = cashBox.monthlyIncome?.value || 0;
    const expense = cashBox.monthlyExpenses?.value || 0;
    const balance = cashBox.balance?.value || 0;
    const history = cashBox.history || [];

    return {
      text: `💰 *Resumo Financeiro — ${now.toLocaleString('pt-BR', { month: 'long' })}*\n\n` +
            `📥 Entradas: €${income.toFixed(2)}\n` +
            `📤 Saídas: €${expense.toFixed(2)}\n` +
            `💵 Saldo: €${balance.toFixed(2)}\n` +
            `📊 Histórico: ${history.length} transações\n\n` +
            `${history.length > 0 ? 'Últimas movimentações:\n' + history.slice(-3).map(h => `• ${h.description || h.type}: €${(h.amount || 0).toFixed(2)}`).join('\n') : ''}`,
      data: { income, expense, balance, history }
    };
  }

  getClientPaymentStatus(clientName) {
    const client = this.dataAPI.getClientStatus(clientName);
    if (!client) {
      return { text: `❓ Não encontro o cliente "${clientName}" no registro.`, data: null };
    }

    const paid = client.financial.totalPaid;
    const pending = client.financial.totalPending;
    const status = pending > 0 ? '⏳ Pendente' : '✅ Em dia';

    return {
      text: `💰 *${client.client.company || client.client.name}*\n\n` +
            `Status: ${status}\n` +
            `Pago: €${paid.toFixed(2)}\n` +
            `Pendente: €${pending.toFixed(2)}\n\n` +
            `${pending > 0 ? '⚠️ Há valores pendentes. Quer que eu prepare um lembrete?' : '✅ Tudo em dia!'}`,
      data: client.financial
    };
  }

  getPendingPaymentsSummary() {
    const cashBox = this.dataAPI.getCashBox();
    const pending = (cashBox.transactions || []).filter(t => t.status === 'pendente' || t.status === 'pending');

    if (pending.length === 0) {
      return { text: '✅ Nenhum pagamento pendente no momento.', data: [] };
    }

    const total = pending.reduce((s, t) => s + Math.abs(t.amount || 0), 0);
    const list = pending.slice(0, 5).map(t =>
      `• ${t.description?.slice(0, 40) || 'Pagamento'}: €${Math.abs(t.amount || 0).toFixed(2)}`
    ).join('\n');

    return {
      text: `⏳ *Pagamentos Pendentes* (${pending.length})\n\n` +
            `${list}\n` +
            `${pending.length > 5 ? `...e mais ${pending.length - 5}` : ''}\n\n` +
            `Total pendente: €${total.toFixed(2)}`,
      data: pending
    };
  }

  getQuotesSummary() {
    const quotes = this.dataAPI.getQuotes();
    const all = quotes.quotes || [];

    if (all.length === 0) {
      return { text: '📄 Nenhum orçamento no registro.', data: [] };
    }

    const approved = all.filter(q => q.status === 'approved' || q.status === 'aprovado');
    const pending = all.filter(q => q.status === 'pending' || q.status === 'pendente');
    const total = all.reduce((s, q) => s + (q.total || 0), 0);

    return {
      text: `📄 *Orçamentos*\n\n` +
            `Total: ${all.length}\n` +
            `Aprovados: ${approved.length}\n` +
            `Pendentes: ${pending.length}\n` +
            `Valor total: €${total.toFixed(2)}`,
      data: { all, approved, pending, total }
    };
  }

  getExpensesSummary() {
    const expenses = this.dataAPI.getExpenses();
    const all = Array.isArray(expenses) ? expenses : (expenses.expenses || []);

    if (all.length === 0) {
      return { text: '💸 Nenhuma despesa registrada.', data: [] };
    }

    const total = all.reduce((s, e) => s + Math.abs(e.amount || e.value || 0), 0);

    return {
      text: `💸 *Despesas*\n\n` +
            `Total: ${all.length} despesas\n` +
            `Valor total: €${total.toFixed(2)}`,
      data: { total, count: all.length }
    };
  }

  getFinancialOverview() {
    const cashBox = this.dataAPI.getCashBox();
    const balance = cashBox.balance?.value || 0;
    const income = cashBox.monthlyIncome?.value || 0;
    const expense = cashBox.monthlyExpenses?.value || 0;
    const history = cashBox.history || [];
    const quotes = this.dataAPI.getQuotes();
    const allQuotes = quotes.quotes || [];

    return {
      text: `💰 *Panorama Financeiro NEXO*\n\n` +
            `💵 Saldo atual: €${balance.toFixed(2)}\n` +
            `📥 Receita mensal: €${income.toFixed(2)}\n` +
            `📤 Despesas mensais: €${expense.toFixed(2)}\n` +
            `📄 Orçamentos: ${allQuotes.length}\n` +
            `📊 Movimentações: ${history.length}\n\n` +
            `_Quer detalhes de algum cliente ou período específico?_)`,
      data: { balance, income, expense, history, quotes: allQuotes }
    };
  }

  _extractClientFromQuestion(q) {
    const registry = this.dataAPI.getClientsRegistry();
    for (const [id, client] of Object.entries(registry.clients || {})) {
      if (q.includes(client.name?.toLowerCase()) || q.includes(client.company?.toLowerCase())) {
        return client.name || client.company;
      }
    }
    return null;
  }
}

module.exports = { FinanceAgent };
