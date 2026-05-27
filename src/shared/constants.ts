export const SETTINGS = {
  PROXY_SERVER_URL: 'proxyServerUrl',
  API_KEY: 'apiKey',
  MIN_TITLE_WORD_COUNT: 'minTitleWordCount',
  MIN_BODY_WORD_COUNT: 'minBodyWordCount',
  AUTO_REMOVAL_THRESHOLD: 'autoRemovalThreshold',
  REPORTING_THRESHOLD: 'reportingThreshold',
  LOCATION: 'location',
  BLOCKLIST_SOURCE_URL: 'blocklistSourceUrl',
  LLM_API_KEY: 'llmApiKey',
  LLM_MODEL: 'llmModel',
  AI_PROVIDER: 'aiProvider',
} as const;

export const CACHE_PREFIX = 'jijiguard_scan_';
export const BLOCKLIST_CACHE_PREFIX = 'jijiguard_blocklist_';
export const LOCATION_CACHE_KEY = 'jijiguard_location';
export const CACHE_EXPIRATION_MS = 604800000; // 7 days
export const BLOCKLIST_EXPIRATION_MS = 86400000; // 24 hours
