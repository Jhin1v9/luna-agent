import { defineConfig } from 'vitest/config';

/**
 * Testes de INTEGRAção — rodam contra Postgres real (banco `luna_test`,
 * criado/derrubado pelo próprio arquivo de teste). Nunca contra o `luna` de dev.
 */
export default defineConfig({
  test: {
    include: ['tests/integration/**/*.test.ts'],
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 60_000,
    pool: 'forks',
  },
});
