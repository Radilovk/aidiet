# Log Tasks

## 2026-05-19
- Задача: Подобряване на loading екрана при генериране на анализа за `analysis.html`, оптимизация за телефон, светла/тъмна тема, светлосенки/цветове/елементи, хаптик при визуални операции и премахване на разминаването между края на loading екрана и реалното отваряне на `analysis.html`.
- Направено: Преработен е диагностичният loader в `questionnaire2.html` с мобилен glass дизайн, фазови индикатори, по-добри цветове за светла/тъмна тема, haptic feedback при ключови фази и финализация, и прогресът вече се задържа под 100% до реално получаване на `analysis_completed`/`completed` от сървъра.
- Направено: Обновен е loader-ът в `analysis.html` с нов mobile-first card/orb дизайн, тъмна/светла тема и haptic feedback при показване на анализ или грешка.
- Направено: Синхронизиран е preview екранът `analysis-loading.html` с новия loader дизайн.
# Logtasks

- `handleUpdateClientPlan` now always resets the client plan to `pending` review and clears any stale activation timestamp.
- This fixes the case where a client that was already activated received a regenerated plan, but the admin panel still treated it as activated and did not surface it for approval.
- The admin push notification remains in place, so the update now both flags the client in the admin UI and notifies the admin browser.
- `GET /api/client-plan-status` now also returns whether a plan payload already exists for the pending client record.
- `plan-pending.html` uses that extra state to distinguish between “plan still being generated” and “new plan is ready but still waiting for final approval”.

## 2026-05-19 - Задача 2
- Задача: Замяна на дългия текст "Влезте, за да достъпите плана си" в логин прозореца с нещо по-кратко и адекватно.
- Направено: Заменен е текстът в два места (`index.html`):
  1. HTML елемент (ред 3786): от "Влезте, за да достъпите плана си" на "Имейл и парола"
  2. JavaScript функция `_applyLoginMode()` (ред 4083): от "Влезте, за да достъпите плана си" на "Имейл и парола"
- Причина: Новият текст е значително по-кратък (14 символа вместо 39), по-информативен и по-подходящ за контекста на формата за вход.
