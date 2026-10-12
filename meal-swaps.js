/**
 * Смяна на хранене с алтернатива. Алтернативите идват с плана (двигателят ги
 * е проверил по същите правила); тук само се разменят местата им.
 *
 * Изборът се пази в localStorage („mealSwaps“) по ден и хранене и се прилага
 * върху всеки нов екземпляр на същия план (от сървъра, от кеша, от чата).
 * Смененото хранене носи _originalDishId — по него сървърът при седмичното
 * обновяване разбира какво е сменено и се учи (nutrition-engine/dish-learning.js).
 * Без отделни заявки и записи на сървъра.
 */
(function (global) {
  'use strict';

  var KEY = 'mealSwaps';

  function load() {
    try {
      var v = JSON.parse(global.localStorage.getItem(KEY) || '{}');
      return v && typeof v === 'object' ? v : {};
    } catch (_) { return {}; }
  }

  function save(map) {
    try { global.localStorage.setItem(KEY, JSON.stringify(map)); } catch (_) { /* без памет — изборът важи до презареждане */ }
  }

  function strip(meal) {
    var c = {};
    for (var k in meal) {
      if (Object.prototype.hasOwnProperty.call(meal, k) && k !== 'alternatives' && k !== '_originalDishId') c[k] = meal[k];
    }
    return c;
  }

  function mealAt(plan, dayKey, idx) {
    var day = plan && plan.weekPlan && plan.weekPlan[dayKey];
    return day && Array.isArray(day.meals) ? day.meals[idx] : null;
  }

  function originalOf(meal) {
    return (meal && (meal._originalDishId || meal.dishId)) || '';
  }

  /** Сменя хранене с алтернативата dishId. Връща true при успех. */
  function swapIn(plan, dayKey, idx, dishId) {
    var meal = mealAt(plan, dayKey, idx);
    if (!meal || !Array.isArray(meal.alternatives)) return false;
    if (meal.dishId === dishId) return true;
    var alt = null;
    for (var i = 0; i < meal.alternatives.length; i++) {
      if (meal.alternatives[i] && meal.alternatives[i].dishId === dishId) { alt = meal.alternatives[i]; break; }
    }
    if (!alt) return false;
    var originalId = originalOf(meal);
    var rest = meal.alternatives.filter(function (a) { return a !== alt; });
    var next = strip(alt);
    next.type = meal.type;
    if (meal.targetCalories != null) next.targetCalories = meal.targetCalories;
    next.alternatives = [strip(meal)].concat(rest);
    if (dishId !== originalId) next._originalDishId = originalId;
    plan.weekPlan[dayKey].meals[idx] = next;
    var t = plan.weekPlan[dayKey].dailyTotals;
    if (t && typeof t === 'object') {
      // Дневният сбор следва избраното хранене.
      var diff = function (a, b) { return (Number(a) || 0) - (Number(b) || 0); };
      t.calories = Math.round((Number(t.calories) || 0) + diff(next.calories, meal.calories));
      ['protein', 'carbs', 'fats'].forEach(function (k) {
        t[k] = Math.round((Number(t[k]) || 0) + diff(next.macros && next.macros[k], meal.macros && meal.macros[k]));
      });
    }
    return true;
  }

  /**
   * Прилага запазените избори върху плана (на място). Избор, който вече не
   * съвпада с плана (нова седмица, ново меню), се забравя.
   */
  function apply(plan) {
    if (!plan || !plan.weekPlan) return plan;
    var map = load();
    var changed = false;
    Object.keys(map).forEach(function (key) {
      var rec = map[key];
      var parts = key.split(':');
      var meal = mealAt(plan, parts[0], Number(parts[1]));
      if (!rec || !meal || originalOf(meal) !== rec.from) { delete map[key]; changed = true; return; }
      if (meal.dishId !== rec.to && !swapIn(plan, parts[0], Number(parts[1]), rec.to)) { delete map[key]; changed = true; }
    });
    if (changed) save(map);
    return plan;
  }

  /** Избор от потребителя: dishId е алтернатива или първоначалното ястие. */
  function choose(plan, dayKey, idx, dishId) {
    var meal = mealAt(plan, dayKey, idx);
    if (!meal) return false;
    var from = originalOf(meal);
    if (!swapIn(plan, dayKey, idx, dishId)) return false;
    var map = load();
    var key = dayKey + ':' + idx;
    if (dishId === from) delete map[key];
    else map[key] = { from: from, to: dishId, at: new Date().toISOString() };
    save(map);
    return true;
  }

  global.NutriMealSwaps = { apply: apply, choose: choose, originalOf: originalOf };
})(typeof window !== 'undefined' ? window : globalThis);
