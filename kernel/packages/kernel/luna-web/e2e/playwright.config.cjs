module.exports = {
  testDir: '.',
  use: {
    baseURL: process.env.BASE_URL || 'http://localhost:3458',
    headless: true,
    viewport: { width: 1280, height: 720 },
  },
  projects: [
    { name: 'chromium', use: { browserName: 'chromium' } },
  ],
};
