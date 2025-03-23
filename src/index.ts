/**
 * Main entry point for Deep Research API
 *
 * Exports core functionality and initializes telemetry
 */

// Initialize telemetry first
import { telemetry } from './ai/telemetry';

// Export primary API services
export { runResearch } from './services/research';
export { deepResearch } from './core/research/engine';
export { writeFinalReport, writeFinalAnswer } from './core/report/markdown';
export { writeActionPlan } from './core/report/action-plan';

// Export utility classes
export { OutputManager } from './utils/output-manager';

// Export types
export {
  ResearchOptions,
  ResearchResult,
  ResearchProgress,
  SerpQuery,
  SearchProcessingResult,
  ActionPlan,
  JobStatus
} from './interfaces';

// Export API functionality
export { startServer } from './api';

// Log telemetry status on import
if (telemetry.isEnabled) {
  console.log('Telemetry initialized successfully');
} else {
  console.log('Telemetry is disabled or failed to initialize');
} 

// Export telemetry for external use
export { telemetry, shutdownTelemetry } from './ai/telemetry';