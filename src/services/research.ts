/**
 * Research Service
 *
 * Coordinates research operations and integrates components
 */

import * as fs from 'fs';
import * as path from 'path';

import { config } from '../config';
import { OutputManager } from '../utils/output-manager';
import { ResearchOptions, ResearchResult, ResearchProgress, TraceError } from '../interfaces';
import { deepResearch } from '../core/research/engine';
import { writeFinalReport, writeActionPlan } from '../core/report';
import { telemetry, TraceManager } from '../ai/telemetry';
import { analyzeError } from '../utils/error-analyzer';

/**
 * Run a complete research operation from query to final reports
 *
 * @param options Research options
 * @returns Research results with all outputs
 */
export async function runResearch(options: ResearchOptions): Promise<ResearchResult> {
  // Set default values
  const breadth = options.breadth || config.research.defaultBreadth;
  const depth = options.depth || config.research.defaultDepth;
  const outputDir = options.outputDir || config.paths.resultsDir;
  
  // Create timestamp for filenames
  const timestamp = new Date().toISOString().replace(/:/g, '-').replace(/\./g, '-');
  
  // Set filenames
  const logFileName = options.logFileName || `${config.paths.defaultLogFilename}_${timestamp}.txt`;
  const reportFileName = options.reportFileName || `${config.paths.defaultReportFilename}_${timestamp}.md`;
  const actionPlanFileName = options.actionPlanFileName || `${config.paths.defaultActionPlanFilename}_${timestamp}.json`;
  const errorReportFileName = `error_report_${timestamp}.md`;
  
  // Ensure output directory exists
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }
  
  // Set file paths
  const logPath = path.join(outputDir, logFileName);
  const reportPath = path.join(outputDir, reportFileName);
  const actionPlanPath = path.join(outputDir, actionPlanFileName);
  const errorReportPath = path.join(outputDir, errorReportFileName);
  
  // Initialize output manager
  const output = new OutputManager(logPath);
  
  // Use existing trace ID
  let traceId = options.traceId;
  if (!traceId) {
    console.warn('No traceId provided to runResearch. Telemetry tracking will be limited.');
  }
  
  // Create trace manager using existing trace
  const traceManager = new TraceManager('research-process', {
    query: options.query,
    breadth,
    depth,
    outputDir,
    debug: options.debug,
  }, undefined, undefined, traceId);
  
  // Helper for consistent logging
  function log(...args: any[]) {
    output.log(...args);
  }
  
  // Start research
  log(`=== Deep Research Started ===`);
  log(`Query: ${options.query}`);
  log(`Parameters: Breadth=${breadth}, Depth=${depth}`);
  if (telemetry.isEnabled) {
    log(`Telemetry: Enabled (Trace ID: ${traceId})`);
  }
  if (options.debug) {
    log(`Debug Mode: Enabled (Extended error reporting will be generated)`);
  }
  
  // Start initialization span
  const initSpanId = traceManager.startSpan('initialization', {
    stage: 'setup',
    query: options.query,
    breadth,
    depth,
    timestamp: new Date().toISOString()
  });
  
  // Track research progress for error context
  const researchContext = {
    query: options.query,
    breadth,
    depth,
    startTime: new Date().toISOString(),
    outputDir,
    traceId
  };
  
  // End initialization span
  traceManager.endSpan(initSpanId, {
    status: 'success',
    logPath,
    reportPath,
    actionPlanPath
  });
  
  try {
    // Start deep research span
    const researchSpanId = traceManager.startSpan('deep-research', {
      stage: 'data-collection',
      query: options.query,
      breadth,
      depth,
      timestamp: new Date().toISOString()
    });
    
    // Perform deep research
    const { learnings, visitedUrls } = await deepResearch({
      query: options.query,
      breadth,
      depth,
      onProgress: (progress) => {
        output.updateProgress(progress);
        options.onProgress?.(progress);
        
        // Update trace with progress
        traceManager.updateTraceMetadata({
          currentProgress: progress,
          timestamp: new Date().toISOString()
        });
      },
      output,
      traceId, // 상위 트레이스 ID 전달
      parentSpanId: researchSpanId, // 상위 span ID 전달
    });
    
    // End deep research span
    traceManager.endSpan(researchSpanId, {
      status: 'success',
      learningsCount: learnings.length,
      urlsCount: visitedUrls.length,
      completedAt: new Date().toISOString()
    });
    
    log(`\nResearch completed with ${learnings.length} learnings and ${visitedUrls.length} visited URLs`);
    
    // Start report generation span
    const reportSpanId = traceManager.startSpan('report-generation', {
      stage: 'synthesis',
      learningsCount: learnings.length,
      timestamp: new Date().toISOString()
    });
    
    // Generate final report
    log('\nWriting final report...');
    const finalReport = await writeFinalReport({
      prompt: options.query,
      learnings,
      visitedUrls,
      traceId,
      parentSpanId: reportSpanId, // 상위 span ID 전달
    });
    
    // Save report to file
    fs.writeFileSync(reportPath, finalReport, 'utf-8');
    log(`Final report saved to ${reportPath}`);
    
    // End report generation span
    traceManager.endSpan(reportSpanId, {
      status: 'success',
      reportLength: finalReport.length,
      reportPath,
      completedAt: new Date().toISOString()
    });
    
    // Start action plan generation span
    const actionPlanSpanId = traceManager.startSpan('action-plan-generation', {
      stage: 'synthesis',
      learningsCount: learnings.length,
      timestamp: new Date().toISOString()
    });
    
    // Generate action plan
    let actionPlan;
    try {
      log('\nGenerating action plan...');
      // Split learnings into actionable ideas and implementation considerations
      const actionableIdeas = learnings.slice(0, Math.min(learnings.length, 10));
      const implementationConsiderations = learnings.slice(Math.min(learnings.length, 10), Math.min(learnings.length, 15));
      
      // Generate action plan
      actionPlan = await writeActionPlan({
        prompt: options.query,
        actionableIdeas,
        implementationConsiderations,
        visitedUrls,
        traceId,
        parentSpanId: actionPlanSpanId, // 상위 span ID 전달
      });
      
      // Save action plan to file
      fs.writeFileSync(actionPlanPath, JSON.stringify(actionPlan, null, 2), 'utf-8');
      log(`Action plan saved to ${actionPlanPath}`);
      
      // End action plan generation span
      traceManager.endSpan(actionPlanSpanId, {
        status: 'success',
        stepsCount: actionPlan.steps.length,
        considerationsCount: actionPlan.considerations.length,
        actionPlanPath,
        completedAt: new Date().toISOString()
      });
    } catch (e) {
      log(`Error generating action plan: ${e}`);
      
      // End action plan generation span with error
      traceManager.endSpan(actionPlanSpanId, {
        status: 'error',
        error: e instanceof Error ? e.message : String(e),
        timestamp: new Date().toISOString()
      });
      
      // Analyze error and log analysis
      if (options.debug) {
        const errorInfo = analyzeError(e, {
          phase: 'action-plan-generation',
          ...researchContext
        });
        log(`Action plan error analysis: ${JSON.stringify(errorInfo, null, 2)}`);
      }
    }
    
    // Return complete result
    return {
      learnings,
      visitedUrls,
      reportPath,
      logPath,
      actionPlanPath: actionPlan ? actionPlanPath : undefined,
      report: finalReport,
      actionPlan,
      query: options.query,
    };
  } catch (error) {
    log(`\n=== Error in Research Process ===`);
    log(error);
    
    // Start error analysis span
    const errorSpanId = traceManager.startSpan('error-analysis', {
      stage: 'error-handling',
      errorType: error.constructor.name,
      errorMessage: error instanceof Error ? error.message : String(error),
      timestamp: new Date().toISOString()
    });
    
    // Enhance error with trace analysis
    let analyzedError: TraceError | undefined;
    let errorReport: string | undefined;
    
    if (options.debug) {
      try {
        // Update context with latest information
        researchContext.endTime = new Date().toISOString();
        researchContext.duration = `${(new Date().getTime() - new Date(researchContext.startTime).getTime()) / 1000}s`;
        
        // Analyze the error
        log(`\nGenerating error trace analysis...`);
        analyzedError = analyzeError(error, {
          ...researchContext,
          telemetryTraceId: traceId
        });
        
        // Generate and save error report
        const { createErrorReport } = require('../utils/error-analyzer');
        errorReport = createErrorReport(analyzedError, researchContext);
        fs.writeFileSync(errorReportPath, errorReport, 'utf-8');
        log(`Detailed error report saved to ${errorReportPath}`);
        
        // Log recommendations
        const { getErrorRecommendations } = require('../utils/error-analyzer');
        const recommendations = getErrorRecommendations(analyzedError);
        log(`\n=== Error Recovery Recommendations ===`);
        recommendations.forEach((rec: string, i: number) => log(`${i+1}. ${rec}`));
        
        // End error analysis span
        traceManager.endSpan(errorSpanId, {
          status: 'success',
          errorCategory: analyzedError.category,
          suggestions: analyzedError.suggestions,
          errorReportPath,
          completedAt: new Date().toISOString()
        });
      } catch (analysisError) {
        log(`\nError during error analysis: ${analysisError}`);
        
        // End error analysis span with error
        traceManager.endSpan(errorSpanId, {
          status: 'error',
          error: analysisError instanceof Error ? analysisError.message : String(analysisError),
          timestamp: new Date().toISOString()
        });
      }
    } else {
      // End error analysis span with minimal info
      traceManager.endSpan(errorSpanId, {
        status: 'skipped',
        reason: 'debug_disabled',
        error: error instanceof Error ? error.message : String(error),
        timestamp: new Date().toISOString()
      });
    }
    
    // Throw enhanced error
    const enhancedError: any = new Error(`Research process failed: ${error.message || error}`);
    enhancedError.originalError = error;
    enhancedError.traceAnalysis = analyzedError;
    enhancedError.errorReportPath = errorReport ? errorReportPath : undefined;
    enhancedError.researchContext = researchContext;
    throw enhancedError;
  }
}

/**
 * Get detailed error analysis for a failed research job
 *
 * @param jobId ID of the failed job
 * @param error Original error
 * @param context Additional context information
 * @returns Error analysis details
 */
export async function analyzeResearchError(
  jobId: string,
  error: any,
  context: Record<string, any>
): Promise<TraceError> {
  const { analyzeError, getErrorRecommendations } = require('../utils/error-analyzer');
  
  // Create error analysis
  const errorContext = {
    jobId,
    ...context
  };
  
  const analyzed = analyzeError(error, errorContext);
  
  // Get specific recommendations
  const recommendations = getErrorRecommendations(analyzed);
  analyzed.suggestions = recommendations;
  
  return analyzed;
}