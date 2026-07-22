/**
 * BG жаргон/абревиатури → EN ключови думи от exercise dataset-а.
 * Ползва се само за разширяване на търсачката (admin picker + /api/exercises/search) —
 * не влиза в AI промпта.
 */
import { normalizeText, tokenize } from './normalize.js';

const SYNONYMS = {
  'клек': ['squat'],
  'клекове': ['squat'],
  'клек с гира': ['goblet', 'squat'],
  'преден клек': ['front', 'squat'],
  'тяга': ['deadlift', 'row'],
  'мъртва тяга': ['deadlift'],
  'румънска тяга': ['romanian', 'deadlift'],
  'сумо тяга': ['sumo', 'deadlift'],
  'лежанка': ['bench', 'press'],
  'бенч': ['bench', 'press'],
  'гребане': ['row'],
  'набирания': ['pull', 'up', 'chin'],
  'дупе': ['glute'],
  'седалище': ['glute'],
  'седалищни': ['glute'],
  'бедра': ['quad', 'thigh'],
  'предно бедро': ['quad'],
  'задно бедро': ['hamstring'],
  'прасци': ['calf'],
  'корем': ['ab', 'abdominal', 'core'],
  'коремни': ['crunch', 'ab'],
  'корем преси': ['crunch'],
  'гърди': ['chest', 'pec'],
  'гръб': ['back', 'lat', 'row', 'pulldown'],
  'широк гръбен': ['lat'],
  'рамо': ['shoulder', 'delt'],
  'рамене': ['shoulder', 'delt'],
  'бицепс': ['bicep', 'curl'],
  'трицепс': ['tricep'],
  'предмишница': ['forearm'],
  'изпад': ['lunge'],
  'изпади': ['lunge'],
  'кофички': ['dip'],
  'сгъване': ['curl'],
  'разгъване': ['extension'],
  'повдигане': ['raise'],
  'странично повдигане': ['lateral', 'raise'],
  'предно повдигане': ['front', 'raise'],
  'дърпане': ['pull', 'row', 'pulldown', 'face'],
  'дърпане към лицето': ['face', 'pull'],
  'въже': ['rope'],
  'скрипец': ['cable'],
  'кабел': ['cable'],
  'машина': ['machine', 'leverage'],
  'щанга': ['barbell'],
  'дъмбел': ['dumbbell'],
  'дъмбели': ['dumbbell'],
  'гира': ['kettlebell'],
  'гирички': ['kettlebell'],
  'ластик': ['band'],
  'фитбол': ['stability', 'ball'],
  'собствено тегло': ['body', 'weight'],
  'кардио': ['cardio', 'run', 'cycle', 'jump'],
  'бягане': ['run', 'treadmill'],
  'колоездене': ['cycle', 'bike'],
  'скачане': ['jump', 'rope'],
  'йога': ['stretch', 'yoga', 'mobility'],
  'мобилност': ['stretch', 'mobility'],
  'разтягане': ['stretch'],
  'стречинг': ['stretch'],
  'планк': ['plank'],
  'хип тръст': ['hip', 'thrust'],
  'военна преса': ['military', 'press'],
  'раменна преса': ['overhead', 'press', 'shoulder'],
  'френска преса': ['skull', 'crusher'],
  'чук сгъване': ['hammer', 'curl'],
  'преса за крака': ['leg', 'press'],
  'разтваряне': ['fly'],
  'повдигане на рамене': ['shrug'],
  'сплит клек': ['split', 'squat'],
  'ohp': ['overhead', 'press'],
  'rdl': ['romanian', 'deadlift'],
  'delts': ['shoulder'],
  'lats': ['back', 'lat'],
  'pecs': ['chest', 'pec'],
  'abs': ['core', 'abdominal'],
  'quads': ['quad'],
  'traps': ['trap'],
};

const MULTI_WORD_KEYS = Object.keys(SYNONYMS).filter((k) => k.includes(' '));

/** Разширява токените на заявката със BG→EN синоними, за fuzzy търсене. */
export function expandSearchTokens(query) {
  const base = tokenize(query);
  if (!base.length) return base;
  const out = new Set(base);
  const raw = normalizeText(query);
  for (const key of MULTI_WORD_KEYS) {
    if (raw.includes(key)) for (const v of SYNONYMS[key]) out.add(v);
  }
  for (const token of base) {
    if (SYNONYMS[token]) for (const v of SYNONYMS[token]) out.add(v);
  }
  return [...out];
}
