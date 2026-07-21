import { Router } from 'express';
import { runGenerateAngularComponent } from '../core/generate-angular-component.js';
import { GenerateAngularComponentInput } from '../types.js';

/**
 * REST bridge routes. Each route wraps one MCP tool so AI systems that only
 * speak plain HTTP/JSON (custom GPT Actions, LangChain HTTP tools, internal
 * agent frameworks, curl/Postman, etc.) can use the same functionality as
 * MCP-native clients, without needing an MCP client implementation.
 *
 * To expose a new tool over REST: add a route here calling the same
 * src/core/<tool>.ts function used by its MCP tool registration, and add an
 * entry to the TOOL_MANIFEST below so GET /tools stays accurate.
 */

const TOOL_MANIFEST = [
  {
    name: 'generate_angular_component',
    method: 'POST',
    path: '/tools/generate-angular-component',
    description:
      'Fetches a Figma component/frame from a share link and generates an equivalent standalone ' +
      'Angular component (TypeScript, HTML template, and SCSS). By default also serves it on a local ' +
      'Angular dev server (see `serve` / the response\'s `preview` field) — requires the one-time ' +
      '`npm run preview:setup` to have been run first.',
    exampleRequestBody: {
      figmaLink: 'https://www.figma.com/design/<fileKey>/<title>?node-id=12-34',
      writeToDisk: false,
      serve: true,
    },
  },
];

export function createBridgeRouter(): Router {
  const router = Router();

  router.get('/health', (_req, res) => {
    res.json({ status: 'ok' });
  });

  router.get('/tools', (_req, res) => {
    res.json({ tools: TOOL_MANIFEST });
  });

  router.post('/tools/generate-angular-component', async (req, res) => {
    const parsed = GenerateAngularComponentInput.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid request body', details: parsed.error.flatten() });
      return;
    }

    try {
      const output = await runGenerateAngularComponent(parsed.data);
      res.json(output);
    } catch (err) {
      res.status(502).json({ error: err instanceof Error ? err.message : 'Unknown error' });
    }
  });

  return router;
}
