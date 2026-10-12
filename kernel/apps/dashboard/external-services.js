/**
 * ExternalServices - Wrapper cacheado para CLI tools externos
 * Todas as operações usam spawn com timeout + fallback para cache
 */
class ExternalServices {
  constructor(cache) {
    this.cache = cache;
  }

  // ───────────────────────────────────────────────
  // GitHub Repos
  // ───────────────────────────────────────────────
  async getGitHubRepos() {
    const key = 'github_repos';
    const cached = this.cache.get(key);

    if (cached && cached.fresh) {
      try {
        const repos = JSON.parse(cached.data);
        return { repos, fresh: true, source: cached.source };
      } catch {
        // cache corrompido, continua para refresh
      }
    }

    // Tenta executar gh CLI (timeout 15s)
    const result = await this.cache.spawn(
      'gh', ['repo', 'list', '--json', 'name,description,updatedAt', '-L', '100'],
      {},
      15000
    );

    if (result.ok) {
      try {
        const repos = JSON.parse(result.data);
        this.cache.set(key, result.data);
        return { repos, fresh: true, source: 'live' };
      } catch (e) {
        // Falha no parse → tenta fallback
        if (cached && cached.data) {
          try {
            const repos = JSON.parse(cached.data);
            return {
              repos,
              fresh: false,
              source: 'file',
              stale: true,
              offline: true,
              parseError: e.message
            };
          } catch {}
        }
        return { repos: [], error: 'Falha ao parsear resposta do GitHub CLI', raw: result.data };
      }
    }

    // Spawn falhou → fallback para cache antigo
    if (cached && cached.data) {
      try {
        const repos = JSON.parse(cached.data);
        return {
          repos,
          fresh: false,
          source: 'file',
          stale: true,
          offline: true,
          spawnError: result.error,
          code: result.code
        };
      } catch {}
    }

    return { repos: [], error: 'GitHub CLI não disponível. Configure com `gh auth login`.' };
  }

  // ───────────────────────────────────────────────
  // Vercel Projects
  // ───────────────────────────────────────────────
  async getVercelProjects() {
    const key = 'vercel_projects';
    const cached = this.cache.get(key);

    if (cached && cached.fresh) {
      return { projects: cached.data, fresh: true, source: cached.source };
    }

    // vercel project ls (timeout 15s)
    const result = await this.cache.spawn('vercel', ['project', 'ls', '--yes'], {}, 15000);

    if (result.ok) {
      const projects = this._parseVercelProjects(result.data);
      this.cache.set(key, projects);
      return { projects, fresh: true, source: 'live' };
    }

    if (cached && cached.data) {
      return {
        projects: cached.data,
        fresh: false,
        source: 'file',
        stale: true,
        offline: true,
        spawnError: result.error,
        code: result.code
      };
    }

    return { projects: [], error: 'Vercel CLI não disponível. Configure com `vercel login`.' };
  }

  /**
   * Parser do output textual do `vercel project ls`
   */
  _parseVercelProjects(output) {
    const lines = output.split('\n').filter(l => l.trim());
    const projects = [];
    let inList = false;

    for (const line of lines) {
      const trimmed = line.trim();
      // Ignora headers, delimitadores e linhas informativas
      if (
        trimmed.includes('Projects') ||
        trimmed.startsWith('─') ||
        trimmed.startsWith('┌') ||
        trimmed.startsWith('├') ||
        trimmed.startsWith('└') ||
        trimmed.startsWith('│') ||
        trimmed.includes('project') && trimmed.includes('created') ||
        trimmed.includes('name') && trimmed.includes('state') ||
        trimmed === '' ||
        trimmed.startsWith('>') ||
        trimmed.startsWith('Vercel')
      ) {
        inList = true;
        continue;
      }

      // Extrai primeiro token como nome do projeto
      const tokens = trimmed.split(/\s{2,}/);
      const name = tokens[0];
      if (name && name.length > 1 && !name.includes('─') && !name.includes('│')) {
        projects.push({ name, raw: trimmed });
      }
    }

    // Fallback: se nada foi parseado, usa split simples
    if (projects.length === 0) {
      return lines
        .map(l => ({ name: l.trim().split(/\s+/)[0], raw: l.trim() }))
        .filter(p => p.name.length > 1 && !/^[─└├┌│]+$/.test(p.name));
    }

    return projects;
  }

  // ───────────────────────────────────────────────
  // CLI Tools Status
  // ───────────────────────────────────────────────
  async getToolsStatus() {
    const key = 'tools_status';
    const cached = this.cache.get(key);

    if (cached && cached.fresh) {
      return cached.data;
    }

    const tools = [
      { name: 'Node.js', cmd: 'node', args: ['--version'] },
      { name: 'npm', cmd: 'npm', args: ['--version'] },
      { name: 'Git', cmd: 'git', args: ['--version'] },
      { name: 'GitHub CLI', cmd: 'gh', args: ['--version'] },
      { name: 'Vercel CLI', cmd: 'vercel', args: ['--version'] },
      { name: 'Supabase CLI', cmd: 'supabase', args: ['--version'] }
    ];

    // Executa todos em paralelo com timeout individual de 5s
    const results = await Promise.all(
      tools.map(async (t) => {
        const result = await this.cache.spawn(t.cmd, t.args, {}, 5000);
        if (result.ok) {
          const version = result.data.trim().split('\n')[0];
          return { name: t.name, version, ok: true };
        }
        return { name: t.name, version: null, ok: false, error: result.error };
      })
    );

    this.cache.set(key, results);
    return results;
  }

  // ───────────────────────────────────────────────
  // Refresh manual
  // ───────────────────────────────────────────────
  async refreshExternal(service) {
    switch (service) {
      case 'github':
        this.cache.invalidate('github_repos');
        return this.getGitHubRepos();
      case 'vercel':
        this.cache.invalidate('vercel_projects');
        return this.getVercelProjects();
      case 'tools':
        this.cache.invalidate('tools_status');
        return this.getToolsStatus();
      default:
        return { error: `Serviço desconhecido: ${service}. Use 'github', 'vercel' ou 'tools'.` };
    }
  }
}

module.exports = ExternalServices;

