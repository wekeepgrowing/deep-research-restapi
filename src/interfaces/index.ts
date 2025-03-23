/**
 * Interface definitions for the application
 *
 * This module centralizes type definitions for reuse across components.
 */

/**
 * Research progress tracking interface
 */
export interface ResearchProgress {
  currentDepth: number;
  totalDepth: number;
  currentBreadth: number;
  totalBreadth: number;
  currentQuery?: string | { query?: string; researchGoal?: string };
  totalQueries: number;
  completedQueries: number;
  researchGoal?: string;
}

/**
 * Research query options
 */
export interface ResearchOptions {
  query: string;
  breadth?: number;
  depth?: number;
  outputDir?: string;
  logFileName?: string;
  reportFileName?: string;
  actionPlanFileName?: string;
  onProgress?: (progress: ResearchProgress) => void;
  traceId?: string; // For telemetry tracking
}

/**
 * Research result interface
 */
export interface ResearchResult {
  learnings: string[];
  visitedUrls: string[];
  reportPath?: string;
  logPath?: string;
  actionPlanPath?: string;
  report?: string;
  actionPlan?: any;
  query: string; // Original query for reference
}

/**
 * SERP query interface
 */
export interface SerpQuery {
  query: string;
  researchGoal: string;
}

/**
 * Search processing result
 */
export interface SearchProcessingResult {
  learnings: string[];
  followUpQuestions: string[];
}

/**
 * Action plan data structure
 */
export interface ActionPlan {
  title: string;
  steps: string[];
  considerations: string[];
  sources: string[];
}

/**
 * Job status for the API
 */
export interface JobStatus {
  id: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  progress?: ResearchProgress;
  result?: ResearchResult;
  error?: string;
  createdAt: Date;
  updatedAt: Date;
  logs?: string[];
  sseClients?: Set<any>;
}