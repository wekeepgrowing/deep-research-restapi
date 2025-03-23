/**
 * Research API Routes
 *
 * REST API endpoints for research operations
 */

import { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';
import * as fs from 'fs';
import * as path from 'path';

import { runResearch, analyzeResearchError } from '../../services/research';
import { ResearchOptions, JobStatus, ResearchProgress, TraceError } from '../../interfaces';
import { OutputManager } from '../../utils/output-manager';
import { config } from '../../config';
import { createResearchTraceManager, TraceManager } from '../../ai/telemetry';
import { analyzeError, createErrorReport } from '../../utils/error-analyzer';

// Job storage
const jobs = new Map<string, JobStatus>();

// Store trace managers for active jobs
const traceManagers = new Map<string, TraceManager>();

// Router instance
const router = Router();

// Periodically clean up old jobs
setInterval(() => {
  const now = new Date();
  for (const [id, job] of jobs.entries()) {
    const ageHours = (now.getTime() - job.createdAt.getTime()) / (1000 * 60 * 60);
    if (ageHours > config.research.fileRetentionHours) {
      // Close SSE connections
      if (job.sseClients) {
        for (const client of job.sseClients) {
          client.end();
        }
      }
      
      // Complete trace if exists
      const traceManager = traceManagers.get(id);
      if (traceManager) {
        traceManager.finishTrace('success', {
          reason: 'job_retention_cleanup',
          jobAge: `${ageHours.toFixed(2)} hours`
        });
        traceManagers.delete(id);
      }
      
      jobs.delete(id);
    }
  }
}, 1000 * 60 * 60); // Check every hour

/**
 * POST /api/research
 * Start a new research job
 */
router.post('/', async (req, res) => {
  try {
    const options: ResearchOptions = req.body;
    
    // Validate required parameters
    if (!options.query) {
      return res.status(400).json({ error: 'Query parameter is required' });
    }
    
    // Generate job ID
    const jobId = uuidv4();
    
    // Create trace manager for this job - 이것이 루트 트레이스가 됨
    const { traceManager, traceId } = createResearchTraceManager(
      'api-research-job',
      {
        jobId,
        query: options.query,
        breadth: options.breadth || config.research.defaultBreadth,
        depth: options.depth || config.research.defaultDepth,
        debug: options.debug || false,
        source: 'api',
        startedAt: new Date().toISOString()
      },
      req.headers['x-session-id'] as string,
      req.headers['x-user-id'] as string
    );
    
    // Store trace manager
    traceManagers.set(jobId, traceManager);
    
    // Initialize job status
    const jobStatus: JobStatus = {
      id: jobId,
      status: 'pending',
      createdAt: new Date(),
      updatedAt: new Date(),
      logs: [],
      sseClients: new Set()
    };
    
    // Store job
    jobs.set(jobId, jobStatus);
    
    // Start research process asynchronously
    process.nextTick(async () => {
      // Start a span for job setup
      const setupSpanId = traceManager.startSpan('job-setup', {
        stage: 'initialization',
        timestamp: new Date().toISOString()
      });
      
      try {
        // Update job status
        jobStatus.status = 'running';
        jobStatus.updatedAt = new Date();
        
        // Configure output directory
        const outputDir = options.outputDir || `${config.paths.resultsDir}/${jobId}`;
        
        // Ensure directory exists
        if (!fs.existsSync(outputDir)) {
          fs.mkdirSync(outputDir, { recursive: true });
        }
        
        // End setup span
        traceManager.endSpan(setupSpanId, {
          status: 'success',
          outputDir
        });
        
        // Custom OutputManager for SSE
        class SSEOutputManager extends OutputManager {
          log(...args: any[]) {
            super.log(...args);
            
            // Format message
            const message = args.map(arg =>
              typeof arg === 'object' ? JSON.stringify(arg, null, 2) : String(arg)
            ).join(' ');
            
            // Save log
            if (jobStatus.logs) {
              jobStatus.logs.push(message);
            }
            
            // Send to SSE clients
            if (jobStatus.sseClients) {
              for (const client of jobStatus.sseClients) {
                client.write(`data: ${JSON.stringify({ type: 'log', message })}\n\n`);
              }
            }
          }
          
          updateProgress(progress: ResearchProgress) {
            super.updateProgress(progress);
            
            // Add research goal if missing
            const progressWithGoal = progress.researchGoal
              ? progress
              : {
                  ...progress,
                  researchGoal: getResearchGoal(progress)
                };
            
            // Update job status
            jobStatus.progress = progressWithGoal;
            jobStatus.updatedAt = new Date();
            
            // Send to SSE clients
            if (jobStatus.sseClients) {
              for (const client of jobStatus.sseClients) {
                client.write(`data: ${JSON.stringify({ type: 'progress', progress: progressWithGoal })}\n\n`);
              }
            }
          }
        }
        
        // Helper to extract research goal from progress
        function getResearchGoal(progress: ResearchProgress): string {
          if (progress.researchGoal) {
            return progress.researchGoal;
          }
          
          if (progress.currentQuery) {
            if (typeof progress.currentQuery === 'object') {
              if (progress.currentQuery.researchGoal) {
                return progress.currentQuery.researchGoal;
              }
              if (progress.currentQuery.query) {
                return progress.currentQuery.query;
              }
            } else if (typeof progress.currentQuery === 'string') {
              return progress.currentQuery;
            }
          }
          
          return options.query;
        }
        
        // Prepare output manager
        const logPath = path.join(outputDir, `research_log_${jobId}.txt`);
        const output = new SSEOutputManager(logPath);
        
        // Start research process span
        const researchProcessSpanId = traceManager.startSpan('research-process', {
          query: options.query,
          breadth: options.breadth || config.research.defaultBreadth,
          depth: options.depth || config.research.defaultDepth,
          timestamp: new Date().toISOString()
        });
        
        // Run research with SSE output manager and progress tracking
        try {
          const result = await runResearch({
            ...options,
            outputDir,
            traceId, // 루트 트레이스 ID 전달
            debug: true, // Always enable debugging for API jobs
            onProgress: (progress) => {
              // Extract research goal
              const progressWithGoal = {
                ...progress,
                researchGoal: getResearchGoal(progress)
              };
              
              // Update job status
              jobStatus.progress = progressWithGoal;
              jobStatus.updatedAt = new Date();
              
              // Update trace with progress
              traceManager.updateTraceMetadata({
                currentProgress: progressWithGoal,
                updatedAt: new Date().toISOString()
              });
              
              // Send to SSE clients
              if (jobStatus.sseClients) {
                for (const client of jobStatus.sseClients) {
                  client.write(`data: ${JSON.stringify({ type: 'progress', progress: progressWithGoal })}\n\n`);
                }
              }
            }
          });
          
          // End research process span
          traceManager.endSpan(researchProcessSpanId, {
            status: 'success',
            learningsCount: result.learnings.length,
            urlsCount: result.visitedUrls.length,
            completedAt: new Date().toISOString()
          });
          
          // Update job status on completion
          jobStatus.status = 'completed';
          jobStatus.result = result;
          jobStatus.updatedAt = new Date();
          
          // Complete the trace
          await traceManager.finishTrace('success', {
            totalLearnings: result.learnings.length,
            totalUrls: result.visitedUrls.length,
            completionTime: new Date().toISOString(),
            executionTime: (new Date().getTime() - jobStatus.createdAt.getTime()) / 1000
          });
          
          // Notify SSE clients of completion
          if (jobStatus.sseClients) {
            for (const client of jobStatus.sseClients) {
              client.write(`data: ${JSON.stringify({ type: 'completed', result })}\n\n`);
              client.end();
            }
          }
        } catch (error) {
          // End research span with error
          traceManager.endSpan(researchProcessSpanId, {
            status: 'error',
            error: error instanceof Error ? error.message : String(error),
            timestamp: new Date().toISOString()
          });
          
          // Log the error
          output.log(`\n=== Error in Research Process ===`);
          output.log(error.message || error);
          
          // Create context for error analysis
          const errorContext = {
            jobId,
            query: options.query,
            breadth: options.breadth || config.research.defaultBreadth,
            depth: options.depth || config.research.defaultDepth,
            outputDir,
            traceId,
            timestamp: new Date().toISOString()
          };
          
          // Start error analysis span
          const errorSpanId = traceManager.startSpan('error-analysis', {
            stage: 'error-handling',
            errorType: error.constructor.name,
            errorMessage: error instanceof Error ? error.message : String(error),
            timestamp: new Date().toISOString()
          });
          
          // Generate error analysis
          let errorDetails: TraceError | undefined;
          try {
            errorDetails = await analyzeResearchError(jobId, error, errorContext);
            
            // Create and save error report
            const errorReport = createErrorReport(errorDetails, errorContext);
            const errorReportPath = path.join(outputDir, `error_report_${jobId}.md`);
            fs.writeFileSync(errorReportPath, errorReport, 'utf-8');
            output.log(`Detailed error report saved to ${errorReportPath}`);
            
            // Add recommendations to logs
            if (errorDetails.suggestions && errorDetails.suggestions.length > 0) {
              output.log('\n=== Error Recovery Recommendations ===');
              errorDetails.suggestions.forEach((suggestion, i) => {
                output.log(`${i+1}. ${suggestion}`);
              });
            }
            
            // End error analysis span
            traceManager.endSpan(errorSpanId, {
              status: 'success',
              errorCategory: errorDetails.category,
              suggestions: errorDetails.suggestions,
              errorReportPath
            });
          } catch (analysisError) {
            output.log(`Error during error analysis: ${analysisError}`);
            
            // End error analysis span with error
            traceManager.endSpan(errorSpanId, {
              status: 'error',
              error: analysisError instanceof Error ? analysisError.message : String(analysisError)
            });
          }
          
          // Update job status on error
          jobStatus.status = 'failed';
          jobStatus.error = error instanceof Error ? error.message : String(error);
          jobStatus.errorDetails = errorDetails;
          jobStatus.updatedAt = new Date();
          
          // Complete trace with error status
          await traceManager.finishTrace('error', {
            error: error instanceof Error ? error.message : String(error),
            errorCategory: errorDetails?.category || 'unknown',
            failureTime: new Date().toISOString(),
            executionTime: (new Date().getTime() - jobStatus.createdAt.getTime()) / 1000
          });
          
          // Notify SSE clients of error
          if (job.sseClients) {
            for (const client of job.sseClients) {
              client.write(`data: ${JSON.stringify({
                type: 'error',
                error: jobStatus.error,
                errorDetails: errorDetails
              })}\n\n`);
              client.end();
            }
          }
        }
      } catch (setupError) {
        // End setup span with error
        traceManager.endSpan(setupSpanId, {
          status: 'error',
          error: setupError instanceof Error ? setupError.message : String(setupError),
        });
        
        // Handle errors in the setup process
        jobStatus.status = 'failed';
        jobStatus.error = setupError instanceof Error ? setupError.message : String(setupError);
        jobStatus.updatedAt = new Date();
        
        // Start error analysis span
        const errorSpanId = traceManager.startSpan('setup-error-analysis', {
          stage: 'error-handling',
          errorType: setupError.constructor.name,
          errorMessage: setupError instanceof Error ? setupError.message : String(setupError),
          timestamp: new Date().toISOString()
        });
        
        // Basic error analysis
        try {
          const errorDetails = analyzeError(setupError, {
            jobId,
            phase: 'job-setup',
            timestamp: new Date().toISOString()
          });
          jobStatus.errorDetails = errorDetails;
          
          // End error analysis span
          traceManager.endSpan(errorSpanId, {
            status: 'success',
            errorCategory: errorDetails.category,
            suggestions: errorDetails.suggestions
          });
          
          // Notify SSE clients of error
          if (jobStatus.sseClients) {
            for (const client of jobStatus.sseClients) {
              client.write(`data: ${JSON.stringify({
                type: 'error',
                error: jobStatus.error,
                errorDetails: errorDetails
              })}\n\n`);
              client.end();
            }
          }
        } catch (analysisError) {
          console.error('Error during setup error analysis:', analysisError);
          
          // End error analysis span with error
          traceManager.endSpan(errorSpanId, {
            status: 'error',
            error: analysisError instanceof Error ? analysisError.message : String(analysisError)
          });
          
          // Notify SSE clients of error without details
          if (jobStatus.sseClients) {
            for (const client of jobStatus.sseClients) {
              client.write(`data: ${JSON.stringify({
                type: 'error',
                error: jobStatus.error
              })}\n\n`);
              client.end();
            }
          }
        }
        
        // Complete trace with error status
        await traceManager.finishTrace('error', {
          error: setupError instanceof Error ? setupError.message : String(setupError),
          stage: 'setup',
          failureTime: new Date().toISOString(),
          executionTime: (new Date().getTime() - jobStatus.createdAt.getTime()) / 1000
        });
      }
    });
    
    // Return job information
    res.status(202).json({
      jobId,
      message: 'Research job started',
      status: 'pending'
    });
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

/**
 * GET /api/research/:jobId/stream
 * Stream job progress using SSE
 */
router.get('/:jobId/stream', (req, res) => {
  const { jobId } = req.params;
  
  // Find job
  const job = jobs.get(jobId);
  if (!job) {
    return res.status(404).json({ error: 'Job not found' });
  }
  
  // Create span for SSE connection
  const traceManager = traceManagers.get(jobId);
  const sseSpanId = traceManager?.startSpan('sse-connection', {
    source: 'client',
    ip: req.ip,
    userAgent: req.headers['user-agent'],
    timestamp: new Date().toISOString()
  });
  
  // Set SSE headers
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  
  // Send headers
  res.flushHeaders();
  
  // Send existing logs
  if (job.logs) {
    for (const logMessage of job.logs) {
      res.write(`data: ${JSON.stringify({ type: 'log', message: logMessage })}\n\n`);
    }
  }
  
  // Send current progress
  if (job.progress) {
    res.write(`data: ${JSON.stringify({ type: 'progress', progress: job.progress })}\n\n`);
  }
  
  // Send current status
  res.write(`data: ${JSON.stringify({ type: 'status', status: job.status })}\n\n`);
  
  // Send result if completed
  if (job.status === 'completed' && job.result) {
    res.write(`data: ${JSON.stringify({ type: 'completed', result: job.result })}\n\n`);
    traceManager?.endSpan(sseSpanId, {
      status: 'success',
      result: 'completed',
      timestamp: new Date().toISOString()
    });
    res.end();
    return;
  }
  
  // Send error if failed
  if (job.status === 'failed') {
    const errorResponse = {
      type: 'error',
      error: job.error,
      ...(job.errorDetails && { errorDetails: job.errorDetails })
    };
    res.write(`data: ${JSON.stringify(errorResponse)}\n\n`);
    traceManager?.endSpan(sseSpanId, {
      status: 'success',
      result: 'error',
      timestamp: new Date().toISOString()
    });
    res.end();
    return;
  }
  
  // Register client
  if (!job.sseClients) {
    job.sseClients = new Set();
  }
  job.sseClients.add(res);
  
  // Clean up on client disconnect
  req.on('close', () => {
    if (job.sseClients) {
      job.sseClients.delete(res);
    }
    
    traceManager?.endSpan(sseSpanId, {
      status: 'success',
      result: 'disconnected',
      duration: (new Date().getTime() - new Date().getTime()) / 1000,
      timestamp: new Date().toISOString()
    });
  });
});

/**
 * GET /api/research/:jobId
 * Get job status
 */
router.get('/:jobId', (req, res) => {
  const { jobId } = req.params;
  
  // Find job
  const job = jobs.get(jobId);
  if (!job) {
    return res.status(404).json({ error: 'Job not found' });
  }
  
  // Create span for status check
  const traceManager = traceManagers.get(jobId);
  const statusSpanId = traceManager?.startSpan('status-check', {
    source: 'client',
    ip: req.ip,
    userAgent: req.headers['user-agent'],
    timestamp: new Date().toISOString()
  });
  
  // Return job status
  const response = {
    jobId,
    status: job.status,
    progress: job.progress,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    ...(job.status === 'completed' && { result: job.result }),
    ...(job.status === 'failed' && {
      error: job.error,
      ...(job.errorDetails && { errorDetails: job.errorDetails })
    })
  };
  
  // End status check span
  traceManager?.endSpan(statusSpanId, {
    status: 'success',
    responseStatus: job.status,
    timestamp: new Date().toISOString()
  });
  
  res.json(response);
});

/**
 * GET /api/research/:jobId/error
 * Get detailed error analysis for a failed job
 */
router.get('/:jobId/error', (req, res) => {
  const { jobId } = req.params;
  const { format } = req.query;
  
  // Find job
  const job = jobs.get(jobId);
  if (!job) {
    return res.status(404).json({ error: 'Job not found' });
  }
  
  // Create span for error check
  const traceManager = traceManagers.get(jobId);
  const errorSpanId = traceManager?.startSpan('error-details-request', {
    source: 'client',
    ip: req.ip,
    userAgent: req.headers['user-agent'],
    format: format || 'json',
    timestamp: new Date().toISOString()
  });
  
  // Check job status
  if (job.status !== 'failed') {
    traceManager?.endSpan(errorSpanId, {
      status: 'error',
      reason: 'job_not_failed',
      jobStatus: job.status,
      timestamp: new Date().toISOString()
    });
    return res.status(400).json({ error: 'Job has not failed' });
  }
  
  // If error details don't exist
  if (!job.errorDetails) {
    traceManager?.endSpan(errorSpanId, {
      status: 'error',
      reason: 'no_error_details',
      timestamp: new Date().toISOString()
    });
    return res.status(404).json({ error: 'No error details available' });
  }
  
  // Return as markdown if requested
  if (format === 'markdown') {
    const errorReport = createErrorReport(job.errorDetails, {
      jobId,
      query: job.result?.query || 'Unknown query',
      startTime: job.createdAt.toISOString(),
      endTime: job.updatedAt.toISOString()
    });
    
    traceManager?.endSpan(errorSpanId, {
      status: 'success',
      format: 'markdown',
      timestamp: new Date().toISOString()
    });
    
    res.setHeader('Content-Type', 'text/markdown');
    return res.send(errorReport);
  }
  
  // Return error details as JSON (default)
  traceManager?.endSpan(errorSpanId, {
    status: 'success',
    format: 'json',
    timestamp: new Date().toISOString()
  });
  
  res.json(job.errorDetails);
});

/**
 * GET /api/research/:jobId/error/report
 * Get or generate an error report for a failed job
 */
router.get('/:jobId/error/report', (req, res) => {
  const { jobId } = req.params;
  
  // Find job
  const job = jobs.get(jobId);
  if (!job) {
    return res.status(404).json({ error: 'Job not found' });
  }
  
  // Create span for error report request
  const traceManager = traceManagers.get(jobId);
  const reportSpanId = traceManager?.startSpan('error-report-request', {
    source: 'client',
    ip: req.ip,
    userAgent: req.headers['user-agent'],
    timestamp: new Date().toISOString()
  });
  
  // Check job status
  if (job.status !== 'failed') {
    traceManager?.endSpan(reportSpanId, {
      status: 'error',
      reason: 'job_not_failed',
      jobStatus: job.status,
      timestamp: new Date().toISOString()
    });
    return res.status(400).json({ error: 'Job has not failed' });
  }
  
  // Check if error report exists
  const outputDir = `${config.paths.resultsDir}/${jobId}`;
  const errorReportPath = path.join(outputDir, `error_report_${jobId}.md`);
  
  if (fs.existsSync(errorReportPath)) {
    // Send existing report
    traceManager?.endSpan(reportSpanId, {
      status: 'success',
      reportType: 'existing',
      timestamp: new Date().toISOString()
    });
    return res.download(errorReportPath);
  }
  
  // Generate report if error details exist
  if (job.errorDetails) {
    try {
      // Create error report
      const errorReport = createErrorReport(job.errorDetails, {
        jobId,
        query: job.result?.query || 'Unknown query',
        startTime: job.createdAt.toISOString(),
        endTime: job.updatedAt.toISOString()
      });
      
      // Ensure directory exists
      if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir, { recursive: true });
      }
      
      // Save report
      fs.writeFileSync(errorReportPath, errorReport, 'utf-8');
      
      traceManager?.endSpan(reportSpanId, {
        status: 'success',
        reportType: 'generated',
        timestamp: new Date().toISOString()
      });
      
      // Send report
      res.download(errorReportPath);
    } catch (error) {
      traceManager?.endSpan(reportSpanId, {
        status: 'error',
        reason: 'generation_failed',
        error: error instanceof Error ? error.message : String(error),
        timestamp: new Date().toISOString()
      });
      
      res.status(500).json({
        error: 'Failed to generate error report',
        details: error instanceof Error ? error.message : String(error)
      });
    }
  } else {
    traceManager?.endSpan(reportSpanId, {
      status: 'error',
      reason: 'no_error_details',
      timestamp: new Date().toISOString()
    });
    
    res.status(404).json({ error: 'No error details available to generate report' });
  }
});

/**
 * GET /api/research/:jobId/report
 * Download research report
 */
router.get('/:jobId/report', (req, res) => {
  const { jobId } = req.params;
  
  // Find job
  const job = jobs.get(jobId);
  if (!job) {
    return res.status(404).json({ error: 'Job not found' });
  }
  
  // Create span for report download
  const traceManager = traceManagers.get(jobId);
  const downloadSpanId = traceManager?.startSpan('report-download', {
    source: 'client',
    ip: req.ip,
    userAgent: req.headers['user-agent'],
    timestamp: new Date().toISOString()
  });
  
  // Check job status
  if (job.status !== 'completed') {
    traceManager?.endSpan(downloadSpanId, {
      status: 'error',
      reason: 'job_not_completed',
      jobStatus: job.status,
      timestamp: new Date().toISOString()
    });
    return res.status(400).json({ error: 'Research is not completed yet' });
  }
  
  // Check report path
  const reportPath = job.result?.reportPath;
  if (!reportPath || !fs.existsSync(reportPath)) {
    traceManager?.endSpan(downloadSpanId, {
      status: 'error',
      reason: 'report_not_found',
      timestamp: new Date().toISOString()
    });
    return res.status(404).json({ error: 'Report file not found' });
  }
  
  // Track download in trace
  traceManager?.endSpan(downloadSpanId, {
    status: 'success',
    fileSize: fs.statSync(reportPath).size,
    timestamp: new Date().toISOString()
  });
  
  // Send file
  res.download(reportPath);
});

/**
 * GET /api/research/:jobId/log
 * Download research log
 */
router.get('/:jobId/log', (req, res) => {
  const { jobId } = req.params;
  
  // Find job
  const job = jobs.get(jobId);
  if (!job) {
    return res.status(404).json({ error: 'Job not found' });
  }
  
  // Create span for log download
  const traceManager = traceManagers.get(jobId);
  const downloadSpanId = traceManager?.startSpan('log-download', {
    source: 'client',
    ip: req.ip,
    userAgent: req.headers['user-agent'],
    timestamp: new Date().toISOString()
  });
  
  // Check log path
  const logPath = job.result?.logPath;
  if (!logPath || !fs.existsSync(logPath)) {
    // Try to find log in the default location
    const defaultLogPath = path.join(config.paths.resultsDir, jobId, `research_log_${jobId}.txt`);
    if (fs.existsSync(defaultLogPath)) {
      traceManager?.endSpan(downloadSpanId, {
        status: 'success',
        fileSize: fs.statSync(defaultLogPath).size,
        filePath: 'default',
        timestamp: new Date().toISOString()
      });
      return res.download(defaultLogPath);
    }
    
    traceManager?.endSpan(downloadSpanId, {
      status: 'error',
      reason: 'log_not_found',
      timestamp: new Date().toISOString()
    });
    return res.status(404).json({ error: 'Log file not found' });
  }
  
  // Track download in trace
  traceManager?.endSpan(downloadSpanId, {
    status: 'success',
    fileSize: fs.statSync(logPath).size,
    filePath: 'result',
    timestamp: new Date().toISOString()
  });
  
  // Send file
  res.download(logPath);
});

/**
 * GET /api/research/:jobId/action-plan
 * Download action plan
 */
router.get('/:jobId/action-plan', (req, res) => {
  const { jobId } = req.params;
  
  // Find job
  const job = jobs.get(jobId);
  if (!job) {
    return res.status(404).json({ error: 'Job not found' });
  }
  
  // Create span for action plan download
  const traceManager = traceManagers.get(jobId);
  const downloadSpanId = traceManager?.startSpan('action-plan-download', {
    source: 'client',
    ip: req.ip,
    userAgent: req.headers['user-agent'],
    timestamp: new Date().toISOString()
  });
  
  // Check job status
  if (job.status !== 'completed') {
    traceManager?.endSpan(downloadSpanId, {
      status: 'error',
      reason: 'job_not_completed',
      jobStatus: job.status,
      timestamp: new Date().toISOString()
    });
    return res.status(400).json({ error: 'Research is not completed yet' });
  }
  
  // Check action plan path
  const actionPlanPath = job.result?.actionPlanPath;
  if (!actionPlanPath || !fs.existsSync(actionPlanPath)) {
    traceManager?.endSpan(downloadSpanId, {
      status: 'error',
      reason: 'action_plan_not_found',
      timestamp: new Date().toISOString()
    });
    return res.status(404).json({ error: 'Action plan file not found' });
  }
  
  // Track download in trace
  traceManager?.endSpan(downloadSpanId, {
    status: 'success',
    fileSize: fs.statSync(actionPlanPath).size,
    timestamp: new Date().toISOString()
  });
  
  // Send file
  res.download(actionPlanPath);
});

export default router;