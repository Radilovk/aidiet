/**
 * Live Step 3 simulation — AI picks products, backend balances macros.
 *
 * Run: node simulate-live-step3.mjs
 *
 * Secrets:
 * - Production GEMINI_API_KEY lives in Cloudflare Worker secrets (valid there).
 * - .dev.vars is only for local dev; a stale GEMINI key here overrides nothing
 *   in production but breaks local direct-Gemini tests. Leave GEMINI out of
 *   .dev.vars unless you paste the current key from the CF dashboard.
 * - Without local GEMINI, the script uses OpenRouter google/gemini-2.5-flash
 *   (same model as production) or OpenAI fallback.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildCatalogPromptSection, validateProductNamesInCatalog } from './food-catalog.js';
import {
  syncWeekPlanNutritionFromDatabase,
  parseMealDescription,
  calorieTolerance,
  macroTolerance,
} from './food-nutrition.js';
import { serializeWeeklySchemeTargets, formatPromptValue } from './context-compression.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MAX_LATE_SNACK_CALORIES = 200;
const MEAL_PLAN_TOKEN_LIMIT = 8000;
const MAX_RETRIES = 2;
const DAY_NUMBER_TO_KEY = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];

function loadDevVars() {
  const file = path.join(__dirname, '.dev.vars');
  if (!fs.existsSync(file)) throw new Error('Missing .dev.vars');
  const env = {};
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq < 0) continue;
    env[trimmed.slice(0, eq).trim()] = trimmed.slice(eq + 1).trim();
  }
  return env;
}

function replacePromptVariables(template, variables) {
  return template.replace(/\{([\w.]+)\}/g, (match, key) => {
    const keys = key.split('.');
    let value = variables;
    for (const k of keys) {
      if (value == null || typeof value !== 'object' || !(k in value)) return match;
      value = value[k];
    }
    if (value == null) return '';
    return formatPromptValue(value);
  });
}

function extractBalancedJSON(text) {
  const startObj = text.indexOf('{');
  const startArr = text.indexOf('[');
  let start = -1;
  let open = '{';
  let close = '}';
  if (startObj >= 0 && (startArr < 0 || startObj < startArr)) {
    start = startObj;
  } else if (startArr >= 0) {
    start = startArr;
    open = '[';
    close = ']';
  }
  if (start < 0) return null;
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === '\\') esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') { inStr = true; continue; }
    if (ch === open) depth++;
    if (ch === close) {
      depth--;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return null;
}

function parseAIResponse(response) {
  const fence = response.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  const candidates = [fence?.[1], extractBalancedJSON(response)].filter(Boolean);
  for (const raw of candidates) {
    try {
      return JSON.parse(raw);
    } catch (_) { /* try next */ }
  }
  return { error: 'parse failed' };
}

async function callGeminiDirect(apiKey, prompt, maxTokens = 8000) {
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          maxOutputTokens: maxTokens,
          responseMimeType: 'application/json',
          thinkingConfig: { thinkingBudget: 0 },
        },
      }),
    }
  );
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Gemini ${res.status}: ${err.slice(0, 200)}`);
  }
  const data = await res.json();
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error('Empty Gemini response');
  return { text, provider: 'google/gemini-2.5-flash' };
}

async function callAI(env, prompt, maxTokens = 8000) {
  if (env.GEMINI_API_KEY) {
    try {
      return await callGeminiDirect(env.GEMINI_API_KEY, prompt, maxTokens);
    } catch (e) {
      if (e.message.includes('API_KEY_INVALID') || e.message.includes('API key not valid')) {
        console.warn('Local GEMINI_API_KEY invalid — falling back to OpenRouter/OpenAI');
      } else {
        throw e;
      }
    }
  }

  const jsonBody = (messages, model) => ({
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      messages,
      max_tokens: maxTokens,
      response_format: { type: 'json_object' },
    }),
  });

  if (env.OPEN_ROUTER) {
    const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      ...jsonBody([{ role: 'user', content: prompt }], 'google/gemini-2.5-flash'),
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${env.OPEN_ROUTER}`,
        'HTTP-Referer': 'https://aidiet.radilov-k.workers.dev',
        'X-Title': 'aidiet-simulation',
      },
    });
    if (res.ok) {
      const data = await res.json();
      const text = data.choices?.[0]?.message?.content;
      if (text) return { text, provider: 'openrouter/gemini-2.5-flash' };
    }
  }

  if (env.OPENAI_API_KEY) {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      ...jsonBody([{ role: 'user', content: prompt }], 'gpt-4o-mini'),
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${env.OPENAI_API_KEY}`,
      },
    });
    if (!res.ok) throw new Error(`OpenAI ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const data = await res.json();
    const text = data.choices?.[0]?.message?.content;
    if (!text) throw new Error('Empty OpenAI response');
    return { text, provider: 'openai/gpt-4o-mini' };
  }

  throw new Error('No working AI provider (OPEN_ROUTER or OPENAI_API_KEY required)');
}

function roundMacro(n) {
  return Math.round(n);
}

function makeMealBreakdown(dailyKcal, macros, ratios = [0.25, 0.30, 0.12, 0.28, 0.05]) {
  const types = ['Хранене 1', 'Хранене 2', 'Хранене 3', 'Хранене 4', 'Хранене 5'];
  return types.map((type, i) => ({
    type,
    calories: roundMacro(dailyKcal * ratios[i]),
    protein: roundMacro(macros.protein * ratios[i]),
    carbs: roundMacro(macros.carbs * ratios[i]),
    fats: roundMacro(macros.fats * ratios[i]),
  }));
}

function makeWeeklyScheme(dailyKcal, macros) {
  const scheme = {};
  for (let i = 0; i < 7; i++) {
    const key = DAY_NUMBER_TO_KEY[i];
    scheme[key] = {
      calories: dailyKcal,
      protein: macros.protein,
      carbs: macros.carbs,
      fats: macros.fats,
      mealBreakdown: makeMealBreakdown(dailyKcal, macros),
    };
  }
  return scheme;
}

function buildStep3CompactContext(analysis, strategy, dietaryModifier) {
  const ag = analysis?.macroGrams;
  const ar = analysis?.macroRatios;
  const macroLine = ag
    ? `Дневни макроси: P${ag.protein ?? '?'}g / C${ag.carbs ?? '?'}g / F${ag.fats ?? '?'}g` +
      (ar ? ` (${ar.protein}/${ar.carbs}/${ar.fats}%)` : '')
    : '';
  const principles = (strategy?.keyPrinciples || []).slice(0, 3).join('; ');
  const avoid = (strategy?.avoidFoodCategories || []).slice(0, 6).join(', ');
  const strategyLine = [
    `Модификатор: ${dietaryModifier}`,
    principles ? `Принципи: ${principles}` : '',
    avoid ? `Избягвай: ${avoid}` : '',
  ].filter(Boolean).join(' | ');
  return { analysisBlock: macroLine, strategyBlock: strategyLine };
}

function macrosToCalories(macros) {
  return Math.round((macros.protein || 0) * 4 + (macros.carbs || 0) * 4 + (macros.fats || 0) * 9);
}

function validateMealsAgainstScheme(dayPlan, dayTarget, dayNum) {
  const errors = [];
  if (!dayPlan?.meals?.length || !dayTarget?.mealBreakdown?.length) return errors;
  for (const meal of dayPlan.meals) {
    if (meal.type === 'Свободно хранене' || meal.type === 'Напитка') continue;
    const target = dayTarget.mealBreakdown.find(m => m.type === meal.type);
    if (!target) continue;
    const targetCal = Number(target.calories) || 0;
    const mealCal = Number(meal.calories) || macrosToCalories(meal.macros);
    if (targetCal > 0 && Math.abs(mealCal - targetCal) > calorieTolerance(targetCal)) {
      errors.push(`Ден ${dayNum} ${meal.type}: калории ${mealCal} ≠ цел ${targetCal} (±${calorieTolerance(targetCal)})`);
    }
    for (const field of ['protein', 'carbs', 'fats']) {
      const tv = Number(target[field]) || 0;
      const mv = Number(meal.macros?.[field]) || 0;
      if (tv > 0 && Math.abs(mv - tv) > macroTolerance(tv)) {
        errors.push(`Ден ${dayNum} ${meal.type}: ${field} ${mv}g ≠ цел ${tv}g (±${macroTolerance(tv)})`);
      }
    }
    if (!meal.description || !/\d+\s*(g|г)\b/i.test(meal.description)) {
      errors.push(`Ден ${dayNum} ${meal.type}: липсват грамажи`);
    }
    if (meal.description) {
      const notInCatalog = validateProductNamesInCatalog(parseMealDescription(meal.description).map(i => i.name));
      if (notInCatalog.length) {
        errors.push(`Ден ${dayNum} ${meal.type}: извън каталога: ${notInCatalog.join(', ')}`);
      }
    }
  }
  return errors;
}

function buildPrompt(template, scenario, startDay = 1) {
  const { data, analysis, strategy, bmr, recommendedCalories } = scenario;
  const dietaryModifier = strategy.dietaryModifier || 'Балансирано';
  const compactCtx = buildStep3CompactContext(analysis, strategy, dietaryModifier);
  const catalogSection = buildCatalogPromptSection({
    strategy,
    startDay,
    endDay: startDay,
    dietaryModifier,
    blockedTerms: [],
    preferLove: [],
  });
  const weeklySchemeByDayText = serializeWeeklySchemeTargets(
    strategy, startDay, startDay, recommendedCalories, DAY_NUMBER_TO_KEY
  );
  return replacePromptVariables(template, {
    userData: data,
    analysisBlock: compactCtx.analysisBlock,
    strategyBlock: compactCtx.strategyBlock,
    weeklySchemeByDayText,
    bmr,
    recommendedCalories,
    startDay,
    endDay: startDay,
    dietaryModifier,
    modificationsSection: '',
    previousDaysContext: '',
    dynamicBlacklistSection: '',
    catalogSection,
    dietLove: 'няма',
    dietDislike: 'няма',
    sweetsCravingRule: '',
    freeMealInstruction: '',
    additionalNotes: '',
    clinicalProtocolSection: '',
    MAX_LATE_SNACK_CALORIES,
  });
}

const SCENARIOS = [
  {
    name: '1600 kcal отслабване',
    bmr: 1450,
    recommendedCalories: 1600,
    macros: { protein: 120, carbs: 160, fats: 53 },
    data: { name: 'Мария', goal: 'Отслабване', stressLevel: 'среден', sleepHours: 7, chronotype: 'сова' },
    strategy: {
      dietaryModifier: 'Балансирано',
      keyPrinciples: ['висок протеин', 'зеленчуци на всяко хранене'],
      avoidFoodCategories: ['пържено'],
    },
  },
  {
    name: '2600 kcal мускулна маса',
    bmr: 1850,
    recommendedCalories: 2600,
    macros: { protein: 180, carbs: 300, fats: 72 },
    data: { name: 'Иван', goal: 'Мускулна маса', stressLevel: 'нисък', sleepHours: 8, chronotype: 'жавор' },
    strategy: {
      dietaryModifier: 'Висок протеин',
      keyPrinciples: ['постни протеини', 'сложни въглехидрати'],
      avoidFoodCategories: [],
    },
  },
  {
    name: '1800 kcal веган',
    bmr: 1500,
    recommendedCalories: 1800,
    macros: { protein: 100, carbs: 220, fats: 60 },
    data: { name: 'Елена', goal: 'Поддържане', stressLevel: 'висок', sleepHours: 6, chronotype: 'нормален' },
    strategy: {
      dietaryModifier: 'Веган',
      keyPrinciples: ['бобови', 'тофу', 'орехи'],
      avoidFoodCategories: ['месо', 'риба', 'млечни'],
    },
  },
];

async function runScenario(env, template, scenario) {
  const analysis = {
    macroGrams: scenario.macros,
    macroRatios: { protein: 30, carbs: 40, fats: 30 },
  };
  const strategy = {
    ...scenario.strategy,
    weeklyScheme: makeWeeklyScheme(scenario.recommendedCalories, scenario.macros),
  };
  const fullScenario = {
    ...scenario,
    analysis,
    strategy,
  };

  let bestErrors = null;
  let bestPlan = null;
  let bestProvider = null;
  let lastError = null;
  let retryComment = '';

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      let prompt = buildPrompt(template, fullScenario);
      if (retryComment) {
        prompt += `\n\n═══ КОРЕКЦИЯ ═══\n${retryComment}`;
      }
      const { text: raw, provider } = await callAI(env, prompt, MEAL_PLAN_TOKEN_LIMIT);
      const parsed = parseAIResponse(raw);
      if (!parsed || parsed.error) throw new Error(parsed?.error || 'invalid json');

      const weekPlan = { day1: parsed.day1 || parsed };
      const repairContext = { dietaryModifier: strategy.dietaryModifier, blockedTerms: [] };
      syncWeekPlanNutritionFromDatabase(weekPlan, strategy, 1, 1, {}, repairContext);
      const errors = validateMealsAgainstScheme(weekPlan.day1, strategy.weeklyScheme.monday, 1);

      if (!errors.length) {
        return { ok: true, attempt: attempt + 1, provider, meals: weekPlan.day1.meals, errors: [] };
      }
      if (!bestErrors || errors.length < bestErrors.length) {
        bestErrors = errors;
        bestPlan = weekPlan.day1;
        bestProvider = provider;
      }
      retryComment = errors.map((e, i) => `${i + 1}. ${e}`).join('\n');
      lastError = errors.join('; ');
    } catch (e) {
      lastError = e.message;
    }
  }

  if (bestPlan) {
    return { ok: false, softFallback: true, provider: bestProvider, meals: bestPlan.meals, errors: bestErrors, lastError };
  }
  return { ok: false, softFallback: false, lastError };
}

function summarizeMeals(meals) {
  return (meals || []).map(m => {
    const prods = (m.description || '').split('\n').filter(Boolean).join(' | ');
    const repaired = m._autoRepaired ? ` [auto-repair +${m._autoRepaired}]` : '';
    return `  ${m.type}: ${m.calories}kcal P${m.macros?.protein}/C${m.macros?.carbs}/F${m.macros?.fats} — ${prods}${repaired}`;
  }).join('\n');
}

async function main() {
  const env = { ...loadDevVars(), ...process.env };
  if (!env.GEMINI_API_KEY && !env.OPEN_ROUTER && !env.OPENAI_API_KEY) {
    throw new Error('Need GEMINI_API_KEY, OPEN_ROUTER, or OPENAI_API_KEY in .dev.vars / env');
  }

  const template = fs.readFileSync(path.join(__dirname, 'KV/prompts/admin_meal_plan_prompt.txt'), 'utf8');
  console.log('=== Live Step 3 simulation (AI + backend balancer) ===');
  console.log('Production worker: google/gemini-2.5-flash via CF secrets');
  if (env.GEMINI_API_KEY) console.log('Local provider: direct Gemini (from .dev.vars)');
  else if (env.OPEN_ROUTER) console.log('Local provider: OpenRouter google/gemini-2.5-flash');
  else console.log('Local provider: OpenAI gpt-4o-mini');
  console.log('');

  const results = [];
  for (const scenario of SCENARIOS) {
    process.stdout.write(`▶ ${scenario.name}... `);
    const result = await runScenario(env, template, scenario);
    results.push({ scenario: scenario.name, ...result });
    if (result.ok) {
      console.log(`✓ PASS (attempt ${result.attempt}, ${result.provider})`);
    } else if (result.softFallback) {
      console.log(`⚠ SOFT FALLBACK (${result.errors.length} errors)`);
    } else {
      console.log(`✗ FAIL — ${result.lastError}`);
    }
  }

  console.log('\n=== Детайли ===\n');
  for (const r of results) {
    console.log(`--- ${r.scenario} ---`);
    if (r.meals) console.log(summarizeMeals(r.meals));
    if (r.errors?.length) {
      console.log('Грешки:');
      for (const e of r.errors) console.log(`  • ${e}`);
    }
    console.log('');
  }

  const passed = results.filter(r => r.ok).length;
  const soft = results.filter(r => r.softFallback).length;
  const failed = results.length - passed - soft;
  console.log(`Обобщение: ${passed} PASS / ${soft} soft fallback / ${failed} FAIL`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
