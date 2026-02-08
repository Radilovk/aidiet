/**
 * Utility functions for the AI Diet application
 * 
 * These are shared helper functions used throughout the worker.js file
 * to avoid code duplication and improve maintainability.
 */

/**
 * Estimate token count for AI prompts (supports Cyrillic)
 * Consolidates estimateTokens() and estimateTokenCount() into a single function
 * 
 * @param {string} text - The text to estimate tokens for
 * @returns {number} Estimated token count
 */
export function estimateTokenCount(text) {
  if (!text) return 0;
  
  // Count Cyrillic vs Latin characters
  const cyrillicChars = (text.match(/[\u0400-\u04FF]/g) || []).length;
  const totalChars = text.length;
  const cyrillicRatio = cyrillicChars / totalChars;
  
  // Cyrillic-heavy text: ~3 chars per token
  // Latin-heavy text: ~4 chars per token
  // Mixed text: interpolate between them
  const charsPerToken = 4 - (cyrillicRatio * 1); // 3-4 range
  
  return Math.ceil(totalChars / charsPerToken);
}

/**
 * Build compact strategy object for use in AI prompts
 * Extracts only essential strategy fields to reduce token usage
 * 
 * @param {Object} strategy - Full strategy object from analysis
 * @returns {Object} Compact strategy with only essential fields
 */
export function buildStrategyCompact(strategy) {
  if (!strategy) return null;
  
  return {
    dietType: strategy.dietType || 'Балансирана',
    weeklyMealPattern: strategy.weeklyMealPattern || 'Традиционна',
    mealTiming: strategy.mealTiming?.pattern || '3 хранения дневно',
    keyPrinciples: (strategy.keyPrinciples || []).slice(0, 3).join('; '), // Only top 3
    foodsToInclude: (strategy.foodsToInclude || []).slice(0, 5).join(', '), // Only top 5
    foodsToAvoid: (strategy.foodsToAvoid || []).slice(0, 5).join(', '), // Only top 5
    psychologicalSupport: (strategy.psychologicalSupport || []).slice(0, 3),
    supplementRecommendations: (strategy.supplementRecommendations || []).slice(0, 3),
    hydrationStrategy: strategy.hydrationStrategy || 'препоръки за вода'
  };
}

/**
 * Build compact analysis object for use in AI prompts
 * Extracts only essential analysis fields to reduce token usage
 * 
 * @param {Object} analysis - Full analysis object
 * @returns {Object} Compact analysis with only essential fields
 */
export function buildAnalysisCompact(analysis) {
  if (!analysis) return null;
  
  return {
    healthStatus: analysis.healthStatus || 'Добро здраве',
    metabolicState: analysis.metabolicState || 'Нормален',
    energyPattern: analysis.energyPattern || 'Стабилна енергия',
    keyFindings: (analysis.keyFindings || []).slice(0, 5).join('; '), // Only top 5
    primaryConcerns: (analysis.primaryConcerns || []).slice(0, 3).join('; '), // Only top 3
    recommendations: (analysis.recommendations || []).slice(0, 3).join('; ') // Only top 3
  };
}

/**
 * Build modifications section for AI prompts
 * Creates a formatted string of dietary modifications
 * 
 * @param {Array} modifications - Array of modification strings
 * @returns {string} Formatted modifications section
 */
export function buildModificationsSection(modifications) {
  if (!modifications || modifications.length === 0) {
    return 'Няма модификации';
  }
  
  return modifications.map(mod => `- ${mod}`).join('\n');
}

/**
 * Build previous days context for progressive meal plan generation
 * Creates a compact summary of previously generated days
 * 
 * @param {Array} previousDays - Array of day objects with meals
 * @returns {string} Formatted context string
 */
export function buildPreviousDaysContext(previousDays) {
  if (!previousDays || previousDays.length === 0) {
    return '';
  }
  
  const context = previousDays.map(day => {
    const meals = day.meals?.map(m => `${m.type}: ${m.name}`).join(', ') || 'няма хранения';
    return `Ден ${day.day}: ${meals} (${day.totalCalories || '?'} kcal)`;
  }).join('\n');
  
  return `\n=== ПРЕДХОДНИ ДНИ ===\n${context}\n`;
}

/**
 * Generate a unique session or log ID
 * @param {string} prefix - Prefix for the ID (e.g., 'session', 'regen', 'ai_log')
 * @returns {string} Unique ID with timestamp and random component
 */
export function generateUniqueId(prefix = 'id') {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `${prefix}_${Date.now()}_${crypto.randomUUID().substring(0, 8)}`;
  }
  return `${prefix}_${Date.now()}_${Math.random().toString(36).substring(2, 10)}`;
}
