// ============================================================
// EMOTIONAL MEMORY v18.0 — A Luna "Lembra" Como Se Sentiu
// Ajusta tom baseado em interações recentes.
// ============================================================

const fs = require('fs');
const path = require('path');

const MEMORY_FILE = path.join(__dirname, '../../dashboard/data/luna-emotional-memory.json');

class EmotionalMemory {
  constructor() {
    this.interactions = []; // últimas 50
    this.moodTrend = 'stable'; // 'up', 'down', 'stable'
    this._load();
  }

  _load() {
    try {
      const data = JSON.parse(fs.readFileSync(MEMORY_FILE, 'utf8'));
      this.interactions = data.interactions || [];
      this.moodTrend = data.moodTrend || 'stable';
    } catch {
      this.interactions = [];
      this.moodTrend = 'stable';
    }
  }

  _save() {
    try {
      fs.writeFileSync(MEMORY_FILE, JSON.stringify({
        interactions: this.interactions.slice(-50),
        moodTrend: this.moodTrend,
        updatedAt: new Date().toISOString()
      }, null, 2), 'utf8');
    } catch (e) {
      console.error('[EmotionalMemory] Falha ao salvar:', e.message);
    }
  }

  recordInteraction(type, sentiment = 'neutral', author = 'unknown') {
    this.interactions.push({ type, sentiment, author, time: Date.now() });
    if (this.interactions.length > 50) this.interactions.shift();
    this._updateMoodTrend();
    this._save();
  }

  _updateMoodTrend() {
    const recent = this.interactions.slice(-10);
    const negative = recent.filter(i => i.sentiment === 'negative').length;
    const positive = recent.filter(i => i.sentiment === 'positive').length;
    if (positive > negative + 2) this.moodTrend = 'up';
    else if (negative > positive + 2) this.moodTrend = 'down';
    else this.moodTrend = 'stable';
  }

  /**
   * Retorna contexto emocional para ajustar a resposta
   */
  getContextForResponse() {
    const recent = this.interactions.slice(-10);
    const corrections = recent.filter(i => i.type === 'correction').length;
    const failures = recent.filter(i => i.type === 'llm_failure').length;
    const negativeSentiment = recent.filter(i => i.sentiment === 'negative').length;

    if (failures >= 3) {
      return {
        toneModifier: 'humble',
        note: 'admitir problema técnico com humor',
        personalityHint: 'exhausted'
      };
    }

    if (corrections >= 2) {
      return {
        toneModifier: 'cautious',
        note: 'ser mais cuidadosa, confirmar antes',
        personalityHint: null
      };
    }

    if (negativeSentiment >= 3) {
      return {
        toneModifier: 'supportive',
        note: 'ser empática, oferecer ajuda',
        personalityHint: 'empathetic'
      };
    }

    if (this.moodTrend === 'up') {
      return {
        toneModifier: 'confident',
        note: 'tom mais leve e confiante',
        personalityHint: 'playful'
      };
    }

    return {
      toneModifier: 'normal',
      note: null,
      personalityHint: null
    };
  }

  /**
   * Retorna sumário emocional para logs/debug
   */
  getSummary() {
    const recent = this.interactions.slice(-10);
    return {
      totalInteractions: this.interactions.length,
      recentCount: recent.length,
      moodTrend: this.moodTrend,
      corrections: recent.filter(i => i.type === 'correction').length,
      failures: recent.filter(i => i.type === 'llm_failure').length,
      lastUpdate: this.interactions[this.interactions.length - 1]?.time || null
    };
  }
}

module.exports = { EmotionalMemory };
