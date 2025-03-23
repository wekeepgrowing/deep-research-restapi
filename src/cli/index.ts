/**
 * CLI Application
 *
 * Command-line interface for running research operations
 */

import * as readline from 'readline';
import { v4 as uuidv4 } from 'uuid';

import { config } from '../config';
import { runResearch } from '../services/research';
import { OutputManager } from '../utils/output-manager';
import { createResearchTrace, telemetry, shutdownTelemetry } from '../ai/telemetry';

// Create readline interface for CLI
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

// Helper function to get user input
function askQuestion(query: string): Promise<string> {
  return new Promise((resolve) => {
    rl.question(query, (answer) => {
      resolve(answer);
    });
  });
}

/**
 * Run the CLI application
 */
export async function run() {
  try {
    // Create timestamp for log filename
    const timestamp = new Date().toISOString().replace(/:/g, '-').replace(/\./g, '-');
    const logFileName = `${config.paths.defaultLogFilename}_${timestamp}.txt`;
    
    // Initialize output manager
    const output = new OutputManager(logFileName);
    
    // Helper for consistent logging
    function log(...args: any[]) {
      output.log(...args);
    }
    
    // Start log
    log(`=== Deep Research CLI Started ===`);
    log(`Log file: ${logFileName}`);
    
    // Get initial query
    const initialQuery = await askQuestion('What project or task would you like to research? ');
    log(`Initial Query: ${initialQuery}`);
    
    // Get breadth and depth parameters
    const breadthInput = await askQuestion(`Enter research breadth (recommended 2-10, default ${config.research.defaultBreadth}): `);
    const breadth = parseInt(breadthInput, 10) || config.research.defaultBreadth;
    
    const depthInput = await askQuestion(`Enter research depth (recommended 1-5, default ${config.research.defaultDepth}): `);
    const depth = parseInt(depthInput, 10) || config.research.defaultDepth;
    
    log(`Research Parameters: Breadth=${breadth}, Depth=${depth}`);
    
    // Create telemetry trace
    const { traceId } = createResearchTrace('cli-research', {
      query: initialQuery,
      breadth,
      depth
    });
    
    // Start research
    log('\nResearching your topic...\n');
    
    // Run the research
    const result = await runResearch({
      query: initialQuery,
      breadth,
      depth,
      traceId,
      onProgress: (progress) => {
        output.updateProgress(progress);
      },
    });
    
    // Display results
    log(`\n\nLearnings:\n\n${result.learnings.join('\n')}`);
    log(`\n\nVisited URLs (${result.visitedUrls.length}):\n\n${result.visitedUrls.join('\n')}`);
    
    // Display report info
    log(`\n\nFinal Report has been saved to ${result.reportPath}`);
    if (result.actionPlanPath) {
      log(`Action Plan has been saved to ${result.actionPlanPath}`);
    }
    
    log(`\n=== Deep Research CLI Completed ===`);
    
    // Clean up
    rl.close();
    await shutdownTelemetry();
  } catch (error) {
    console.error('Error running research:', error);
    rl.close();
    process.exit(1);
  }
}

// Run CLI if this module is executed directly
if (require.main === module) {
  run().catch((err) => {
    console.error('Unhandled error:', err);
    process.exit(1);
  });
}