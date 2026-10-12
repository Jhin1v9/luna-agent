/**
 * Serviço de classificação de URL por plataforma
 * NEXO Dashboard Pro v16.1
 */

const PLATFORM_PATTERNS = {
  instagram: {
    patterns: [/instagram\.com/i, /instagr\.am/i, /ig\.me/i],
    icon: 'Instagram',
    color: '#E4405F',
    category: 'social',
    label: '📱 Instagram'
  },
  tiktok: {
    patterns: [/tiktok\.com/i, /vm\.tiktok\.com/i, /vt\.tiktok\.com/i],
    icon: 'Music',
    color: '#000000',
    category: 'social',
    label: '🎵 TikTok'
  },
  youtube: {
    patterns: [/youtube\.com/i, /youtu\.be/i, /youtube-nocookie\.com/i],
    icon: 'Youtube',
    color: '#FF0000',
    category: 'video',
    label: '📺 YouTube'
  },
  github: {
    patterns: [/github\.com/i, /github\.io/i, /raw\.githubusercontent\.com/i],
    icon: 'Github',
    color: '#181717',
    category: 'dev',
    label: '🐙 GitHub'
  },
  linkedin: {
    patterns: [/linkedin\.com/i, /lnkd\.in/i],
    icon: 'Linkedin',
    color: '#0A66C2',
    category: 'professional',
    label: '💼 LinkedIn'
  },
  twitter: {
    patterns: [/twitter\.com/i, /x\.com/i, /t\.co/i],
    icon: 'Twitter',
    color: '#000000',
    category: 'social',
    label: '🐦 Twitter/X'
  },
  whatsapp: {
    patterns: [/wa\.me/i, /whatsapp\.com/i],
    icon: 'MessageCircle',
    color: '#25D366',
    category: 'chat',
    label: '💬 WhatsApp'
  },
  notion: {
    patterns: [/notion\.so/i, /notion\.site/i],
    icon: 'FileText',
    color: '#000000',
    category: 'productivity',
    label: '📝 Notion'
  },
  figma: {
    patterns: [/figma\.com/i],
    icon: 'Figma',
    color: '#F24E1E',
    category: 'design',
    label: '🎨 Figma'
  },
  vercel: {
    patterns: [/vercel\.com/i, /vercel\.app/i, /now\.sh/i],
    icon: 'Triangle',
    color: '#000000',
    category: 'dev',
    label: '▲ Vercel'
  },
  google: {
    patterns: [/google\.com/i, /docs\.google\.com/i, /drive\.google\.com/i, /sheets\.google\.com/i],
    icon: 'Chrome',
    color: '#4285F4',
    category: 'productivity',
    label: '🔍 Google'
  },
  spotify: {
    patterns: [/spotify\.com/i, /open\.spotify\.com/i],
    icon: 'Music',
    color: '#1DB954',
    category: 'entertainment',
    label: '🎧 Spotify'
  },
  medium: {
    patterns: [/medium\.com/i],
    icon: 'BookOpen',
    color: '#000000',
    category: 'content',
    label: '📖 Medium'
  },
  reddit: {
    patterns: [/reddit\.com/i, /redd\.it/i],
    icon: 'MessageSquare',
    color: '#FF4500',
    category: 'social',
    label: '👽 Reddit'
  },
  default: {
    icon: 'Globe',
    color: '#6B7280',
    category: 'site',
    label: '🌐 Site'
  }
};

function classifyUrl(url) {
  try {
    const hostname = new URL(url).hostname.toLowerCase();

    for (const [platform, config] of Object.entries(PLATFORM_PATTERNS)) {
      if (platform === 'default') continue;
      for (const pattern of config.patterns) {
        if (pattern.test(hostname)) {
          return {
            platform,
            ...config,
            hostname
          };
        }
      }
    }

    return {
      platform: 'site',
      ...PLATFORM_PATTERNS.default,
      hostname
    };
  } catch (e) {
    return {
      platform: 'unknown',
      icon: 'HelpCircle',
      color: '#9CA3AF',
      category: 'unknown',
      label: '❓ Desconhecido',
      hostname: url
    };
  }
}

function extractDomainInfo(url) {
  try {
    const urlObj = new URL(url);
    return {
      hostname: urlObj.hostname,
      pathname: urlObj.pathname,
      search: urlObj.search,
      protocol: urlObj.protocol,
      isSecure: urlObj.protocol === 'https:',
      domain: urlObj.hostname.replace(/^www\./, '')
    };
  } catch {
    return null;
  }
}

module.exports = { classifyUrl, extractDomainInfo, PLATFORM_PATTERNS };
