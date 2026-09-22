import { describe, expect, it } from 'vitest';
import { sanitizeOutboundText } from './outbound-text.js';

describe('sanitizeOutboundText (bug: markdown cru chegando "esquisito" no WhatsApp)', () => {
  it('remove **negrito** e __negrito__', () => {
    expect(sanitizeOutboundText('**Time mapeado:** __Jhin__')).toBe('Time mapeado: Jhin');
  });

  it('converte listas markdown em bullets legíveis', () => {
    const md = '- **Jhin** → você\n1. **Slider** — vídeo\n- item';
    expect(sanitizeOutboundText(md)).toBe('• Jhin → você\n• Slider — vídeo\n• item');
  });

  it('remove cercas de código mas mantém o conteúdo', () => {
    expect(sanitizeOutboundText('Rode:\n```bash\npnpm test\n```')).toBe('Rode:\npnpm test');
    expect(sanitizeOutboundText('use `sanitizeOutboundText` aqui')).toBe('use sanitizeOutboundText aqui');
  });

  it('remove # de títulos', () => {
    expect(sanitizeOutboundText('## Resumo\nTexto')).toBe('Resumo\nTexto');
  });

  it('links markdown viram texto (url) — nunca some a URL', () => {
    expect(sanitizeOutboundText('[site](https://onadance.com)')).toBe('site (https://onadance.com)');
  });

  it('não quebra multiplicação ou asterisco solto', () => {
    expect(sanitizeOutboundText('2*3 = 6 e 5*4 = 20')).toBe('2*3 = 6 e 5*4 = 20');
  });

  it('mensagem real do incidente fica legível', () => {
    const real = '🗺️ **Team mapeado:**\n- **Jhin** → você, este número ✅\n\n📋 **Pendências:**\n1. **Slider** — vídeo';
    const out = sanitizeOutboundText(real);
    expect(out).not.toContain('**');
    expect(out).toContain('• Jhin → você, este número ✅');
    expect(out).toContain('• Slider — vídeo');
  });
});
