/**
 * Minimal live matrix — един профил на категория правила (икономично пълно покритие).
 * 6 AI генерации покриват P1/P2/P3 + rebuild contracts.
 */
import { PROFILES } from './profiles.mjs';
import { HARD_PROFILES } from './hard-profiles.mjs';
import { EXTENDED_PROFILES } from './extended-profiles.mjs';

/** @typedef {{ id: string, profile: object, covers: string[] }} MatrixEntry */

function byId(list, id) {
  const p = list.find(x => x.id === id);
  if (!p) throw new Error(`matrix profile missing: ${id}`);
  return p;
}

/** @type {MatrixEntry[]} */
export const MATRIX_ENTRIES = [
  {
    id: 'skip_breakfast_athlete',
    profile: byId(HARD_PROFILES, 'skip_breakfast_athlete'),
    covers: [
      'P3: skip breakfast (no H1)',
      'P3: sweet craving → dessert allowed',
      'P1: standard slot kcal',
      'P2: male weight loss',
    ],
  },
  {
    id: 'lactation',
    profile: byId(PROFILES, 'lactation'),
    covers: [
      'P2: postpartum_lactation floor (+300 kcal)',
      'P2: no aggressive deficit vs TDEE',
      'P1: female moderate intake',
    ],
  },
  {
    id: 'keto_pref',
    profile: byId(PROFILES, 'keto_pref'),
    covers: [
      'P2: keto carbs ≤15%',
      'P1: macro analysis consistency',
    ],
  },
  {
    id: 'kamen_benchmark',
    profile: byId(HARD_PROFILES, 'kamen_benchmark'),
    covers: [
      'P1: high-kcal slots (~1112) solver stress',
      'P3: skip breakfast + high intake → H5 split',
      'P3: no sweet craving → no dessert rule',
      'P1: slot kcal ±10% hard cases',
    ],
  },
  {
    id: 'vegan_active',
    profile: byId(HARD_PROFILES, 'vegan_active'),
    covers: [
      'P2: vegan (no animal products)',
      'P2: muscle gain protein ≥1.4g/kg',
      'P1: active female intake',
    ],
  },
  {
    id: 'aip_autoimmune',
    profile: byId(EXTENDED_PROFILES, 'aip_autoimmune'),
    covers: [
      'P2: AIP clinical protocol forbidden foods',
      'P2: autoimmune catalog narrowing',
    ],
  },
  {
    id: 'diabetes_sweets_craving',
    profile: byId(HARD_PROFILES, 'diabetes_sweets_craving'),
    covers: [
      'P2: diabetes / IR dietetic rules',
      'P3: sweet craving + dessert',
      'P1: older female weight loss slots',
    ],
  },
];

export const MATRIX_PROFILES = MATRIX_ENTRIES.map(e => e.profile);

/** All unique rule categories claimed by the matrix */
export const MATRIX_COVERAGE_CLAIMS = [...new Set(MATRIX_ENTRIES.flatMap(e => e.covers))];
