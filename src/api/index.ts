/**
 * API Server
 *
 * Express-based REST API server for deep research
 */

import express from 'express';
import cors from 'cors';
import bodyParser from 'body-parser';

import { config } from '../config';
import researchRoutes from './routes/research';
import { telemetry } from '../ai/telemetry';

// Initialize Express app
const app = express();
const PORT = config.server.port;

// Configure middleware
app.use(cors());
app.use(bodyParser.json());

// Add base routes
app.use('/api/research', researchRoutes);

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    environment: config.server.environment,
    telemetry: telemetry.isEnabled ? 'enabled' : 'disabled',
    timestamp: new Date().toISOString()
  });
});

// Start server
export function startServer() {
  return new Promise<void>((resolve) => {
    const server = app.listen(PORT, () => {
      console.log(`Deep Research API server is running on port ${PORT}`);
      resolve();
    });
    
    // Handle graceful shutdown
    process.on('SIGTERM', async () => {
      console.log('SIGTERM received, shutting down gracefully');
      await telemetry.shutdownTelemetry();
      server.close(() => {
        console.log('Server closed');
        process.exit(0);
      });
    });
  });
}

// Start the server if this module is run directly
if (require.main === module) {
  startServer().catch(console.error);
}

export default app;