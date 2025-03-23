/**
 * AI Telemetry Service
 *
 * Provides centralized telemetry tracking for all AI operations
 * using Langfuse for observability and monitoring.
 */

import { NodeSDK } from "@opentelemetry/sdk-node";
import { getNodeAutoInstrumentations } from "@opentelemetry/auto-instrumentations-node";
import { LangfuseExporter } from "langfuse-vercel";
import { v4 as uuidv4 } from 'uuid';
import { Langfuse } from "langfuse";

import { config } from '../config';

// Initialize OpenTelemetry SDK with Langfuse exporter
export const initializeTelemetry = () => {
  if (!config.telemetry.enabled) {
    return {
      sdk: null,
      langfuse: null,
      isEnabled: false,
    };
  }

  try {
    // Only initialize if all required keys are present
    const publicKey = config.telemetry.langfuse.publicKey;
    const secretKey = config.telemetry.langfuse.secretKey;
    
    if (!publicKey || !secretKey) {
      console.warn('Langfuse keys not configured. Telemetry disabled.');
      return {
        sdk: null,
        langfuse: null,
        isEnabled: false,
      };
    }

    // Initialize Langfuse exporter with debug option for visibility
    const langfuseExporter = new LangfuseExporter({
      debug: config.server.isDevelopment || process.env.LANGFUSE_DEBUG === 'true',
      secretKey: secretKey,
      publicKey: publicKey,
      baseUrl: config.telemetry.langfuse.baseUrl,
    });

    // Initialize OpenTelemetry SDK
    const sdk = new NodeSDK({
      traceExporter: langfuseExporter,
      instrumentations: [getNodeAutoInstrumentations()],
    });
    
    // Start the SDK
    sdk.start();
    
    // Initialize Langfuse client
    const langfuse = new Langfuse({
      publicKey,
      secretKey,
      baseUrl: config.telemetry.langfuse.baseUrl,
      debug: config.server.isDevelopment || process.env.LANGFUSE_DEBUG === 'true',
      flushAtExit: true,
    });

    console.log('Langfuse telemetry initialized successfully');
    return {
      sdk,
      langfuse,
      isEnabled: true,
    };
  } catch (error) {
    console.error('Failed to initialize telemetry:', error);
    return {
      sdk: null,
      langfuse: null,
      isEnabled: false,
    };
  }
};

// Initialize telemetry once on module load
export const telemetry = initializeTelemetry();

/**
 * Create a new trace for a research session
 *
 * @param name Name of the trace for identification
 * @param metadata Additional metadata for the trace
 * @returns Trace ID and Langfuse trace object if telemetry is enabled
 */
export const createResearchTrace = (name: string, metadata?: Record<string, any>) => {
  if (!telemetry.isEnabled || !telemetry.langfuse) {
    return { traceId: uuidv4(), trace: null, isEnabled: false };
  }

  try {
    const traceId = uuidv4();
    const trace = telemetry.langfuse.trace({
      id: traceId,
      name,
      metadata: {
        ...metadata,
        startTime: new Date().toISOString(),
        totalTokens: 0,
        tokenUsage: []
      },
    });

    return { traceId, trace, isEnabled: true };
  } catch (error) {
    console.error('Failed to create research trace:', error);
    return { traceId: uuidv4(), trace: null, isEnabled: false };
  }
};

/**
 * Create a Langfuse generation object for tracking AI interactions
 *
 * @param traceId Parent trace ID
 * @param model Model name
 * @param prompt Prompt text
 * @param metadata Additional metadata
 * @returns Generation object if telemetry is enabled
 */
export const createGeneration = (
  traceId: string,
  model: string,
  prompt: string,
  metadata?: Record<string, any>
) => {
  if (!telemetry.isEnabled || !telemetry.langfuse) {
    return null;
  }

  try {
    const generation = telemetry.langfuse.generation({
      name: `${model}-generation`,
      traceId: traceId,
      model: model,
      input: { prompt },
      metadata: {
        ...metadata,
        timestamp: new Date().toISOString(),
      },
    });
    
    return generation;
  } catch (error) {
    console.error('Failed to create generation:', error);
    return null;
  }
};

/**
 * Update a generation with completion information
 *
 * @param generation Langfuse generation object
 * @param output Output text
 * @param tokenUsage Token usage information
 * @returns Updated generation if successful
 */
export const completeGeneration = (
  generation: any,
  output: any,
  tokenUsage: { promptTokens: number; completionTokens: number; totalTokens: number }
) => {
  if (!generation) {
    return null;
  }

  try {
    generation.end({
      output: output,
      usage: {
        promptTokens: tokenUsage.promptTokens,
        completionTokens: tokenUsage.completionTokens,
        totalTokens: tokenUsage.totalTokens,
      },
    });
    
    return generation;
  } catch (error) {
    console.error('Failed to complete generation:', error);
    return null;
  }
};

/**
 * Fetch trace metadata asynchronously
 *
 * @param traceId Trace ID to fetch
 * @returns Trace metadata or null if not found/error
 */
export const fetchTraceMetadata = async (traceId: string): Promise<Record<string, any> | null> => {
  if (!telemetry.isEnabled || !telemetry.langfuse) {
    return null;
  }

  try {
    const traceData = await telemetry.langfuse.fetchTrace(traceId);
    return traceData?.data?.metadata || null;
  } catch (error) {
    console.error(`Error fetching trace metadata: ${error}`);
    return null;
  }
};

/**
 * Update trace metadata asynchronously
 *
 * @param traceId Trace ID to update
 * @param metadata Metadata to update
 * @returns Success status
 */
export const updateTraceMetadata = async (
  traceId: string,
  metadata: Record<string, any>
): Promise<boolean> => {
  if (!telemetry.isEnabled || !telemetry.langfuse) {
    return false;
  }

  try {
    // Get current metadata
    const currentMetadata = await fetchTraceMetadata(traceId);
    
    // Update trace with merged metadata
    telemetry.langfuse.trace({
      id: traceId,
      update: true,
      metadata: {
        ...currentMetadata,
        ...metadata,
        updatedAt: new Date().toISOString()
      }
    });
    
    return true;
  } catch (error) {
    console.error(`Error updating trace metadata: ${error}`);
    return false;
  }
};

/**
 * Get telemetry options for AI operations
 *
 * @param operationName Name of the AI operation
 * @param traceId Parent trace ID to link this operation to
 * @param metadata Additional metadata for the operation
 * @returns Telemetry configuration options
 */
export const getAITelemetryOptions = (operationName: string, traceId?: string, metadata?: Record<string, any>) => {
  if (!telemetry.isEnabled) {
    return { isEnabled: false };
  }

  const functionId = `${operationName}-${uuidv4().slice(0, 8)}`;
  
  return {
    isEnabled: true,
    functionId,
    recordInputs: true,
    recordOutputs: true,
    metadata: {
      ...metadata,
      operationId: functionId,
      ...(traceId ? { langfuseTraceId: traceId, langfuseUpdateParent: true } : {}),
    },
  };
};

/**
 * Clean up telemetry resources
 * This should be called during application shutdown
 */
export const shutdownTelemetry = async () => {
  if (telemetry.isEnabled) {
    if (telemetry.langfuse) {
      try {
        await telemetry.langfuse.flushAsync();
        console.log('Langfuse data flushed successfully');
      } catch (error) {
        console.error('Error flushing Langfuse data:', error);
      }
    }
    
    if (telemetry.sdk) {
      try {
        await telemetry.sdk.shutdown();
        console.log('OpenTelemetry SDK shut down successfully');
      } catch (error) {
        console.error('Error shutting down OpenTelemetry SDK:', error);
      }
    }
  }
};