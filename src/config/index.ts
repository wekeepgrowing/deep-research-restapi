/**
 * Configuration module
 *
 * Centralizes all application configuration in one place
 */

import { env } from './environment';

// Default concurrency limit for external API calls
const DEFAULT_CONCURRENCY_LIMIT = 3;

/**
 * Application configuration derived from environment and constants
 */
export const config = {
  // Server settings
  server: {
    port: parseInt(env.PORT, 10),
    environment: env.NODE_ENV,
    isDevelopment: env.NODE_ENV === 'development',
    isProduction: env.NODE_ENV === 'production',
    isTest: env.NODE_ENV === 'test',
  },
  
  // Firecrawl configuration
  firecrawl: {
    apiKey: env.FIRECRAWL_KEY,
    baseUrl: env.FIRECRAWL_BASE_URL,
  },
  
  // OpenAI configuration
  openai: {
    apiKey: env.OPENAI_KEY,
    model: env.OPENAI_MODEL,
    baseUrl: env.OPENAI_ENDPOINT,
    contextSize: env.CONTEXT_SIZE,
  },
  
  // Telemetry configuration
  telemetry: {
    enabled: env.ENABLE_TELEMETRY,
    langfuse: {
      publicKey: env.LANGFUSE_PUBLIC_KEY,
      secretKey: env.LANGFUSE_SECRET_KEY,
      baseUrl: env.LANGFUSE_BASEURL,
    },
  },
  
  // Research settings
  research: {
    concurrencyLimit: DEFAULT_CONCURRENCY_LIMIT,
    defaultDepth: 2,
    defaultBreadth: 4,
    fileRetentionHours: 24,
  },
  
  // Path configurations
  paths: {
    resultsDir: './results',
    defaultReportFilename: 'final_report',
    defaultLogFilename: 'research_log',
    defaultActionPlanFilename: 'action_plan',
  },
};

// Export environment for direct access if needed
export { env };