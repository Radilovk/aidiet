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

## Task: Fix Registered Client Plan Update Workflow (2026-05-19)

### Problem Statement
Registered clients who already have an activated diet plan cannot update their plan without getting stuck in a "plan-pending" state waiting for admin approval. This creates a broken workflow where:
1. Registered clients submit questionnaire2 to create/update their plan
2. System sets planStatus='pending' and requires admin approval
3. Client cannot see or use their new plan until admin approves
4. This is unintuitive - existing approved clients should be able to update their plans

### Root Cause
In `worker.js` function `handleUpdateClientPlan` (line 4492-4495):
- ALL plan updates go to 'pending' status regardless of whether client is new or existing/approved
- The comment says "Any new or replaced plan must go back to pending review"
- But this doesn't distinguish between new clients (who need review) vs existing approved clients (who should get auto-approval)

### Investigation Findings
1. Client data can be linked to userId via clientData.userId (line 4490)
2. Admin panel has activation endpoint `/api/admin/activate-client-plan` (line 13152)
3. When plan is activated: planStatus='activated' and planActivatedAt is set
4. Current flow: questionnaire2 → plan generation → update-client-plan → planStatus='pending' → plan-pending.html → wait for admin

### Proposed Solution
Modify `handleUpdateClientPlan` to:
- Check if clientData.userId already exists and is linked to a previously activated plan
- If yes: Auto-activate the new plan (set planStatus='activated', planActivatedAt=now)
- If no: Keep current behavior (planStatus='pending' for review)
- This allows existing approved clients to update freely while protecting first-time questionnaires from abuse

### Status
- [ ] Implement fix in handleUpdateClientPlan
- [ ] Test questionnaire2 flow with existing client
- [ ] Verify admin panel still works for new plans
- [ ] Verify plan-pending.html works for new first-time plans

### Implementation Details

#### 1. Modified handleUpdateClientPlan in worker.js (lines 4488-4544)
- Added check: `const wasPreviouslyActivated = Boolean(clientData.planActivatedAt)`
- If wasPreviouslyActivated: 
  - Sets planStatus='activated' and planActivatedAt=now (auto-activates)
  - Syncs updated plan to user_profile KV entry
- If not previously activated:
  - Sets planStatus='pending' (requires admin review)
  - Clears planActivatedAt
- Admin notifications now only sent when planStatus='pending' (new clients needing review)
- Auto-activated plans just log the action without spamming admin

#### 2. Enhanced plan-pending.html UI (lines 612-642)
- Added autoCheckPlanStatus function with 2-second delay on page load
- Auto-checks plan status without user interaction
- If auto-activated, automatically proceeds to plan setup
- Manual "Провери статус на плана" button still available as fallback
- Better UX: existing clients see their plan immediately

### Workflow After Fix

**For Existing Approved Clients:**
1. Client submits questionnaire2 → analysis.html
2. handleUpdateClientPlan is called:
   - Detects wasPreviouslyActivated=true
   - Sets planStatus='activated'
   - Syncs to user_profile
3. Client goes to plan-pending.html
4. autoCheckPlanStatus runs after 2 seconds:
   - Checks /api/client-plan-status
   - Gets status='activated'
   - Calls checkPlanStatus()
   - Shows password setup and redirects to plan
5. **No admin approval needed!**

**For First-Time/New Clients:**
1. Client submits questionnaire2 → analysis.html
2. handleUpdateClientPlan is called:
   - Detects wasPreviouslyActivated=false
   - Sets planStatus='pending'
   - Sends admin notification
3. Client goes to plan-pending.html
4. autoCheckPlanStatus runs but finds status='pending'
5. Client sees message: "Новият план е вече създаден и чака финално одобрение от специалист."
6. Admin reviews and approves via admin panel

### Status
- [x] Implement fix in handleUpdateClientPlan
- [x] Add auto-activation logic for existing clients
- [x] Update user profile sync for auto-activated plans
- [x] Add autoCheckPlanStatus in plan-pending.html
- [ ] Test questionnaire2 flow with existing client
- [ ] Verify admin panel still works for new plans
- [ ] Verify plan-pending.html works for new first-time plans
