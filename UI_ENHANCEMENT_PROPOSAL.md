# UI Enhancement Proposal: Показване на Диетичен МОДИФИКАТОР

## Контекст

Архпромптът е **пълно интегриран** в backend и работи отлично. Backend API връща:
```json
{
  "mealPlan": { ... },
  "analysis": { ... },
  "strategy": {
    "dietaryModifier": "Средиземноморско",
    "modifierReasoning": "Балансиран подход за отслабване...",
    "dietType": "средиземноморска",
    ...
  }
}
```

**Проблем:** Frontend (`plan.html`) в момента **не показва** `strategy.dietaryModifier` и `strategy.modifierReasoning` на потребителя.

## Защо е Важно?

1. **Прозрачност** - Потребителят вижда каква логика стои зад плана
2. **Доверие** - Разбира че планът е персонализиран специално за него
3. **Образование** - Научава повече за диетични профили
4. **Мотивация** - Вижда че AI е взел предвид всички негови параметри

## Предложено Решение

### Опция 1: Badge над Meal Plan (Минимално)

Добави малък badge в горната част на плана:

```html
<!-- В plan.html, след <div class="container"> и преди meal cards -->
<div class="strategy-badge" id="strategyBadge" style="display: none;">
    <div class="badge-icon">🎯</div>
    <div class="badge-content">
        <div class="badge-title">Вашата Стратегия</div>
        <div class="badge-modifier" id="modifierName">Средиземноморско</div>
    </div>
</div>

<style>
.strategy-badge {
    background: linear-gradient(135deg, var(--primary-red), var(--primary-accent));
    border-radius: var(--radius);
    padding: 16px 20px;
    margin-bottom: 24px;
    display: flex;
    align-items: center;
    gap: 12px;
    box-shadow: var(--shadow);
    color: white;
}

.badge-icon {
    font-size: 28px;
}

.badge-title {
    font-size: 0.75rem;
    opacity: 0.9;
    text-transform: uppercase;
    letter-spacing: 0.5px;
}

.badge-modifier {
    font-size: 1.1rem;
    font-weight: 700;
}
</style>

<script>
// В loadDietData() функцията, след зареждане на dietPlan:
if (dietPlan.strategy && dietPlan.strategy.dietaryModifier) {
    const badge = document.getElementById('strategyBadge');
    const modifierName = document.getElementById('modifierName');
    
    modifierName.textContent = dietPlan.strategy.dietaryModifier;
    badge.style.display = 'flex';
}
</script>
```

**Визуален резултат:**
```
┌────────────────────────────────────┐
│ 🎯  ВАШАТА СТРАТЕГИЯ               │
│     Средиземноморско               │
└────────────────────────────────────┘
```

---

### Опция 2: Accordion секция (Детайлно)

Добави нова accordion секция с пълна информация:

```html
<!-- В accordion секцията, след Supplements -->
<div class="acc-item" id="strategyAccordion" style="display: none;">
    <div class="acc-header" onclick="toggleAccordion(this)">
        <span><i class="fas fa-brain"></i> AI Диетична Стратегия</span>
        <i class="fas fa-chevron-down chevron"></i>
    </div>
    <div class="acc-content">
        <div class="acc-content-inner">
            <div class="strategy-info">
                <div class="strategy-modifier-card">
                    <div class="modifier-label">Избран Профил:</div>
                    <div class="modifier-value" id="modifierValue">Средиземноморско</div>
                </div>
                <div class="strategy-reasoning">
                    <div class="reasoning-label">
                        <i class="fas fa-lightbulb"></i> Защо този профил?
                    </div>
                    <p id="modifierReasoning">
                        Балансиран подход за отслабване с качествени мазнини...
                    </p>
                </div>
            </div>
        </div>
    </div>
</div>

<style>
.strategy-info {
    display: flex;
    flex-direction: column;
    gap: 16px;
}

.strategy-modifier-card {
    background: linear-gradient(135deg, var(--primary-red), var(--primary-accent));
    border-radius: 12px;
    padding: 16px;
    color: white;
    text-align: center;
}

.modifier-label {
    font-size: 0.75rem;
    opacity: 0.9;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    margin-bottom: 8px;
}

.modifier-value {
    font-size: 1.4rem;
    font-weight: 700;
}

.strategy-reasoning {
    background: var(--soft-red);
    border-radius: 12px;
    padding: 16px;
}

.reasoning-label {
    font-weight: 700;
    color: var(--primary-red);
    margin-bottom: 12px;
    display: flex;
    align-items: center;
    gap: 8px;
}

.reasoning-label i {
    font-size: 1.2rem;
}

#modifierReasoning {
    color: var(--text-dark);
    line-height: 1.6;
    margin: 0;
}
</style>

<script>
// В renderRecommendations() функцията:
if (dietPlan.strategy) {
    const strategyAccordion = document.getElementById('strategyAccordion');
    const modifierValue = document.getElementById('modifierValue');
    const modifierReasoning = document.getElementById('modifierReasoning');
    
    if (dietPlan.strategy.dietaryModifier) {
        modifierValue.textContent = dietPlan.strategy.dietaryModifier;
    }
    
    if (dietPlan.strategy.modifierReasoning) {
        modifierReasoning.textContent = dietPlan.strategy.modifierReasoning;
    }
    
    strategyAccordion.style.display = 'block';
}
</script>
```

**Визуален резултат:**
```
╔═══════════════════════════════════════╗
║ 🧠 AI Диетична Стратегия         ▼   ║
╠═══════════════════════════════════════╣
║                                       ║
║  ┌─────────────────────────────────┐ ║
║  │    Избран Профил:               │ ║
║  │  Средиземноморско               │ ║
║  └─────────────────────────────────┘ ║
║                                       ║
║  💡 Защо този профил?                ║
║  Балансиран подход за отслабване с   ║
║  качествени мазнини (зехтин),        ║
║  подходящ за управление на стрес...  ║
║                                       ║
╚═══════════════════════════════════════╝
```

---

### Опция 3: Modal с детайли (Най-богато)

Добави бутон "ℹ️ За Стратегията" който отваря modal с пълна информация:

```html
<!-- Бутон в header до theme toggle -->
<button class="strategy-info-btn" onclick="openStrategyModal()" id="strategyBtn" style="display: none;">
    <i class="fas fa-info-circle"></i>
</button>

<!-- Modal -->
<div id="strategyModal" class="modal">
    <div class="modal-content strategy-modal">
        <span class="close" onclick="closeStrategyModal()">&times;</span>
        <h2><i class="fas fa-brain"></i> AI Диетична Стратегия</h2>
        
        <div class="strategy-modal-body">
            <!-- Modifier Badge -->
            <div class="modal-modifier-badge">
                <div class="badge-label">Избран Диетичен Профил</div>
                <div class="badge-value" id="modalModifier">Средиземноморско</div>
            </div>
            
            <!-- Reasoning -->
            <div class="modal-section">
                <h3>💡 Защо този профил е избран за Вас?</h3>
                <p id="modalReasoning">...</p>
            </div>
            
            <!-- Additional Info -->
            <div class="modal-section">
                <h3>📋 Какво означава това?</h3>
                <ul id="modalPrinciples"></ul>
            </div>
            
            <!-- Foods -->
            <div class="modal-foods">
                <div class="foods-to-include">
                    <h4>✅ Препоръчани Храни</h4>
                    <ul id="modalFoodsInclude"></ul>
                </div>
                <div class="foods-to-avoid">
                    <h4>🚫 Храни за Избягване</h4>
                    <ul id="modalFoodsAvoid"></ul>
                </div>
            </div>
        </div>
    </div>
</div>

<script>
function openStrategyModal() {
    document.getElementById('strategyModal').style.display = 'block';
}

function closeStrategyModal() {
    document.getElementById('strategyModal').style.display = 'none';
}

// В loadDietData():
if (dietPlan.strategy) {
    // Покажи бутона
    document.getElementById('strategyBtn').style.display = 'block';
    
    // Попълни modal данни
    if (dietPlan.strategy.dietaryModifier) {
        document.getElementById('modalModifier').textContent = 
            dietPlan.strategy.dietaryModifier;
    }
    
    if (dietPlan.strategy.modifierReasoning) {
        document.getElementById('modalReasoning').textContent = 
            dietPlan.strategy.modifierReasoning;
    }
    
    if (dietPlan.strategy.keyPrinciples) {
        document.getElementById('modalPrinciples').innerHTML = 
            dietPlan.strategy.keyPrinciples.map(p => `<li>${p}</li>`).join('');
    }
    
    if (dietPlan.strategy.foodsToInclude) {
        document.getElementById('modalFoodsInclude').innerHTML = 
            dietPlan.strategy.foodsToInclude.map(f => `<li>${f}</li>`).join('');
    }
    
    if (dietPlan.strategy.foodsToAvoid) {
        document.getElementById('modalFoodsAvoid').innerHTML = 
            dietPlan.strategy.foodsToAvoid.map(f => `<li>${f}</li>`).join('');
    }
}
</script>
```

---

## Препоръка

**Препоръчвам Опция 1 (Badge)** защото:
- ✅ Минимално инвазивна
- ✅ Показва най-важната информация (МОДИФИКАТОР)
- ✅ Не претоварва UI
- ✅ Лесна за имплементация (5-10 минути)
- ✅ Mobile-friendly

**Опция 2 и 3** могат да се добавят по-късно ако потребителите искат повече детайли.

## Имплементация

### Кратки стъпки (Опция 1):

1. Добави HTML за badge след `<div class="container">` (линия ~1107)
2. Добави CSS стилове в `<style>` секцията
3. Добави JavaScript в `loadDietData()` функцията (линия ~1374)

**Време:** ~10 минути  
**Тестване:** Генерирай нов план и виж badge-a

---

## Важна Забележка

**Тази промяна е ОПЦИОНАЛНА**. Текущата система работи отлично и без показването на МОДИФИКАТОРА в UI. Архпромптът вършит работата си зад кулисите и генерира качествени планове.

Показването на МОДИФИКАТОРА е само **enhancement** за подобряване на user experience и прозрачност.

---

**Дата:** 2026-01-07  
**Статус:** Предложение за разглеждане  
**Приоритет:** Нисък (Nice-to-have)
