# PWA/APK Index Page Flickering Fix

**Дата:** 2026-05-19  
**Проблем:** При влизане в PWA, APK или уеб приложението имаше неприятно преминаване през index страницата с премигване и промяна на бутоните

## Проблем

Когато потребител с вече създаден план отваря PWA/APK приложението:

1. **Винаги стартира от index.html** - `manifest.json` има `start_url: "/"` 
2. **Има забавяне** - Firebase auth state трябва да се зареди
3. **Премигва UI** - бутоните се променят когато auth state се зареди
4. **После пренасочва** - видимо се пренасочва към plan.html

Това създаваше неприятно потребителско изживяване с видимо премигване.

## Решение

### 1. Ранно пренасочване (Early Redirect)

Добавен е синхронен скрипт в `<head>` който изпълнява **преди** DOM да се зареди:

```javascript
<script>(function(){
    var params = new URLSearchParams(window.location.search);
    if (params.has('stay') || params.has('login')) return;
    
    var planJobId = localStorage.getItem('planJobId');
    if (planJobId) {
        var src = localStorage.getItem('planJobSource');
        window.location.replace(src === 'questionnaire' ? 'questionnaire.html' : 'questionnaire2.html');
        return;
    }
    
    var dietPlan = localStorage.getItem('dietPlan');
    if (!dietPlan) return;
    
    var planTarget;
    var planSource = localStorage.getItem('planSource');
    var pendingClientId = localStorage.getItem('pendingClientId');
    
    if (planSource === 'questionnaire2' || pendingClientId) {
        planTarget = 'plan-pending.html';
    } else {
        planTarget = 'plan.html';
    }
    
    window.location.replace(planTarget);
})();
</script>
```

**Предимства:**
- ✅ Изпълнява се синхронно преди DOM да се зареди
- ✅ Използва localStorage (моментален достъп, без async)
- ✅ Пренасочва преди някакво UI да се покаже
- ✅ Уважава query параметри (?stay=1, ?login)

### 2. Скриване на Hero секцията

CSS промяна за скриване на hero докато auth check приключи:

```css
.hero {
    opacity: 0;
    transition: opacity 0.3s ease;
}
.hero.visible {
    opacity: 1;
}
```

JavaScript добавя `.visible` клас когато потребителя трябва да остане на index:

```javascript
const heroSection = document.querySelector('.hero');
if (heroSection) heroSection.classList.add('visible');
```

## Тестови Сценарии

### Трябва да пренасочи незабавно (без премигване):
- ✅ Потребител с одобрен план → пренасочва към plan.html
- ✅ Потребител с чакащ план (questionnaire2) → пренасочва към plan-pending.html  
- ✅ Потребител с план в процес на генериране (planJobId) → пренасочва към questionnaire2.html

### Трябва да остане на index:
- ✅ Нов потребител (без план, без auth) → показва index с "Започни промяната"
- ✅ Authenticated потребител без план → показва index с "Започни промяната"
- ✅ Потребител експлицитно навигира към index.html?stay=1 → показва index
- ✅ Потребител пренасочен за login (index.html?login) → показва login modal

### Не трябва да премигва:
- ✅ Hero секцията е скрита докато redirect решението не е взето
- ✅ Бутоните не променят състояние видимо по време на зареждане

## Технически детайли

### Защо localStorage вместо Firebase Auth?

Firebase Authentication е **асинхронен** и изисква мрежово заявление. Това създава забавяне.

localStorage е **синхронен** и моментален. Планът вече е съхранен локално след първо зареждане, така че можем да проверим незабавно.

### Защо window.location.replace() вместо window.location.href?

`replace()` заменя текущата history entry вместо да добавя нова. Това предотвратява:
- Нежелано "назад" поведение (връщане към index)
- История която не трябва да съществува

### Съвместимост

- ✅ PWA (Progressive Web App)
- ✅ APK (Android Package via TWA)
- ✅ Обикновен браузър
- ✅ iOS Safari (standalone mode)

## Файлове променени

- `index.html` - добавен early redirect script, CSS за hero opacity, JS за добавяне на .visible клас

## Известни ограничения

- Ако localStorage е изчистен но Firebase auth е все още активен, може да има кратко забавяне докато планът се зареди от сървъра
- На първо влизане на ново устройство (след инсталиране) ще има забавяне докато планът се възстанови

Това е очаквано и приемливо поведение - важното е да няма премигване при **нормално** ползване.

## Заключение

Това решение елиминира неприятното премигване и пренасочване през index.html когато потребителят отваря приложението. Потребители с план сега директно виждат тяхния план без никакво видимо междинно състояние.
