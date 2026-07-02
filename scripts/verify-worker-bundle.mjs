#!/usr/bin/env node
/**
 * Verifies that wrangler bundles worker.js together with all local ES module imports.
 * Fails CI if the bundle is missing expected code from context-compression.js, etc.
 */
import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';

const OUTDIR = '.wrangler-bundle-tmp';
const BUNDLE = path.join(OUTDIR, 'worker.js');
const MIN_BYTES = 500_000;
const REQUIRED_MARKERS = [
  'serializeWeekPlanWeeklyCompact',
  'serializePlanSummary',
  'applyJsonPatches',
  'buildAnalyticsSummary',
  'buildClientCard',
  'allocateMealGramsFromMacros',
];

fs.rmSync(OUTDIR, { recursive: true, force: true });

execSync(`npx wrangler deploy --dry-run --outdir ${OUTDIR} --env production`, {
  stdio: 'inherit',
});

if (!fs.existsSync(BUNDLE)) {
  console.error(`Bundle not found at ${BUNDLE}`);
  process.exit(1);
}

const content = fs.readFileSync(BUNDLE, 'utf8');
const size = fs.statSync(BUNDLE).size;

if (size < MIN_BYTES) {
  console.error(`Worker bundle too small: ${size} bytes (expected at least ${MIN_BYTES})`);
  process.exit(1);
}

const missing = REQUIRED_MARKERS.filter((marker) => !content.includes(marker));
if (missing.length) {
  console.error(`Worker bundle is missing expected code: ${missing.join(', ')}`);
  process.exit(1);
}

console.log(`Worker bundle verified (${size} bytes, ${REQUIRED_MARKERS.length} markers present)`);
