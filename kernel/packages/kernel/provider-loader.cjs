/**
 * Provider Loader — Multi-Provider Support for Luna Bridge
 * Loads provider configs from provider-configs/*.json
 */
const fs = require('fs');
const path = require('path');

const CONFIGS_DIR = path.join(__dirname, 'provider-configs');

function loadProviderConfig(providerName) {
  const configPath = path.join(CONFIGS_DIR, `${providerName}.json`);
  if (!fs.existsSync(configPath)) {
    throw new Error(`Provider config not found: ${configPath}`);
  }
  const raw = fs.readFileSync(configPath, 'utf8');
  return JSON.parse(raw);
}

function listProviders() {
  if (!fs.existsSync(CONFIGS_DIR)) return [];
  return fs.readdirSync(CONFIGS_DIR)
    .filter(f => f.endsWith('.json'))
    .map(f => f.replace('.json', ''));
}

function getProviderUrl(providerConfig, mode = 'instant') {
  return providerConfig.modeUrls?.[mode] || providerConfig.baseUrl;
}

function getProviderSelector(providerConfig, key) {
  return providerConfig.selectors?.[key];
}

function getProviderCookies(providerConfig) {
  return {
    master: path.join(__dirname, 'cookies', providerConfig.cookies?.masterCookies || `${providerConfig.name}-master-cookies.json`),
    localStorage: path.join(__dirname, 'cookies', providerConfig.cookies?.masterLocalStorage || `${providerConfig.name}-master-localstorage.json`)
  };
}

function getProviderFeature(providerConfig, key) {
  return providerConfig.features?.[key];
}

function getProviderInputSelector(providerConfig) {
  return providerConfig.selectors?.input;
}

function getProviderResponseSelectors(providerConfig) {
  return {
    assistant: providerConfig.selectors?.assistantMessage,
    container: providerConfig.selectors?.responseContainer,
    messageList: providerConfig.selectors?.messageList,
    thinking: providerConfig.selectors?.thinking,
    actionButtons: providerConfig.selectors?.actionButtons,
    appContent: providerConfig.selectors?.appContent
  };
}

function getProviderUiSelectors(providerConfig) {
  return {
    sendButton: providerConfig.selectors?.sendButton,
    stopButton: providerConfig.selectors?.stopButton,
    generatingIndicator: providerConfig.selectors?.generatingIndicator,
  };
}

module.exports = {
  loadProviderConfig,
  listProviders,
  getProviderUrl,
  getProviderSelector,
  getProviderCookies,
  getProviderFeature,
  getProviderInputSelector,
  getProviderResponseSelectors,
  getProviderUiSelectors
};
