export function formatTime(date) {
  if (!date) return '';
  const d = new Date(date);
  const now = new Date();
  const diffMs = now - d;
  const diffSec = Math.floor(diffMs / 1000);
  const diffMin = Math.floor(diffSec / 60);
  const diffHour = Math.floor(diffMin / 60);
  const diffDay = Math.floor(diffHour / 24);

  if (diffSec < 10) return 'agora';
  if (diffSec < 60) return `${diffSec}s atrás`;
  if (diffMin < 60) return `${diffMin} min atrás`;
  if (diffHour < 24) return `${diffHour}h atrás`;
  if (diffDay === 1) return 'ontem';
  if (diffDay < 7) return `${diffDay} dias`;
  if (diffDay < 30) return `${Math.floor(diffDay / 7)} sem`;
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
}

export function formatDuration(seconds) {
  if (!seconds || seconds < 0) return '0.0s';
  if (seconds < 60) return `${seconds.toFixed(1)}s`;
  const mins = Math.floor(seconds / 60);
  const secs = (seconds % 60).toFixed(0);
  return `${mins}m ${secs}s`;
}

export function debounce(fn, ms) {
  let timer;
  return function (...args) {
    clearTimeout(timer);
    timer = setTimeout(() => fn.apply(this, args), ms);
  };
}

export const scrollManager = {
  isNearBottom(element, threshold = 100) {
    if (!element) return true;
    const { scrollTop, scrollHeight, clientHeight } = element;
    return scrollHeight - scrollTop - clientHeight < threshold;
  },
  scrollToBottom(element, behavior = 'smooth') {
    if (!element) return;
    element.scrollTo({ top: element.scrollHeight, behavior });
  },
  getScrollPosition(element) {
    return element?.scrollTop || 0;
  }
};

export function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

export function downloadFile(content, filename, mimeType = 'text/plain') {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export function parseEnvFile(content) {
  const config = {};
  const lines = content.split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIndex = trimmed.indexOf('=');
    if (eqIndex === -1) continue;
    const key = trimmed.slice(0, eqIndex).trim();
    let value = trimmed.slice(eqIndex + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    config[key] = value;
  }
  return config;
}

export function generateEnvFile(config) {
  return Object.entries(config)
    .map(([key, value]) => {
      const needsQuotes = String(value).includes(' ') || String(value).includes('#');
      return `${key}=${needsQuotes ? `"${value}"` : value}`;
    })
    .join('\n');
}
