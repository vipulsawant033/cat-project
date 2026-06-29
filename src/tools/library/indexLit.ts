import * as fs from 'fs';
import * as path from 'path';
import { ComponentIndex } from '../../services/componentIndex.js';
import { LitParser } from '../../parsers/litParser.js';
import { logger } from '../../utils/logger.js';

export async function libIndexLit(args: { litSourcePath?: string; force?: boolean }) {
  const sourcePath = args.litSourcePath || process.env.LIT_SOURCE_PATH;
  if (!sourcePath) throw new Error('litSourcePath or LIT_SOURCE_PATH required');
  if (!fs.existsSync(sourcePath)) throw new Error(`Lit source path not found: ${sourcePath}`);

  const index = new ComponentIndex();
  const parser = new LitParser();
  const errors: string[] = [];
  const tagNames: string[] = [];
  let indexed = 0;
  let updated = 0;

  function walk(dir: string): void {
    for (const file of fs.readdirSync(dir)) {
      const full = path.join(dir, file);
      const stat = fs.statSync(full);
      if (stat.isDirectory()) {
        walk(full);
      } else if (file.endsWith('.ts') && !file.endsWith('.spec.ts') && !file.endsWith('.d.ts')) {
        try {
          const rec = parser.parseFile(full);
          if (rec) {
            const existing = index.getBySelector(rec.selector);
            index.upsert(rec);
            tagNames.push(rec.selector);
            if (existing) updated++;
            else indexed++;
          }
        } catch (err) {
          errors.push(`${full}: ${String(err)}`);
          logger.error('Failed to index Lit component', { file: full, error: String(err) });
        }
      }
    }
  }

  walk(sourcePath);

  return { indexed, updated, tagNames, errors, totalLit: index.count('lit') };
}
