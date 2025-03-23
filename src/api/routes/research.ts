/**
 * Research API Routes
 *
 * REST API endpoints for research operations
 */

import { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';
import * as fs from 'fs';

import { runResearch } from '../../services/research';
import { ResearchOptions, JobStatus, ResearchProgress } from '../../interfaces';
import { OutputManager } from '../../utils/output-manager';
import { config } from '../../config';
import { createResearchTrace } from '../../ai/telemetry';

// Job storage
const jobs = new Map<string, JobStatus>();

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
        
        // Create telemetry trace for this job
        const { traceId } = createResearchTrace('api-research-job', {
          jobId,
          query: options.query,
          breadth: options.breadth || config.research.defaultBreadth,
          depth: options.depth || config.research.defaultDepth
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
        
        // Run research with SSE output manager and progress tracking
        const result = await runResearch({
          ...options,
          outputDir,
          traceId,
          onProgress: (progress) => {
            // Extract research goal
            const progressWithGoal = {
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
        });
        
        // Update job status on completion
        jobStatus.status = 'completed';
        jobStatus.result = result;
        jobStatus.updatedAt = new Date();
        
        // Notify SSE clients of completion
        if (jobStatus.sseClients) {
          for (const client of jobStatus.sseClients) {
            client.write(`data: ${JSON.stringify({ type: 'completed', result })}\n\n`);
            client.end();
          }
        }
      } catch (error) {
        // Update job status on error
        jobStatus.status = 'failed';
        jobStatus.error = error instanceof Error ? error.message : String(error);
        jobStatus.updatedAt = new Date();
        
        // Notify SSE clients of error
        if (jobStatus.sseClients) {
          for (const client of jobStatus.sseClients) {
            client.write(`data: ${JSON.stringify({ type: 'error', error: jobStatus.error })}\n\n`);
            client.end();
          }
        }
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
    res.end();
    return;
  }
  
  // Send error if failed
  if (job.status === 'failed' && job.error) {
    res.write(`data: ${JSON.stringify({ type: 'error', error: job.error })}\n\n`);
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
  
  // Return job status
  res.json({
    jobId,
    status: job.status,
    progress: job.progress,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    ...(job.status === 'completed' && { result: job.result }),
    ...(job.status === 'failed' && { error: job.error })
  });
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
  
  // Check job status
  if (job.status !== 'completed') {
    return res.status(400).json({ error: 'Research is not completed yet' });
  }
  
  // Check report path
  const reportPath = job.result?.reportPath;
  if (!reportPath || !fs.existsSync(reportPath)) {
    return res.status(404).json({ error: 'Report file not found' });
  }
  
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
  
  // Check log path
  const logPath = job.result?.logPath;
  if (!logPath || !fs.existsSync(logPath)) {
    return res.status(404).json({ error: 'Log file not found' });
  }
  
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
  
  // Check job status
  if (job.status !== 'completed') {
    return res.status(400).json({ error: 'Research is not completed yet' });
  }
  
  // Check action plan path
  const actionPlanPath = job.result?.actionPlanPath;
  if (!actionPlanPath || !fs.existsSync(actionPlanPath)) {
    return res.status(404).json({ error: 'Action plan file not found' });
  }
  
  // Send file
  res.download(actionPlanPath);
});

export default router;