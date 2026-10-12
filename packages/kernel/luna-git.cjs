/**
 * luna-git.cjs — Git-Native Wrapper para Workspace Agent
 *
 * Padrões de Aider adaptados:
 *   - Branch por sessão: luna/session-<timestamp>-<id>
 *   - Atomic commits: cada tool call que modifica arquivo = 1 commit
 *   - /undo: git revert de todos os commits da sessão
 *   - /diff: diff da sessão vs branch base
 *   - /reset: descarta tudo e volta pra base
 */

const { execSync, spawn } = require('child_process');
const path = require('path');

class LunaGit {
  constructor(workspacePath) {
    this.workspacePath = workspacePath;
    this.sessionBranch = null;
    this.baseBranch = null;
    this.commits = []; // { hash, message, files, timestamp }
    this.isRepo = false;
  }

  async init() {
    this.isRepo = this._checkIsRepo();
    if (!this.isRepo) {
      return { success: false, error: 'Diretório não é um repo git. Rode "git init" primeiro.' };
    }

    this.baseBranch = this._getCurrentBranch();
    this.sessionBranch = `luna/session-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

    try {
      // Stash mudanças não commitadas antes de criar branch
      const hasChanges = this._hasUncommittedChanges();
      if (hasChanges) {
        execSync(`cd "${this.workspacePath}" && git stash push -m "luna-pre-session-${Date.now()}"`, { encoding: 'utf8' });
      }

      // Criar branch da base
      execSync(`cd "${this.workspacePath}" && git checkout -b ${this.sessionBranch}`, { encoding: 'utf8' });

      // Se havia stash, aplicar na nova branch
      if (hasChanges) {
        try {
          execSync(`cd "${this.workspacePath}" && git stash pop`, { encoding: 'utf8' });
        } catch {
          // Stash pode ter conflito — deixa no stash
        }
      }

      return { success: true, branch: this.sessionBranch, baseBranch: this.baseBranch };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  _checkIsRepo() {
    try {
      execSync(`cd "${this.workspacePath}" && git rev-parse --git-dir`, { encoding: 'utf8', stdio: 'pipe' });
      return true;
    } catch {
      return false;
    }
  }

  _getCurrentBranch() {
    try {
      return execSync(`cd "${this.workspacePath}" && git branch --show-current`, { encoding: 'utf8' }).trim();
    } catch {
      return 'main';
    }
  }

  _hasUncommittedChanges() {
    try {
      const status = execSync(`cd "${this.workspacePath}" && git status --short`, { encoding: 'utf8' });
      return status.trim().length > 0;
    } catch {
      return false;
    }
  }

  async commit(filePath, message) {
    if (!this.isRepo || !this.sessionBranch) {
      return { success: false, error: 'Git não inicializado' };
    }

    try {
      execSync(`cd "${this.workspacePath}" && git add "${filePath}"`, { encoding: 'utf8' });
      const output = execSync(
        `cd "${this.workspacePath}" && git commit -m "${message}" --no-verify`,
        { encoding: 'utf8' }
      );

      // Capturar hash do commit
      const hash = execSync(`cd "${this.workspacePath}" && git rev-parse HEAD`, { encoding: 'utf8' }).trim().slice(0, 7);
      this.commits.push({
        hash,
        message,
        file: filePath,
        timestamp: Date.now(),
      });

      return { success: true, hash, message };
    } catch (err) {
      // Se não há mudanças para commitar, não é erro
      if (err.message?.includes('nothing to commit')) {
        return { success: true, hash: null, message: 'no changes' };
      }
      return { success: false, error: err.message };
    }
  }

  async commitAll(message) {
    if (!this.isRepo || !this.sessionBranch) {
      return { success: false, error: 'Git não inicializado' };
    }

    try {
      execSync(`cd "${this.workspacePath}" && git add -A`, { encoding: 'utf8' });
      const output = execSync(
        `cd "${this.workspacePath}" && git commit -m "${message}" --no-verify`,
        { encoding: 'utf8' }
      );

      const hash = execSync(`cd "${this.workspacePath}" && git rev-parse HEAD`, { encoding: 'utf8' }).trim().slice(0, 7);
      this.commits.push({ hash, message, timestamp: Date.now() });

      return { success: true, hash, message };
    } catch (err) {
      if (err.message?.includes('nothing to commit')) {
        return { success: true, hash: null, message: 'no changes' };
      }
      return { success: false, error: err.message };
    }
  }

  async diff() {
    if (!this.isRepo) return { success: false, error: 'Não é repo git' };
    const base = this.baseBranch || 'main';
    try {
      const output = execSync(
        `cd "${this.workspacePath}" && git diff ${base}...HEAD --stat`,
        { encoding: 'utf8' }
      );
      return { success: true, diff: output };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  async diffFull() {
    if (!this.isRepo) return { success: false, error: 'Não é repo git' };
    const base = this.baseBranch || 'main';
    try {
      const output = execSync(
        `cd "${this.workspacePath}" && git diff ${base}...HEAD`,
        { encoding: 'utf8' }
      );
      return { success: true, diff: output };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  async undo() {
    if (!this.isRepo || !this.sessionBranch) {
      return { success: false, error: 'Git não inicializado' };
    }

    if (this.commits.length === 0) {
      return { success: false, error: 'Nenhum commit para desfazer' };
    }

    try {
      // Reverter todos os commits da sessão (do mais recente pro mais antigo)
      const base = this.baseBranch || 'main';
      execSync(
        `cd "${this.workspacePath}" && git reset --hard ${base}`,
        { encoding: 'utf8' }
      );

      const count = this.commits.length;
      this.commits = [];
      return { success: true, reverted: count };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  async reset() {
    if (!this.isRepo || !this.sessionBranch) {
      return { success: false, error: 'Git não inicializado' };
    }

    try {
      const base = this.baseBranch || 'main';
      execSync(`cd "${this.workspacePath}" && git checkout ${base}`, { encoding: 'utf8' });
      execSync(`cd "${this.workspacePath}" && git branch -D ${this.sessionBranch}`, { encoding: 'utf8' });
      this.commits = [];
      return { success: true, baseBranch: base };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  getStatus() {
    return {
      isRepo: this.isRepo,
      baseBranch: this.baseBranch,
      sessionBranch: this.sessionBranch,
      commits: this.commits,
    };
  }

  formatStatus() {
    if (!this.isRepo) return '🌿 Git: não é um repositório git';
    const lines = [
      `🌿 Git Status:`,
      `   Branch base: ${this.baseBranch || 'N/A'}`,
      `   Branch sessão: ${this.sessionBranch || 'N/A'}`,
      `   Commits: ${this.commits.length}`,
    ];
    for (const c of this.commits.slice(-5)) {
      lines.push(`   ${c.hash} ${c.message}`);
    }
    if (this.commits.length > 5) {
      lines.push(`   ... e mais ${this.commits.length - 5} commits`);
    }
    return lines.join('\n');
  }
}

module.exports = {
  LunaGit,
};
