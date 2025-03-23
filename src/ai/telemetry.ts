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

    // Initialize Langfuse exporter
    const langfuseExporter = new LangfuseExporter({
      debug: config.server.isDevelopment,
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
    });

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
      metadata,
    });

    return { traceId, trace, isEnabled: true };
  } catch (error) {
    console.error('Failed to create research trace:', error);
    return { traceId: uuidv4(), trace: null, isEnabled: false };
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

  return {
    isEnabled: true,
    functionId: `${operationName}-${uuidv4().slice(0, 8)}`,
    metadata: {
      ...metadata,
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
      await telemetry.langfuse.flushAsync();
    }
    
    if (telemetry.sdk) {
      await telemetry.sdk.shutdown();
    }
  }
};