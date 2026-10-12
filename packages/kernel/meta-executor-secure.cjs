/**
 * MetaExecutorSecure — Executor seguro de operações no filesystem
 * Com validação de paths, whitelist de diretórios, e sanitização de inputs.
 * @module meta-executor-secure
 */

const fs = require("fs").promises;
const path = require("path");
const { execFile } = require("child_process");
const util = require("util");
const execFileAsync = util.promisify(execFile);

// ─── Constants ───────────────────────────────────────────────────────────────

const ALLOWED_PATH_CHARS = /^[a-zA-Z0-9_\-\.\s\/\\]+$/;
const FORBIDDEN_PATTERNS = [
  /\.\./,                      // path traversal
  /[~`!@#$%^&*()+=\[\]{}|;:'",<>?]/, // special chars (adjust as needed)
];
const MAX_PATH_LENGTH = 500;
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB

// ─── Path Validator ──────────────────────────────────────────────────────────

class PathValidator {
  /**
   * @param {Object} options
   * @param {string[]} options.allowedDirs - Absolute paths allowed
   * @param {string} options.workspaceRoot - Fallback workspace root
   */
  constructor(options = {}) {
    this.allowedDirs = (options.allowedDirs || []).map((d) =>
      path.resolve(d)
    );
    this.workspaceRoot = path.resolve(options.workspaceRoot || process.cwd());
    if (this.allowedDirs.length === 0) {
      this.allowedDirs.push(this.workspaceRoot);
    }
  }

  /**
   * Validate and resolve a user-provided path.
   * @param {string} inputPath
   * @param {Object} options
   * @param {boolean} options.mustExist - Whether the path must already exist
   * @param {boolean} options.allowCreate - Whether creating new files is allowed
   * @returns {string} Resolved absolute path
   * @throws {Error} If path is invalid or outside allowed directories
   */
  validate(inputPath, options = {}) {
    if (!inputPath || typeof inputPath !== "string") {
      throw new Error("[PathValidator] Path must be a non-empty string");
    }

    if (inputPath.length > MAX_PATH_LENGTH) {
      throw new Error(`[PathValidator] Path exceeds max length (${MAX_PATH_LENGTH})`);
    }

    // Reject absolute paths outside workspace unless explicitly allowed
    if (path.isAbsolute(inputPath)) {
      const isAllowed = this.allowedDirs.some((dir) =>
        this._isSubPath(inputPath, dir)
      );
      if (!isAllowed) {
        throw new Error(
          `[PathValidator] Absolute path not allowed: ${inputPath}`
        );
      }
    }

    // Check for traversal patterns and special characters
    const normalizedInput = path.normalize(inputPath);
    if (normalizedInput.includes("..")) {
      throw new Error(`[PathValidator] Path traversal detected: ${inputPath}`);
    }

    if (!ALLOWED_PATH_CHARS.test(inputPath)) {
      throw new Error(`[PathValidator] Path contains forbidden characters: ${inputPath}`);
    }

    // Resolve relative to workspace root
    const resolved = path.resolve(this.workspaceRoot, normalizedInput);

    // Final check: must be within allowed directories
    const isWithinAllowed = this.allowedDirs.some((dir) =>
      this._isSubPath(resolved, dir)
    );
    if (!isWithinAllowed) {
      throw new Error(
        `[PathValidator] Resolved path outside allowed directories: ${resolved}`
      );
    }

    // Optional: check for symlinks (async, but we do sync best-effort)
    try {
      const realPath = fs.realpath(resolved).catch(() => resolved);
      // We'll do async check in calling code if needed
    } catch {}

    return resolved;
  }

  _isSubPath(target, parent) {
    const relative = path.relative(parent, target);
    return relative && !relative.startsWith("..") && !path.isAbsolute(relative);
  }

  /**
   * Sanitize a filename or directory name component.
   * @param {string} name
   * @returns {string}
   */
  sanitizeName(name) {
    if (!name || typeof name !== "string") {
      throw new Error("[PathValidator] Name must be a non-empty string");
    }
    // Remove path separators, traversal, and special chars
    return name
      .replace(/[\/\\]/g, "")
      .replace(/\.\./g, "")
      .replace(/[<>:\"|?*]/g, "")
      .trim();
  }
}

// ─── MetaExecutorSecure ──────────────────────────────────────────────────────

class MetaExecutorSecure {
  constructor(options = {}) {
    this.validator = new PathValidator({
      allowedDirs: options.allowedDirs,
      workspaceRoot: options.workspaceRoot,
    });
    this.workspaceRoot = this.validator.workspaceRoot;
    this.dryRun = options.dryRun || false;
    this.auditLog = options.auditLog || [];
  }

  // ─── Audit Logging ───────────────────────────────────────────────────────────

  _audit(operation, target, success, details = "") {
    const entry = {
      timestamp: new Date().toISOString(),
      operation,
      target,
      success,
      details,
    };
    this.auditLog.push(entry);
    console.log(
      `[MetaExecutor] ${success ? "✓" : "✗"} ${operation} → ${target}${
        details ? ` | ${details}` : ""
      }`
    );
  }

  // ─── File Operations ─────────────────────────────────────────────────────────

  /**
   * Read a file securely.
   * @param {string} filePath
   * @returns {Promise<string>}
   */
  async readFile(filePath) {
    try {
      const resolved = this.validator.validate(filePath, { mustExist: true });
      const content = await fs.readFile(resolved, "utf-8");
      this._audit("readFile", resolved, true);
      return content;
    } catch (err) {
      this._audit("readFile", filePath, false, err.message);
      throw err;
    }
  }

  /**
   * Write content to a file securely.
   * @param {string} filePath
   * @param {string} content
   * @param {Object} options
   * @param {boolean} options.append
   * @returns {Promise<void>}
   */
  async writeFile(filePath, content, options = {}) {
    try {
      if (typeof content !== "string") {
        throw new Error("[MetaExecutor] Content must be a string");
      }
      if (content.length > MAX_FILE_SIZE) {
        throw new Error(`[MetaExecutor] Content exceeds max size (${MAX_FILE_SIZE})`);
      }

      const resolved = this.validator.validate(filePath, { allowCreate: true });
      const dir = path.dirname(resolved);

      // Ensure directory exists
      await fs.mkdir(dir, { recursive: true });

      if (this.dryRun) {
        this._audit("writeFile", resolved, true, "DRY RUN");
        return;
      }

      if (options.append) {
        await fs.appendFile(resolved, content, "utf-8");
      } else {
        await fs.writeFile(resolved, content, "utf-8");
      }
      this._audit("writeFile", resolved, true);
    } catch (err) {
      this._audit("writeFile", filePath, false, err.message);
      throw err;
    }
  }

  /**
   * Create a script file securely.
   * @param {string} filePath
   * @param {string} scriptContent
   * @returns {Promise<string>} Path to created file
   */
  async createScript(filePath, scriptContent) {
    try {
      if (typeof scriptContent !== "string") {
        throw new Error("[MetaExecutor] Script content must be a string");
      }

      const resolved = this.validator.validate(filePath, { allowCreate: true });
      const dir = path.dirname(resolved);

      await fs.mkdir(dir, { recursive: true });

      if (this.dryRun) {
        this._audit("createScript", resolved, true, "DRY RUN");
        return resolved;
      }

      await fs.writeFile(resolved, scriptContent, "utf-8");
      this._audit("createScript", resolved, true);
      return resolved;
    } catch (err) {
      this._audit("createScript", filePath, false, err.message);
      throw err;
    }
  }

  /**
   * Edit a file by replacing occurrences of a pattern.
   * @param {string} filePath
   * @param {string} oldString
   * @param {string} newString
   * @returns {Promise<void>}
   */
  async editFile(filePath, oldString, newString) {
    try {
      const resolved = this.validator.validate(filePath, { mustExist: true });

      if (typeof oldString !== "string" || typeof newString !== "string") {
        throw new Error("[MetaExecutor] oldString and newString must be strings");
      }

      const content = await fs.readFile(resolved, "utf-8");
      if (!content.includes(oldString)) {
        throw new Error(`[MetaExecutor] Pattern not found in file: ${oldString.slice(0, 50)}...`);
      }

      const updated = content.split(oldString).join(newString);

      if (this.dryRun) {
        this._audit("editFile", resolved, true, "DRY RUN");
        return;
      }

      await fs.writeFile(resolved, updated, "utf-8");
      this._audit("editFile", resolved, true);
    } catch (err) {
      this._audit("editFile", filePath, false, err.message);
      throw err;
    }
  }

  /**
   * Delete a file securely.
   * @param {string} filePath
   * @returns {Promise<void>}
   */
  async deleteFile(filePath) {
    try {
      const resolved = this.validator.validate(filePath, { mustExist: true });

      if (this.dryRun) {
        this._audit("deleteFile", resolved, true, "DRY RUN");
        return;
      }

      await fs.unlink(resolved);
      this._audit("deleteFile", resolved, true);
    } catch (err) {
      this._audit("deleteFile", filePath, false, err.message);
      throw err;
    }
  }

  /**
   * List directory contents securely.
   * @param {string} dirPath
   * @returns {Promise<string[]>}
   */
  async listDirectory(dirPath) {
    try {
      const resolved = this.validator.validate(dirPath, { mustExist: true });
      const entries = await fs.readdir(resolved, { withFileTypes: true });
      this._audit("listDirectory", resolved, true);
      return entries.map((e) => ({
        name: e.name,
        isDirectory: e.isDirectory(),
        isFile: e.isFile(),
      }));
    } catch (err) {
      this._audit("listDirectory", dirPath, false, err.message);
      throw err;
    }
  }

  /**
   * Create a directory securely.
   * @param {string} dirPath
   * @returns {Promise<void>}
   */
  async createDirectory(dirPath) {
    try {
      const resolved = this.validator.validate(dirPath, { allowCreate: true });

      if (this.dryRun) {
        this._audit("createDirectory", resolved, true, "DRY RUN");
        return;
      }

      await fs.mkdir(resolved, { recursive: true });
      this._audit("createDirectory", resolved, true);
    } catch (err) {
      this._audit("createDirectory", dirPath, false, err.message);
      throw err;
    }
  }

  // ─── Shell Operations (Restricted) ─────────────────────────────────────────

  /**
   * Execute a whitelisted command safely.
   * @param {string} command - Must be in whitelist
   * @param {string[]} args
   * @param {Object} options
   * @returns {Promise<{stdout, stderr}>}
   */
  async executeCommand(command, args = [], options = {}) {
    const ALLOWED_COMMANDS = [
      "git",
      "node",
      "npm",
      "python",
      "python3",
      "ls",
      "cat",
      "grep",
      "find",
      "mkdir",
      "rm",
      "cp",
      "mv",
      "echo",
      "pwd",
      "wc",
    ];

    if (!ALLOWED_COMMANDS.includes(command)) {
      const err = new Error(`[MetaExecutor] Command not in whitelist: ${command}`);
      this._audit("executeCommand", command, false, "Not whitelisted");
      throw err;
    }

    // Sanitize args: no shell metacharacters
    const sanitizedArgs = args.map((arg) => {
      if (typeof arg !== "string") return String(arg);
      // Basic sanitization
      return arg.replace(/[;&|`$(){}[\]\\]/g, "");
    });

    const cwd = options.cwd
      ? this.validator.validate(options.cwd, { mustExist: true })
      : this.workspaceRoot;

    try {
      if (this.dryRun) {
        this._audit("executeCommand", `${command} ${sanitizedArgs.join(" ")}`, true, "DRY RUN");
        return { stdout: "", stderr: "" };
      }

      const result = await execFileAsync(command, sanitizedArgs, {
        cwd,
        timeout: options.timeout || 30000,
        maxBuffer: options.maxBuffer || 1024 * 1024,
        env: { ...process.env, PATH: process.env.PATH },
      });
      this._audit("executeCommand", command, true);
      return result;
    } catch (err) {
      this._audit("executeCommand", command, false, err.message);
      throw err;
    }
  }

  // ─── Info / Status ───────────────────────────────────────────────────────────

  getAuditLog() {
    return [...this.auditLog];
  }

  clearAuditLog() {
    this.auditLog.length = 0;
  }
}

// ─── Exports ─────────────────────────────────────────────────────────────────

module.exports = {
  MetaExecutorSecure,
  PathValidator,
};