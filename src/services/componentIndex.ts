import Database from 'better-sqlite3';
import * as path from 'path';
import * as fs from 'fs';
import { logger } from '../utils/logger.js';

export type ComponentType = 'angular' | 'lit';

export interface ComponentRecord {
  id?: number;
  selector: string;
  className: string;
  componentType: ComponentType;
  filePath: string;
  inputs: InputDef[];
  outputs: OutputDef[];
  slots?: SlotDef[];
  cssCustomProperties?: CSSPropDef[];
  variants?: string[];
  scssClasses?: string[];
  exampleUsage?: string;
  figmaComponentId?: string;
  indexedAt?: number;
}

export interface InputDef {
  name: string;
  type: string;
  description?: string;
  defaultValue?: string;
  required?: boolean;
  internal?: boolean;
}

export interface OutputDef {
  name: string;
  eventType?: string;
  description?: string;
}

export interface SlotDef {
  name: string | null;
  description?: string;
}

export interface CSSPropDef {
  name: string;
  defaultValue?: string;
  description?: string;
}

export interface FigmaMapping {
  figmaComponentId: string;
  selector: string;
  componentType: ComponentType;
  confidence: number;
  mappedAt: number;
}

export class ComponentIndex {
  private db: Database.Database;

  constructor() {
    const dbPath = path.resolve(process.env.DB_PATH || './data/component-map.db');
    const dir = path.dirname(dbPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.init();
  }

  private init(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS components (
        id INTEGER PRIMARY KEY,
        selector TEXT UNIQUE NOT NULL,
        class_name TEXT NOT NULL,
        component_type TEXT NOT NULL,
        file_path TEXT NOT NULL,
        inputs TEXT NOT NULL DEFAULT '[]',
        outputs TEXT NOT NULL DEFAULT '[]',
        slots TEXT,
        css_custom_properties TEXT,
        variants TEXT,
        scss_classes TEXT,
        example_usage TEXT,
        figma_component_id TEXT,
        indexed_at INTEGER NOT NULL
      );

      CREATE VIRTUAL TABLE IF NOT EXISTS components_fts USING fts5(
        selector, class_name, inputs, outputs, example_usage,
        content='components', content_rowid='id'
      );

      CREATE TRIGGER IF NOT EXISTS components_ai AFTER INSERT ON components BEGIN
        INSERT INTO components_fts(rowid, selector, class_name, inputs, outputs, example_usage)
        VALUES (new.id, new.selector, new.class_name, new.inputs, new.outputs, COALESCE(new.example_usage, ''));
      END;

      CREATE TRIGGER IF NOT EXISTS components_au AFTER UPDATE ON components BEGIN
        INSERT INTO components_fts(components_fts, rowid, selector, class_name, inputs, outputs, example_usage)
        VALUES ('delete', old.id, old.selector, old.class_name, old.inputs, old.outputs, COALESCE(old.example_usage, ''));
        INSERT INTO components_fts(rowid, selector, class_name, inputs, outputs, example_usage)
        VALUES (new.id, new.selector, new.class_name, new.inputs, new.outputs, COALESCE(new.example_usage, ''));
      END;

      CREATE TRIGGER IF NOT EXISTS components_ad AFTER DELETE ON components BEGIN
        INSERT INTO components_fts(components_fts, rowid, selector, class_name, inputs, outputs, example_usage)
        VALUES ('delete', old.id, old.selector, old.class_name, old.inputs, old.outputs, COALESCE(old.example_usage, ''));
      END;

      CREATE TABLE IF NOT EXISTS figma_mappings (
        figma_component_id TEXT PRIMARY KEY,
        selector TEXT NOT NULL,
        component_type TEXT NOT NULL,
        confidence REAL DEFAULT 1.0,
        mapped_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS token_overrides (
        figma_token_name TEXT PRIMARY KEY,
        scss_variable TEXT NOT NULL,
        value TEXT NOT NULL
      );
    `);
    logger.debug('ComponentIndex database initialized');
  }

  upsert(rec: ComponentRecord): void {
    const stmt = this.db.prepare(`
      INSERT INTO components
        (selector, class_name, component_type, file_path, inputs, outputs, slots,
         css_custom_properties, variants, scss_classes, example_usage, figma_component_id, indexed_at)
      VALUES
        (@selector, @className, @componentType, @filePath, @inputs, @outputs, @slots,
         @cssCustomProperties, @variants, @scssClasses, @exampleUsage, @figmaComponentId, @indexedAt)
      ON CONFLICT(selector) DO UPDATE SET
        class_name = excluded.class_name,
        component_type = excluded.component_type,
        file_path = excluded.file_path,
        inputs = excluded.inputs,
        outputs = excluded.outputs,
        slots = excluded.slots,
        css_custom_properties = excluded.css_custom_properties,
        variants = excluded.variants,
        scss_classes = excluded.scss_classes,
        example_usage = excluded.example_usage,
        figma_component_id = excluded.figma_component_id,
        indexed_at = excluded.indexed_at
    `);

    stmt.run({
      selector: rec.selector,
      className: rec.className,
      componentType: rec.componentType,
      filePath: rec.filePath,
      inputs: JSON.stringify(rec.inputs || []),
      outputs: JSON.stringify(rec.outputs || []),
      slots: rec.slots ? JSON.stringify(rec.slots) : null,
      cssCustomProperties: rec.cssCustomProperties ? JSON.stringify(rec.cssCustomProperties) : null,
      variants: rec.variants ? JSON.stringify(rec.variants) : null,
      scssClasses: rec.scssClasses ? JSON.stringify(rec.scssClasses) : null,
      exampleUsage: rec.exampleUsage || null,
      figmaComponentId: rec.figmaComponentId || null,
      indexedAt: Date.now(),
    });
  }

  search(query: string, preferType?: ComponentType, limit = 10): Array<ComponentRecord & { score: number }> {
    // FTS5 rank is negative (more negative = better match).
    // To boost preferred type, divide by 1.5 (making it more negative = higher priority).
    const rows = this.db.prepare(`
      SELECT c.*, fts.rank as score
      FROM components_fts fts
      JOIN components c ON c.id = fts.rowid
      WHERE components_fts MATCH ?
      ORDER BY
        CASE WHEN c.component_type = ? THEN fts.rank / 1.5 ELSE fts.rank END ASC
      LIMIT ?
    `).all(query + '*', preferType || '', limit) as Array<Record<string, unknown>>;

    return rows.map(r => this.rowToRecord(r) as ComponentRecord & { score: number });
  }

  getBySelector(selector: string): ComponentRecord | null {
    const row = this.db.prepare('SELECT * FROM components WHERE selector = ?').get(selector) as Record<string, unknown> | undefined;
    return row ? this.rowToRecord(row) : null;
  }

  listAll(filterType?: ComponentType): ComponentRecord[] {
    const rows = filterType
      ? this.db.prepare('SELECT * FROM components WHERE component_type = ?').all(filterType)
      : this.db.prepare('SELECT * FROM components').all();
    return (rows as Array<Record<string, unknown>>).map(r => this.rowToRecord(r));
  }

  saveMapping(figmaId: string, selector: string, componentType: ComponentType, confidence = 1.0): void {
    this.db.prepare(`
      INSERT OR REPLACE INTO figma_mappings (figma_component_id, selector, component_type, confidence, mapped_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(figmaId, selector, componentType, confidence, Date.now());
  }

  getMappingByFigmaId(figmaId: string): FigmaMapping | null {
    const row = this.db.prepare('SELECT * FROM figma_mappings WHERE figma_component_id = ?').get(figmaId) as Record<string, unknown> | undefined;
    if (!row) return null;
    return {
      figmaComponentId: row.figma_component_id as string,
      selector: row.selector as string,
      componentType: row.component_type as ComponentType,
      confidence: row.confidence as number,
      mappedAt: row.mapped_at as number,
    };
  }

  listMappings(filterType?: ComponentType, unmappedOnly = false): FigmaMapping[] {
    if (unmappedOnly) {
      const rows = this.db.prepare(`
        SELECT c.selector, c.component_type, NULL as figma_component_id, 1.0 as confidence, 0 as mapped_at
        FROM components c
        LEFT JOIN figma_mappings fm ON fm.selector = c.selector
        WHERE fm.selector IS NULL
        ${filterType ? 'AND c.component_type = ?' : ''}
      `).all(...(filterType ? [filterType] : [])) as Array<Record<string, unknown>>;
      return rows.map(r => ({
        figmaComponentId: '',
        selector: r.selector as string,
        componentType: r.component_type as ComponentType,
        confidence: 0,
        mappedAt: 0,
      }));
    }
    const rows = filterType
      ? this.db.prepare('SELECT * FROM figma_mappings WHERE component_type = ?').all(filterType)
      : this.db.prepare('SELECT * FROM figma_mappings').all();
    return (rows as Array<Record<string, unknown>>).map(r => ({
      figmaComponentId: r.figma_component_id as string,
      selector: r.selector as string,
      componentType: r.component_type as ComponentType,
      confidence: r.confidence as number,
      mappedAt: r.mapped_at as number,
    }));
  }

  count(type?: ComponentType): number {
    if (type) {
      const row = this.db.prepare('SELECT COUNT(*) as n FROM components WHERE component_type = ?').get(type) as { n: number };
      return row.n;
    }
    const row = this.db.prepare('SELECT COUNT(*) as n FROM components').get() as { n: number };
    return row.n;
  }

  private rowToRecord(row: Record<string, unknown>): ComponentRecord {
    return {
      id: row.id as number,
      selector: row.selector as string,
      className: row.class_name as string,
      componentType: row.component_type as ComponentType,
      filePath: row.file_path as string,
      inputs: JSON.parse((row.inputs as string) || '[]'),
      outputs: JSON.parse((row.outputs as string) || '[]'),
      slots: row.slots ? JSON.parse(row.slots as string) : undefined,
      cssCustomProperties: row.css_custom_properties ? JSON.parse(row.css_custom_properties as string) : undefined,
      variants: row.variants ? JSON.parse(row.variants as string) : undefined,
      scssClasses: row.scss_classes ? JSON.parse(row.scss_classes as string) : undefined,
      exampleUsage: row.example_usage as string | undefined,
      figmaComponentId: row.figma_component_id as string | undefined,
      indexedAt: row.indexed_at as number,
    };
  }
}
