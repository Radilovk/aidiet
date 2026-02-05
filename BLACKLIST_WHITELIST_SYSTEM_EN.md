# Blacklist & Whitelist System - Technical Summary

## Date: 2026-02-05
## Status: ✅ IMPLEMENTED

---

## Overview

The AI Diet system uses a dual blacklist (banned foods) and whitelist (allowed foods) system to control what foods can appear in meal plans.

---

## Blacklist (Banned Foods)

### 1. Hardcoded Blacklist (ADLE_V8_HARD_BANS)
**Location:** `worker.js`, line 1022

**Contents:**
- Onions, turkey meat, artificial sweeteners
- Honey, sugar, jam, syrups
- Ketchup, mayo, BBQ sauce
- Greek yogurt (plain yogurt only)

**Characteristics:**
- ✅ HARD BAN - always forbidden
- ✅ Cannot be changed by users
- ✅ Based on medical/nutritional reasons
- ✅ Checked by validation function

### 2. Dynamic Blacklist (from KV Storage)
**Location:** KV Storage key `food_blacklist`

**Management:** Via admin endpoints
- `GET /api/admin/get-blacklist` - Retrieve current blacklist
- `POST /api/admin/add-to-blacklist` - Add item to blacklist
- `POST /api/admin/remove-from-blacklist` - Remove item from blacklist

**Characteristics:**
- ✅ Dynamic - can be modified by administrator
- ✅ Stored in KV Storage
- ✅ Merged with ADLE_V8_HARD_BANS before sending to AI
- ✅ Installation-specific

### 3. Merged Blacklist
**Function:** `getMergedBlacklist(env)` (worker.js, line ~1096)

**How it works:**
1. Retrieves dynamic blacklist from KV storage
2. Merges with ADLE_V8_HARD_BANS
3. Removes duplicates using Set
4. Returns merged list

**Usage in prompts:**
```javascript
const mergedBlacklist = await getMergedBlacklist(env);
// In prompt:
0) HARD BANS: ${mergedBlacklist.join(', ')}
```

**Fallback:** Returns only ADLE_V8_HARD_BANS if KV storage unavailable

---

## Whitelist (Allowed Foods)

### Protein Whitelist (ADLE_V8_PROTEIN_WHITELIST)
**Location:** `worker.js`, line 1057

**Allowed proteins:**
- eggs, chicken, beef, lean pork, fish
- yogurt (plain), cottage cheese, cheese
- beans, lentils, chickpeas, peas

**BANNED proteins:**
- turkey meat (HARD BAN)
- rabbit/duck/goose/lamb/game (OFF whitelist)

### Rule R12: Outside-Whitelist with Justification
**Non-whitelist proteins** (line 1075) can be used ONLY if:
- Objectively required (MODE/medical/availability)
- Mainstream/universal
- Available in Bulgaria
- With added line: `Reason: ...`

---

## Integration

### In AI Prompts
Both `generateMealPlanChunkPrompt()` and `generateMealPlanPrompt()` now:
1. Retrieve merged blacklist via `await getMergedBlacklist(env)`
2. Inject into prompt: `${mergedBlacklist.join(', ')}`
3. Include whitelist requirements

### In Validation
**validatePlan()** (line 1110) checks:
- ✅ Hardcoded ADLE_V8_HARD_BANS
- ✅ Peas + fish forbidden combination
- ✅ Non-whitelist proteins require Reason:
- ⚠️ Does NOT check dynamic blacklist (requires refactoring)

---

## Known Limitations

### Validation doesn't check dynamic blacklist
**Issue:** 
- `validatePlan()` is synchronous
- No access to env (KV storage)
- Only checks ADLE_V8_HARD_BANS

**Impact:**
- Items from dynamic blacklist may pass validation
- AI won't use them (they're in prompt)
- Manual plans could slip through

**Solution:** Separate task to refactor validatePlan()

---

## Answer to Question

**"Is the blacklist and whitelist taken into account?"**

**YES! ✅**

**How:**
1. Blacklist merges from two sources (hardcoded + KV storage)
2. Merged blacklist passed to AI in prompts
3. AI doesn't use banned foods
4. Whitelist defines allowed foods by category
5. Non-whitelist foods require Reason: justification
6. Validation checks (partially) compliance

**Status:** ✅ WORKING  
**Date:** 2026-02-05

---

## Files Modified

- `worker.js`:
  - Added `getMergedBlacklist(env)` helper function (line ~1096)
  - Updated `generateMealPlanChunkPrompt()` to use merged blacklist
  - Updated `generateMealPlanPrompt()` to use merged blacklist (made async)

## Documentation Created

- `BLACKLIST_WHITELIST_СИСТЕМА_BG.md` - Comprehensive Bulgarian documentation
- `BLACKLIST_WHITELIST_SYSTEM_EN.md` - This English summary

---

*This document explains how the blacklist/whitelist system works in the AI Diet application.*
