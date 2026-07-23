import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

export interface ManifestGeneratedComponent {
  selector: string;
  className: string;
  folder: string;
}

export interface ManifestDiffResult {
  mismatchRatio: number;
  maxMismatchRatio: number;
  passed: boolean;
  checkedAt: string;
}

export interface ManifestEntry {
  fileKey: string;
  nodeId: string;
  nodeName: string;
  kind: 'component' | 'page';
  /** hashFigmaNode() of the Figma node as of generatedAt — the round-trip signature used for drift detection. */
  figmaContentHash: string;
  component: ManifestGeneratedComponent;
  /** Present only for kind 'page' — one entry per split-out section (see page-generator.ts). */
  sections?: ManifestGeneratedComponent[];
  generatedAt: string;
  /**
   * The last codegen_diff result, if one was ever run — cleared whenever a
   * new generation records a different figmaContentHash, since a diff result
   * is only meaningful relative to the exact design content it measured.
   */
  lastDiff?: ManifestDiffResult;
}

function defaultManifestFilePath(): string {
  return process.env.MANIFEST_FILE ?? path.resolve('./figma-generation-manifest.json');
}

function readManifestFile(manifestFile: string): Record<string, ManifestEntry> {
  if (!existsSync(manifestFile)) return {};
  try {
    return JSON.parse(readFileSync(manifestFile, 'utf-8'));
  } catch {
    return {};
  }
}

function writeManifestFile(manifestFile: string, data: Record<string, ManifestEntry>): void {
  mkdirSync(path.dirname(manifestFile), { recursive: true });
  writeFileSync(manifestFile, JSON.stringify(data, null, 2) + '\n', 'utf-8');
}

function keyFor(fileKey: string, nodeId: string): string {
  return `${fileKey}:${nodeId}`;
}

/**
 * Records (upserts) a generation event for one Figma node. If a prior entry
 * exists with the SAME content hash (e.g. regenerating after only a
 * lib_map_figma_to_component change, not a design change), its lastDiff is
 * preserved — it's still valid, since nothing about the Figma design moved.
 * A different hash means the design changed, so any prior diff result no
 * longer applies and is dropped.
 */
export function recordGeneration(
  input: {
    fileKey: string;
    nodeId: string;
    nodeName: string;
    kind: 'component' | 'page';
    figmaContentHash: string;
    component: ManifestGeneratedComponent;
    sections?: ManifestGeneratedComponent[];
  },
  manifestFile = defaultManifestFilePath()
): ManifestEntry {
  const all = readManifestFile(manifestFile);
  const key = keyFor(input.fileKey, input.nodeId);
  const previous = all[key];

  const entry: ManifestEntry = {
    ...input,
    generatedAt: new Date().toISOString(),
    lastDiff: previous?.figmaContentHash === input.figmaContentHash ? previous.lastDiff : undefined,
  };
  all[key] = entry;
  writeManifestFile(manifestFile, all);
  return entry;
}

/** Attaches a fresh codegen_diff result to the node's manifest entry, if one exists. */
export function recordDiffResult(
  fileKey: string,
  nodeId: string,
  diff: ManifestDiffResult,
  manifestFile = defaultManifestFilePath()
): ManifestEntry | undefined {
  const all = readManifestFile(manifestFile);
  const key = keyFor(fileKey, nodeId);
  const existing = all[key];
  if (!existing) return undefined;

  const updated: ManifestEntry = { ...existing, lastDiff: diff };
  all[key] = updated;
  writeManifestFile(manifestFile, all);
  return updated;
}

export function getManifestEntry(
  fileKey: string,
  nodeId: string,
  manifestFile = defaultManifestFilePath()
): ManifestEntry | undefined {
  return readManifestFile(manifestFile)[keyFor(fileKey, nodeId)];
}

export function listManifestEntries(manifestFile = defaultManifestFilePath()): ManifestEntry[] {
  return Object.values(readManifestFile(manifestFile));
}
