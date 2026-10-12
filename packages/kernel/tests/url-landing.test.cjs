/**
 * Teste para normalização de comparação de URLs de landing page.
 * Reproduz o bug que faz newChat falhar quando o Kimi Web adiciona
 * trailing slash ou reordena query params na URL de landing.
 */

function normalizeBaseUrl(url) {
  try {
    const u = new URL(url);
    // Remover trailing slash do pathname, exceto root
    if (u.pathname.length > 1 && u.pathname.endsWith('/')) {
      u.pathname = u.pathname.slice(0, -1);
    }
    // Ignorar query e hash para comparar apenas origin+pathname
    u.search = '';
    u.hash = '';
    return u.toString();
  } catch (e) {
    return url;
  }
}

function isNewChatLanding(currentUrl, expectedUrl) {
  return normalizeBaseUrl(currentUrl) === normalizeBaseUrl(expectedUrl);
}

const cases = [
  {
    name: 'trailing slash no currentUrl',
    current: 'https://www.kimi.ai/?chat_enter_method=new_chat',
    expected: 'https://www.kimi.ai',
    want: true,
  },
  {
    name: 'lang extra no expected',
    current: 'https://www.kimi.ai/?chat_enter_method=new_chat',
    expected: 'https://www.kimi.ai/?chat_enter_method=new_chat&lang=en',
    want: true, // query params sao ignorados na comparacao de landing page
  },
  {
    name: 'query params reordenados',
    current: 'https://www.kimi.ai/?b=2&a=1',
    expected: 'https://www.kimi.ai/?a=1&b=2',
    want: true,
  },
  {
    name: 'hash ignorado',
    current: 'https://www.kimi.ai/?chat_enter_method=new_chat#section',
    expected: 'https://www.kimi.ai/?chat_enter_method=new_chat',
    want: true,
  },
  {
    name: 'chat real nao e landing',
    current: 'https://www.kimi.ai/chat/cn1l9vlaq9s6m01oe6m0',
    expected: 'https://www.kimi.ai',
    want: false,
  },
];

let failed = 0;
for (const c of cases) {
  const got = isNewChatLanding(c.current, c.expected);
  const ok = got === c.want;
  if (!ok) failed++;
  console.log(`${ok ? '✅' : '❌'} ${c.name}: got=${got} want=${c.want}`);
}

if (failed > 0) {
  console.error(`\n${failed} teste(s) falharam.`);
  process.exit(1);
}
console.log('\n✅ Todos os testes passaram.');
