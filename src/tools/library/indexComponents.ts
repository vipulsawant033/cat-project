import * as fs from 'fs';
import * as path from 'path';
import { ComponentIndex } from '../../services/componentIndex.js';
import { AngularParser } from '../../parsers/angularParser.js';
import { logger } from '../../utils/logger.js';

export async function libIndexComponents(args: {
  sourcePath?: string;
  type?: 'angular' | 'all';
  force?: boolean;
}) {
  const sourcePath = args.sourcePath || process.env.ANGULAR_SOURCE_PATH;
  if (!sourcePath) throw new Error('sourcePath or ANGULAR_SOURCE_PATH required');
  if (!fs.existsSync(sourcePath)) throw new Error(`Source path not found: ${sourcePath}`);

  const index = new ComponentIndex();
  const parser = new AngularParser();
  const errors: string[] = [];
  let indexed = 0;
  let updated = 0;

  function walk(dir: string): void {
    for (const file of fs.readdirSync(dir)) {
      const full = path.join(dir, file);
      const stat = fs.statSync(full);
      if (stat.isDirectory()) {
        walk(full);
      } else if (file.endsWith('.ts') && !file.endsWith('.d.ts') && !file.endsWith('.spec.ts')) {
        try {
          const rec = parser.parseFile(full);
          if (rec) {
            const existing = index.getBySelector(rec.selector);
            index.upsert(rec);
            if (existing) updated++;
            else indexed++;
          }
        } catch (err) {
          errors.push(`${full}: ${String(err)}`);
          logger.error('Failed to index component', { file: full, error: String(err) });
        }
      }
    }
  }

  walk(sourcePath);

  return { indexed, updated, errors, totalAngular: index.count('angular') };
}
