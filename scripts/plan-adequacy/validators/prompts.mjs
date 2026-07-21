import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../..');

const PROMPT_CONTRACTS = {
  'KV/prompts/admin_analysis_prompt.txt': [
    'Final_Calories',
    'macroRatios',
    'macroGrams',
    'currentHealthStatus',
    'severityValue',
    'keyProblems',
    'HEALTH_STATUS_UNDERESTIMATE_PERCENT',
    'MIN_FAT_GRAMS',
    'Въз основа на информацията по-горе',
  ],
  'KV/prompts/admin_strategy_prompt.txt': [
    'Хранене 3',
    'mealCountJustification',
    'weeklyScheme',
    'Свободно хранене',
    'Въз основа на профила по-горе',
  ],
  'KV/prompts/admin_meal_plan_prompt.txt': [
    'Хранене 3',
    'САМО',
    'ПРИМЕР',
    'каталога',
    'Въз основа на каталога',
  ],
  'KV/prompts/admin_summary_prompt.txt': [
    'recommendations',
    'supplements',
    'psychology',
    'персонализирани',
    'Въз основа на информацията по-горе',
  ],
};

export function validatePromptContracts() {
  const issues = [];
  for (const [rel, needles] of Object.entries(PROMPT_CONTRACTS)) {
    const full = path.join(root, rel);
    if (!fs.existsSync(full)) {
      issues.push(`${rel}: файлът липсва`);
      continue;
    }
    const text = fs.readFileSync(full, 'utf8');
    for (const needle of needles) {
      if (!text.includes(needle)) {
        issues.push(`${rel}: липсва "${needle}"`);
      }
    }
    if (!text.includes('=== ЗАДАЧА')) {
      issues.push(`${rel}: липсва секция === ЗАДАЧА (Gemini task-at-end)`);
    }
  }
  return issues;
}

export function validateKvUploadCoverage() {
  const issues = [];
  const script = fs.readFileSync(path.join(root, 'KV/upload-kv-keys.sh'), 'utf8');
  if (!script.includes('prompts/*.txt')) {
    issues.push('upload-kv-keys.sh: не качва KV/prompts/*.txt автоматично');
  }
  if (!script.includes('KV/*.txt')) {
    issues.push('upload-kv-keys.sh: не качва KV/*.txt автоматично');
  }
  const promptFiles = fs.readdirSync(path.join(root, 'KV/prompts')).filter(f => f.endsWith('.txt'));
  for (const f of promptFiles) {
    const key = f.replace(/\.txt$/, '');
    if (!script.includes('basename') && !script.includes(key)) {
      // auto glob covers it
    }
  }
  return issues;
}
