/**
 * resolve-luna.cjs
 * Helper portátil para descobrir onde o luna-kernel está instalado.
 * Ordem de precedência:
 *   1. LUNA_KERNEL_DIR (env var)
 *   2. ../../../packages/kernel     (layout monorepo)
 *   3. ~/.luna-kernel               (layout antigo do PC do Elias/Abner)
 *   4. ~/.luna/kernel               (novo layout LUNA_HOME)
 *   5. ../../../.luna-kernel        (ao lado do monorepo)
 *   6. ../../../luna-kernel         (ao lado do monorepo, nome sem ponto)
 *   7. ../../../../luna-kernel      (um nível acima do monorepo, layout VPS)
 */
const path = require('path');
const fs = require('fs');
const os = require('os');

function findLunaKernel() {
  if (process.env.LUNA_KERNEL_DIR && fs.existsSync(process.env.LUNA_KERNEL_DIR)) {
    return process.env.LUNA_KERNEL_DIR;
  }

  const home = os.homedir();
  const candidates = [
    path.resolve(__dirname, '..', '..', '..', 'packages', 'kernel'),
    path.join(home, '.luna-kernel'),
    path.join(home, '.luna', 'kernel'),
    path.resolve(__dirname, '..', '..', '..', '.luna-kernel'),
    path.resolve(__dirname, '..', '..', '..', 'luna-kernel'),
    path.resolve(__dirname, '..', '..', '..', '..', 'luna-kernel'),
  ];

  for (const candidate of candidates) {
    if (fs.existsSync(path.join(candidate, 'luna-soul.cjs'))) {
      process.env.LUNA_KERNEL_DIR = candidate;
      return candidate;
    }
  }

  // Fallback: env var or first candidate so the require fails with a clear path
  const resolved = process.env.LUNA_KERNEL_DIR || candidates[0];
  process.env.LUNA_KERNEL_DIR = resolved;
  return resolved;
}

const LUNA_KERNEL_DIR = findLunaKernel();

module.exports = { LUNA_KERNEL_DIR };
