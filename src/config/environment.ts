/**
 * Environment configuration with validation
 *
 * This module centralizes all environment variable handling and validation
 * to ensure type safety and configuration consistency.
 */

import { z } from 'zod';

// Environment variable schema with validation
const envSchema = z.object({
  // API and server settings
  PORT: z.string().default('3000'),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  
  // Firecrawl settings
  FIRECRAWL_KEY: z.string().min(1, 'Firecrawl API key is required'),
  FIRECRAWL_BASE_URL: z.string().url().optional(),
  
  // OpenAI settings
  OPENAI_KEY: z.string().min(1, 'OpenAI API key is required'),
  OPENAI_MODEL: z.string().default('o3-mini'),
  OPENAI_ENDPOINT: z.string().url().default('https://api.openai.com/v1'),
  
  // Other settings
  CONTEXT_SIZE: z.string().transform(val => parseInt(val, 10)).default('128000'),
  
  // Langfuse telemetry settings
  LANGFUSE_PUBLIC_KEY: z.string().optional(),
  LANGFUSE_SECRET_KEY: z.string().optional(),
  LANGFUSE_BASEURL: z.string().url().optional(),
  ENABLE_TELEMETRY: z.string().transform(val => val === 'true').default('true'),
});

// Parse environment variables with validation
function loadEnv() {
  try {
    return envSchema.parse(process.env);
  } catch (error) {
    if (error instanceof z.ZodError) {
      const formattedErrors = error.format();
      console.error('Environment validation failed:', JSON.stringify(formattedErrors, null, 2));
      process.exit(1);
    }
    throw error;
  }
}

// Export validated environment variables
export const env = loadEnv();

// Export typed environment for use across the application
export type Environment = z.infer<typeof envSchema>;