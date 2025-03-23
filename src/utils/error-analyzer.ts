/**
 * Error Analyzer Utility
 *
 * Analyzes and debugs errors in the research process
 */

import { TraceError } from '../interfaces';

/**
 * Analyze an error and extract trace information
 *
 * @param error The error to analyze
 * @param contextInfo Additional context information
 * @returns Analyzed error with trace information
 */
export function analyzeError(error: any, contextInfo?: Record<string, any>): TraceError {
  const isAxiosError = error?.isAxiosError === true;
  const timestamp = new Date().toISOString();
  
  // Basic error info
  const errorInfo: TraceError = {
    message: error instanceof Error ? error.message : String(error),
    timestamp,
    type: error.constructor.name || 'UnknownError',
    stack: error instanceof Error ? error.stack : undefined,
    context: contextInfo || {},
  };
  
  // Extract API-specific information for network errors
  if (isAxiosError) {
    errorInfo.apiError = {
      status: error.response?.status,
      statusText: error.response?.statusText,
      url: error.config?.url,
      method: error.config?.method?.toUpperCase(),
      data: error.response?.data,
    };
  }
  
  // Extract information from specific error types
  if (error.code === 'ECONNREFUSED' || error.code === 'ECONNABORTED') {
    errorInfo.category = 'connection';
    errorInfo.suggestions = [
      'Check network connectivity',
      'Verify API endpoint URLs are correct',
      'Check if service is running and accessible',
      'Consider increasing request timeout values'
    ];
  } else if (isAxiosError && error.response?.status === 429) {
    errorInfo.category = 'rate-limit';
    errorInfo.suggestions = [
      'Reduce concurrency limit in config',
      'Implement exponential backoff for retries',
      'Check API usage quotas'
    ];
  } else if (error.message?.includes('timeout')) {
    errorInfo.category = 'timeout';
    errorInfo.suggestions = [
      'Increase request timeout values',
      'Check network latency',
      'Consider breaking work into smaller chunks'
    ];
  } else if (error.message?.includes('memory') || error.message?.includes('heap')) {
    errorInfo.category = 'memory';
    errorInfo.suggestions = [
      'Reduce chunkSize for text processing',
      'Process fewer documents concurrently',
      'Check for memory leaks in recursive calls'
    ];
  } else {
    errorInfo.category = 'unknown';
    errorInfo.suggestions = [
      'Check log files for more detailed error information',
      'Verify all required environment variables are set',
      'Ensure all dependencies are properly installed'
    ];
  }
  
  return errorInfo;
}

/**
 * Create a detailed debug report for an error
 *
 * @param error The analyzed error
 * @param researchInfo Research context information
 * @returns Formatted debug report
 */
export function createErrorReport(error: TraceError, researchInfo?: Record<string, any>): string {
  const sections = [
    `# Error Analysis Report\n`,
    `## Error Overview`,
    `- **Timestamp**: ${error.timestamp}`,
    `- **Type**: ${error.type}`,
    `- **Message**: ${error.message}`,
    `- **Category**: ${error.category}`,
  ];
  
  // Add context information
  if (Object.keys(error.context).length > 0) {
    sections.push(
      `\n## Context Information`,
      ...Object.entries(error.context).map(([key, value]) =>
        `- **${key}**: ${typeof value === 'object' ? JSON.stringify(value) : value}`
      )
    );
  }
  
  // Add research information
  if (researchInfo && Object.keys(researchInfo).length > 0) {
    sections.push(
      `\n## Research Context`,
      ...Object.entries(researchInfo).map(([key, value]) =>
        `- **${key}**: ${typeof value === 'object' ? JSON.stringify(value) : value}`
      )
    );
  }
  
  // Add API error details
  if (error.apiError) {
    sections.push(
      `\n## API Error Details`,
      `- **Status**: ${error.apiError.status} (${error.apiError.statusText})`,
      `- **URL**: ${error.apiError.url}`,
      `- **Method**: ${error.apiError.method}`,
      error.apiError.data ? `- **Response Data**: \`\`\`json\n${JSON.stringify(error.apiError.data, null, 2)}\n\`\`\`` : ''
    );
  }
  
  // Add suggested actions
  if (error.suggestions && error.suggestions.length > 0) {
    sections.push(
      `\n## Suggested Actions`,
      ...error.suggestions.map(suggestion => `- ${suggestion}`)
    );
  }
  
  // Add stack trace if available
  if (error.stack) {
    sections.push(
      `\n## Stack Trace`,
      '```',
      error.stack,
      '```'
    );
  }
  
  return sections.join('\n');
}

/**
 * Get recommendations for fixing the error
 *
 * @param error The analyzed error
 * @returns List of recommendations
 */
export function getErrorRecommendations(error: TraceError): string[] {
  // Start with the suggestions from error analysis
  const recommendations = [...(error.suggestions || [])];
  
  // Add category-specific recommendations
  switch (error.category) {
    case 'connection':
      recommendations.push(
        'Check if any firewalls might be blocking the connection',
        'Verify DNS resolution is working correctly'
      );
      break;
    case 'rate-limit':
      recommendations.push(
        'Consider implementing a queue system for API requests',
        'Add exponential backoff with jitter for retries'
      );
      break;
    case 'timeout':
      recommendations.push(
        'Consider optimizing the search queries to be more specific',
        'Modify the Firecrawl search parameters to reduce response size'
      );
      break;
    case 'memory':
      recommendations.push(
        'Consider streaming large responses instead of loading entirely in memory',
        'Implement pagination when processing large datasets'
      );
      break;
  }
  
  // Add general debugging recommendations
  recommendations.push(
    'Review the complete logs for additional context',
    'Try running with reduced breadth and depth parameters',
    'Check for similar errors in the job history'
  );
  
  return recommendations;
}