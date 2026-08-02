/**
 * EFP класификация — target/equipment таксономия + trait corrections.
 * Винаги live compute; bundled JSON само за ръчни/AI override.
 */
import { normalizeText } from './normalize.js';
import { inferExerciseTraits } from './exercise-tags.js';
import {
  scoreDifficulty,
  scoreGenderFit,
  DIFF_ADVANCED_RE,
} from './exercise-taxonomy.js';

function movementFlags(raw, traits) {
  const blob = normalizeText(`${raw?.name || ''} ${raw?.equipment || ''} ${raw?.target || ''}`);
  const flags = [];
  if (/compound|press|squat|deadlift|lunge|thrust|row|pull|push/.test(blob)) flags.push('compound');
  if (/curl|extension|fly|kickback|raise|crunch|stretch/.test(blob) && !flags.includes('compound')) {
    flags.push('isolation');
  }
  if (/barbell|olympic|trap bar/.test(blob)) flags.push('barbell');
  if (/machine|lever|smith/.test(blob)) flags.push('machine');
  if (traits.trueBodyweight) flags.push('bodyweight');
  if (traits.beginnerSafe) flags.push('beginner_safe');
  if (traits.homeFriendly) flags.push('home_friendly');
  if (/glute|abduct|adduct|hip thrust|kickback/.test(blob)) flags.push('glute');
  if (/bench|press|military|skull/.test(blob) && !/push[- ]?up/.test(blob)) flags.push('press');
  return flags;
}

/**
 * @param {object} raw
 */
export function classifyExercise(raw) {
  const name = raw?.name || '';
  const equipment = raw?.equipment || '';
  const target = raw?.target || raw?.muscle_group || '';
  const muscleGroup = raw?.muscle_group || '';
  const traits = inferExerciseTraits(name, equipment);

  let diff = scoreDifficulty(name, equipment, target);

  if (traits.gymnastics || traits.rings || (traits.highSkill && !traits.stretch)) {
    diff = Math.max(diff, 3);
  } else if (traits.pullBar && !traits.assisted && !traits.stretch) {
    diff = Math.max(diff, 2);
  } else if (traits.suspended || traits.parallelBars) {
    diff = Math.max(diff, 2);
  }
  if (traits.stretch && diff > 1) diff = 1;
  if (DIFF_ADVANCED_RE.test(normalizeText(name))) diff = 3;

  const { gf, gm } = scoreGenderFit(name, target, muscleGroup);
  const flags = [...new Set(movementFlags(raw, traits))];

  return { diff, gf, gm, flags, classifySource: 'taxonomy' };
}
