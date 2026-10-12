/**
 * Serviço de enriquecimento de links (OGP + thumbnail)
 * NEXO Dashboard Pro v16.1
 * Simples, com cache em memória (não requer Redis)
 */

const cheerio = require('cheerio');
const { classifyUrl, extractDomainInfo } = require('./url-classifier');

const PREVIEW_CACHE = new Map();
const PREVIEW_TTL = 24 * 60 * 60 * 1000; // 24 horas
const MAX_CACHE_SIZE = 500;

async function fetchLinkPreview(url) {
  const cached = PREVIEW_CACHE.get(url);
  if (cached && Date.now() - cached.cachedAt < PREVIEW_TTL) {
    return cached.data;
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);

    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Language': 'pt-BR,pt;q=0.9,en;q=0.8'
      },
      redirect: 'follow'
    });

    clearTimeout(timeout);

    const isError = !response.ok || response.status >= 400;
    const finalUrl = response.url || url;
    const domainInfo = extractDomainInfo(url);

    if (isError) {
      const preview = {
        url: finalUrl,
        originalUrl: url,
        title: `${response.status} — ${response.statusText}`,
        description: 'Link indisponível ou removido',
        image: null,
        favicon: `https://www.google.com/s2/favicons?domain=${domainInfo?.domain || url}&sz=64`,
        siteName: domainInfo?.domain || url,
        type: 'website',
        status: response.status,
        isError: true,
        isBroken: response.status === 404,
        fetchedAt: new Date().toISOString()
      };
      cachePreview(url, preview);
      return preview;
    }

    const html = await response.text();
    const $ = cheerio.load(html);

    const getMeta = (property) => {
      return $(`meta[property="${property}"]`).attr('content') ||
             $(`meta[name="${property}"]`).attr('content') || null;
    };

    const title = getMeta('og:title') || $('title').text() || domainInfo?.domain || url;
    const description = getMeta('og:description') || getMeta('description') || '';
    const image = getMeta('og:image') || getMeta('og:image:secure_url') || getMeta('twitter:image') || null;
    const siteName = getMeta('og:site_name') || domainInfo?.domain || '';
    const type = getMeta('og:type') || 'website';

    const preview = {
      url: finalUrl,
      originalUrl: url,
      title: title.trim().substring(0, 200),
      description: description.trim().substring(0, 500),
      image: image,
      favicon: `https://www.google.com/s2/favicons?domain=${domainInfo?.domain || url}&sz=64`,
      siteName: siteName.trim(),
      type,
      status: response.status,
      isError: false,
      isBroken: false,
      fetchedAt: new Date().toISOString()
    };

    cachePreview(url, preview);
    return preview;

  } catch (error) {
    const domainInfo = extractDomainInfo(url);
    const preview = {
      url,
      originalUrl: url,
      title: domainInfo?.domain || url,
      description: 'Não foi possível carregar preview',
      image: null,
      favicon: `https://www.google.com/s2/favicons?domain=${domainInfo?.domain || url}&sz=64`,
      siteName: domainInfo?.domain || '',
      type: 'website',
      status: 0,
      isError: true,
      isBroken: false,
      error: error.message,
      fetchedAt: new Date().toISOString()
    };
    cachePreview(url, preview);
    return preview;
  }
}

function cachePreview(url, data) {
  if (PREVIEW_CACHE.size >= MAX_CACHE_SIZE) {
    const firstKey = PREVIEW_CACHE.keys().next().value;
    PREVIEW_CACHE.delete(firstKey);
  }
  PREVIEW_CACHE.set(url, { data, cachedAt: Date.now() });
}

function getCachedPreview(url) {
  const cached = PREVIEW_CACHE.get(url);
  if (cached && Date.now() - cached.cachedAt < PREVIEW_TTL) {
    return cached.data;
  }
  return null;
}

module.exports = { fetchLinkPreview, getCachedPreview, classifyUrl, extractDomainInfo };
