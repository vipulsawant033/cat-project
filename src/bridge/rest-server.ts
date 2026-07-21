import 'dotenv/config';
import cors from 'cors';
import express from 'express';
import { createBridgeRouter } from './routes.js';
import { shutdownPreview } from '../preview/manager.js';

/**
 * Standalone REST bridge for AI tools that don't support MCP directly.
 * Runs independently of the MCP stdio server (src/index.ts) — both share
 * the same core logic in src/core, so results are identical either way.
 *
 * Start with: npm run bridge   (after `npm run build`)
 *          or: npm run bridge:dev
 */
const app = express();
app.use(cors());
app.use(express.json({ limit: '2mb' }));
app.use(createBridgeRouter());

const port = Number(process.env.BRIDGE_PORT ?? 4000);
app.listen(port, () => {
  console.log(`[figma-angular-mcp-vipul] REST bridge listening on http://localhost:${port}`);
  console.log(`  GET  /health`);
  console.log(`  GET  /tools`);
  console.log(`  POST /tools/generate-angular-component`);
});

// Don't leave an orphaned `ng serve` preview process running after this server exits.
process.on('SIGINT', () => { shutdownPreview(); process.exit(0); });
process.on('SIGTERM', () => { shutdownPreview(); process.exit(0); });
process.on('exit', shutdownPreview);
