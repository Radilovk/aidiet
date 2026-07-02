/**
 * Shared plan display helpers for plan.html and plan-book.html.
 */
(function (global) {
  'use strict';

  var PLAN_DAY_NUMBER_TO_KEY = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];

  var MEAL_TYPE_ALIASES = {
    'Закуска': 'Хранене 1',
    'Обяд': 'Хранене 2',
    'Следобедна закуска': 'Хранене 3',
    'Следобедна': 'Хранене 3',
    'Десерт': 'Хранене 3',
    'Вечеря': 'Хранене 4',
    'Късна закуска': 'Хранене 5',
    'Междинно': 'Хранене 3',
    'Междинна закуска': 'Хранене 3',
    'Снак': 'Хранене 3',
    'Снек': 'Хранене 3',
    'Лека закуска': 'Хранене 3',
    'Предвечерна закуска': 'Хранене 5',
    'Нощна закуска': 'Хранене 5',
    'Вода с лимон/Зелен чай': 'Напитка',
    'Вода с лимон': 'Напитка',
    'Зелен чай': 'Напитка',
    'Напитка': 'Напитка',
    'Чай': 'Напитка',
    'Кафе': 'Напитка',
    'Напитки': 'Напитка'
  };

  function normalizeWeekPlanMealTypes(weekPlan) {
    if (!weekPlan) return;
    Object.keys(weekPlan).forEach(function (dayKey) {
      var day = weekPlan[dayKey];
      if (!day || !Array.isArray(day.meals)) return;
      day.meals.forEach(function (meal) {
        if (!meal || !meal.type) return;
        var name = (meal.name || '').toLowerCase().trim();
        if (name === 'свободно хранене' && meal.type !== 'Свободно хранене') {
          meal.type = 'Свободно хранене';
        } else if (MEAL_TYPE_ALIASES[meal.type]) {
          meal.type = MEAL_TYPE_ALIASES[meal.type];
        }
      });
    });
  }

  function migrateMealTypes(plan) {
    if (plan && plan.weekPlan) normalizeWeekPlanMealTypes(plan.weekPlan);
  }

  function correctPlanCalories(plan) {
    if (!plan || !plan.weekPlan) return;
    Object.keys(plan.weekPlan).forEach(function (dayKey) {
      var dayData = plan.weekPlan[dayKey];
      if (!dayData || !Array.isArray(dayData.meals)) return;
      var dayNum = parseInt(dayKey.replace('day', ''), 10);
      var weekdayKey = (dayNum >= 1 && dayNum <= 7) ? PLAN_DAY_NUMBER_TO_KEY[dayNum - 1] : null;
      var totalCal = 0;
      var totalProtein = 0;
      var totalCarbs = 0;
      var totalFats = 0;
      dayData.meals.forEach(function (meal) {
        if (meal.type === 'Свободно хранене') {
          var freeCal = 0;
          if (plan.strategy && plan.strategy.weeklyScheme && weekdayKey) {
            var ds = plan.strategy.weeklyScheme[weekdayKey];
            if (ds && Array.isArray(ds.mealBreakdown)) {
              var lunchEntry = ds.mealBreakdown.find(function (m) {
                return m.type === 'Хранене 2' || m.type === 'Свободно хранене';
              });
              if (lunchEntry && lunchEntry.calories) freeCal = parseInt(lunchEntry.calories, 10) || 0;
            }
            if (!freeCal && plan.strategy.weeklyScheme[weekdayKey]) {
              var ds2 = plan.strategy.weeklyScheme[weekdayKey];
              if (ds2.calories && ds2.meals) freeCal = Math.round(ds2.calories / ds2.meals);
            }
          }
          if (freeCal > 0) meal._plannedCalories = freeCal;
          totalCal += freeCal;
          if (plan.strategy && plan.strategy.weeklyScheme && weekdayKey) {
            var dsFree = plan.strategy.weeklyScheme[weekdayKey];
            if (dsFree && Array.isArray(dsFree.mealBreakdown)) {
              var freeEntry = dsFree.mealBreakdown.find(function (m) {
                return m.type === 'Хранене 2' || m.type === 'Свободно хранене';
              });
              if (freeEntry) {
                totalProtein += parseFloat(freeEntry.protein) || 0;
                totalCarbs += parseFloat(freeEntry.carbs) || 0;
                totalFats += parseFloat(freeEntry.fats) || 0;
              }
            }
          }
          return;
        }
        if (meal.macros) {
          var p = parseFloat(meal.macros.protein) || 0;
          var c = parseFloat(meal.macros.carbs) || 0;
          var f = parseFloat(meal.macros.fats) || 0;
          var calcCal = Math.round(p * 4 + c * 4 + f * 9);
          if (calcCal > 0) meal.calories = calcCal;
          totalProtein += p;
          totalCarbs += c;
          totalFats += f;
        }
        totalCal += parseInt(meal.calories, 10) || 0;
      });
      if (!dayData.dailyTotals) dayData.dailyTotals = {};
      dayData.dailyTotals.calories = totalCal;
      if (totalProtein > 0) dayData.dailyTotals.protein = Math.round(totalProtein);
      if (totalCarbs > 0) dayData.dailyTotals.carbs = Math.round(totalCarbs);
      if (totalFats > 0) dayData.dailyTotals.fats = Math.round(totalFats);
    });
  }

  function escapeHtml(text) {
    if (text == null) return '';
    var div = document.createElement('div');
    div.textContent = String(text);
    return div.innerHTML;
  }

  function escapeHtmlWithBreaks(text) {
    return escapeHtml(text).replace(/\n/g, '<br>');
  }

  function renderMealDescriptionHtml(description) {
    if (!description) return '';
    var items = [];
    var lines = String(description).split(/\n/).map(function (l) { return l.trim(); }).filter(Boolean);
    if (lines.length === 1 && lines[0].indexOf(';') >= 0) {
      lines = lines[0].split(';').map(function (s) { return s.trim(); }).filter(Boolean);
    }
    lines.forEach(function (line) {
      var chunks = line.split(';').map(function (s) { return s.replace(/^[•\-\*]\s*/, '').trim(); }).filter(Boolean);
      chunks.forEach(function (sp) {
        var m = sp.match(/^(.+?)\s+(\d+(?:[.,]\d+)?)\s*(g|г)\b(?:\s*[—\-]\s*(.+))?$/i);
        if (m) items.push({ name: m[1].trim(), grams: m[2] + 'g', note: (m[4] || '').trim() });
      });
    });
    if (!items.length) return escapeHtmlWithBreaks(description);
    var html = '<div class="modal-ingredients-title">Състав</div><ul class="modal-ingredients-list">';
    items.forEach(function (it) {
      html += '<li><span class="ingredient-name">' + escapeHtml(it.name) +
        (it.note ? '<span class="ingredient-note"> — ' + escapeHtml(it.note) + '</span>' : '') +
        '</span><span class="ingredient-grams">' + escapeHtml(it.grams) + '</span></li>';
    });
    html += '</ul>';
    return html;
  }

  global.NutriPlanPlanUtils = {
    PLAN_DAY_NUMBER_TO_KEY: PLAN_DAY_NUMBER_TO_KEY,
    MEAL_TYPE_ALIASES: MEAL_TYPE_ALIASES,
    normalizeWeekPlanMealTypes: normalizeWeekPlanMealTypes,
    migrateMealTypes: migrateMealTypes,
    correctPlanCalories: correctPlanCalories,
    renderMealDescriptionHtml: renderMealDescriptionHtml
  };

  // Global aliases for inline scripts that expect bare function names.
  global.migrateMealTypes = migrateMealTypes;
  global.correctPlanCalories = correctPlanCalories;
  global.renderMealDescriptionHtml = renderMealDescriptionHtml;
  global.PLAN_DAY_NUMBER_TO_KEY = PLAN_DAY_NUMBER_TO_KEY;
})(typeof window !== 'undefined' ? window : globalThis);
