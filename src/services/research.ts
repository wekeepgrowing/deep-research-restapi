/**
 * Research Service
 *
 * Coordinates research operations and integrates components
 */

import * as fs from 'fs';
import * as path from 'path';

import { config } from '../config';
import { OutputManager } from '../utils/output-manager';
import { ResearchOptions, ResearchResult, ResearchProgress } from '../interfaces';
import { deepResearch } from '../core/research/engine';
import { writeFinalReport, writeActionPlan } from '../core/report';
import { createResearchTrace, telemetry } from '../ai/telemetry';

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
  
  // Ensure output directory exists
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }
  
  // Set file paths
  const logPath = path.join(outputDir, logFileName);
  const reportPath = path.join(outputDir, reportFileName);
  const actionPlanPath = path.join(outputDir, actionPlanFileName);
  
  // Initialize output manager
  const output = new OutputManager(logPath);
  
  // Create research trace for telemetry if enabled
  const { traceId, trace } = createResearchTrace('deep-research', {
    query: options.query,
    breadth,
    depth,
    outputDir
  });
  
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
  
  try {
    // Perform deep research
    const { learnings, visitedUrls } = await deepResearch({
      query: options.query,
      breadth,
      depth,
      onProgress: options.onProgress,
      output,
      traceId,
    });
    
    log(`\nResearch completed with ${learnings.length} learnings and ${visitedUrls.length} visited URLs`);
    
    // Generate final report
    log('\nWriting final report...');
    const finalReport = await writeFinalReport({
      prompt: options.query,
      learnings,
      visitedUrls,
      traceId,
    });
    
    // Save report to file
    fs.writeFileSync(reportPath, finalReport, 'utf-8');
    log(`Final report saved to ${reportPath}`);
    
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
      });
      
      // Save action plan to file
      fs.writeFileSync(actionPlanPath, JSON.stringify(actionPlan, null, 2), 'utf-8');
      log(`Action plan saved to ${actionPlanPath}`);
    } catch (e) {
      log(`Error generating action plan: ${e}`);
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
    throw error;
  } finally {
    if (trace) {
      trace.update({ status: 'completed' });
    }
  }
}