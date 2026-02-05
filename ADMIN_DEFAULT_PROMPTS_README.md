# Admin Panel Default Prompts - Complete Guide

## 📋 Overview

This directory contains comprehensive documentation about how default prompts work in the admin panel and how they update when worker.js changes.

---

## ❓ Original Question

> "сега при евентуална промяна на worker.js и промптовете вътре, ще се актуализира ли при кликване на 'viewDefaultPrompt' бутона и в админ панела"
>
> **Translation:** "Now if there's a change to worker.js and the prompts inside, will it be updated when clicking the 'viewDefaultPrompt' button in the admin panel?"

---

## ✅ Answer

# YES! 

**Default prompts update automatically after deploying worker.js with `wrangler deploy`.**

---

## 📚 Documentation Files

### 1. Quick Reference (Bulgarian)
**File:** `БЪРЗ_ОТГОВОР_DEFAULT_PROMPTS.md`

Quick answer in Bulgarian with:
- 3 simple steps to update prompts
- FAQ
- Command examples
- Timeline (how long it takes)

**Best for:** Quick lookup, reference while working

---

### 2. Comprehensive Answer (Bulgarian)
**File:** `ОТГОВОР_АКТУАЛИЗАЦИЯ_ПРОМПТИ.md`

Complete answer document with:
- Full explanation of how it works
- Step-by-step update process
- Tests and verification
- FAQ
- Troubleshooting

**Best for:** Understanding the complete picture

---

### 3. Technical Documentation (English + Bulgarian)
**File:** `DEFAULT_PROMPT_UPDATE_BEHAVIOR.md`

Detailed technical documentation with:
- Architecture explanation
- Code flow diagrams
- API endpoints
- Deployment process
- Maintenance guidelines

**Best for:** Developers, technical team

---

### 4. Visual Guide (Bulgarian)
**File:** `DEFAULT_PROMPT_UPDATE_VISUAL_BG.md`

Visual documentation with:
- ASCII diagrams
- Flowcharts
- Timeline visualizations
- Architecture diagrams
- Test scenarios

**Best for:** Visual learners, presentations

---

## 🚀 Quick Start

### To Update Default Prompts:

```bash
# 1. Edit worker.js (lines 4447-5048)
vim worker.js

# 2. Deploy to Cloudflare
wrangler deploy

# 3. Wait ~30 seconds

# 4. Verify in admin panel
# Open: https://radilov-k.github.io/aidiet/admin.html
# Click: "Виж Стандартен Промпт"
# Result: ✅ New prompt appears!
```

---

## 🔑 Key Facts

| Fact | Value |
|------|-------|
| **Prompts location** | worker.js lines 4447-5048 |
| **Update method** | `wrangler deploy` |
| **Update time** | ~1 minute (deploy + propagation) |
| **Automatic?** | ✅ Yes, after deployment |
| **Cache issues?** | ❌ No |
| **All users updated?** | ✅ Yes, simultaneously |

---

## 📊 Prompt Statistics

| Prompt Type | Lines | Characters | Language |
|-------------|-------|------------|----------|
| analysis | 159 | 7,424 | Bulgarian |
| strategy | 130 | 9,398 | Bulgarian |
| meal_plan | 235 | 11,605 | Bulgarian |
| summary | 29 | 1,147 | Bulgarian |
| consultation | 14 | 693 | Bulgarian |
| modification | 80 | 3,261 | Bulgarian |
| **TOTAL** | **647** | **33,528** | **100% BG** |

---

## 🎯 Common Use Cases

### Use Case 1: Update AI Instructions
**Scenario:** You want to add a new instruction to the analysis prompt.

**Steps:**
1. Edit worker.js line 4448
2. Add your instruction
3. Run `wrangler deploy`
4. Verify in admin panel

**Time:** ~2 minutes

---

### Use Case 2: Fix Typo in Prompt
**Scenario:** You found a typo in the meal_plan prompt.

**Steps:**
1. Edit worker.js line 4739
2. Fix the typo
3. Run `wrangler deploy`
4. Done!

**Time:** ~1 minute

---

### Use Case 3: Add New Dietary Rule
**Scenario:** You want to add a new food restriction rule.

**Steps:**
1. Edit worker.js in the relevant prompt
2. Add the rule following existing format
3. Run `node --check worker.js` (validate syntax)
4. Run `wrangler deploy`
5. Test with actual plan generation

**Time:** ~5 minutes

---

## 🧪 Testing

### Test Current Deployment
```bash
# Check what's deployed now
curl https://aidiet.radilov-k.workers.dev/api/admin/get-default-prompt?type=analysis
```

### Test All Prompts
```bash
# Get line counts for all prompts
for type in analysis strategy meal_plan summary consultation modification; do
  echo "$type:"
  curl -s "https://aidiet.radilov-k.workers.dev/api/admin/get-default-prompt?type=$type" | \
    jq -r '.prompt' | wc -l
done
```

---

## 🔧 Troubleshooting

### Issue: "Prompt not updating"
**Solution:**
1. Verify you ran `wrangler deploy`
2. Wait 30 seconds for propagation
3. Hard refresh admin panel (Ctrl+Shift+R)
4. Check deployment status in Cloudflare dashboard

### Issue: "Deploy fails"
**Solution:**
1. Run `node --check worker.js`
2. Fix any syntax errors
3. Check wrangler.toml configuration
4. Verify Cloudflare credentials

### Issue: "Can't see changes"
**Solution:**
1. Clear browser cache
2. Check you're looking at the right prompt type
3. Verify in curl: `curl https://aidiet.radilov-k.workers.dev/api/admin/get-default-prompt?type=analysis`

---

## 📖 Related Documentation

- `ADMIN_PROMPT_FIX_DOCUMENTATION.md` - Original prompt fix (2026-02-05)
- `DEPLOYMENT_CHECKLIST.md` - Full deployment guide
- `WORKER_README.md` - Worker architecture
- `admin.html` (lines 2132-2153) - viewDefaultPrompt() function
- `worker.js` (lines 4447-5048) - Default prompts definition

---

## 🎓 Learning Path

1. **Start here:** `БЪРЗ_ОТГОВОР_DEFAULT_PROMPTS.md` (Quick answer in Bulgarian)
2. **Understand flow:** `DEFAULT_PROMPT_UPDATE_VISUAL_BG.md` (Visual diagrams)
3. **Deep dive:** `DEFAULT_PROMPT_UPDATE_BEHAVIOR.md` (Technical details)
4. **Complete reference:** `ОТГОВОР_АКТУАЛИЗАЦИЯ_ПРОМПТИ.md` (All information)

---

## ⚡ Quick Commands

```bash
# Check syntax
node --check worker.js

# Test locally
wrangler dev

# Deploy to production
wrangler deploy

# View deployment logs
wrangler tail

# Get current analysis prompt
curl https://aidiet.radilov-k.workers.dev/api/admin/get-default-prompt?type=analysis
```

---

## 📞 Support

If you have questions or issues:

1. **Check documentation:**
   - Start with quick reference
   - Review visual guide
   - Read technical docs

2. **Test locally:**
   ```bash
   wrangler dev
   # Test: http://localhost:8787/api/admin/get-default-prompt?type=analysis
   ```

3. **Verify deployment:**
   ```bash
   wrangler deploy
   # Look for: ✅ Published aidiet-worker
   ```

4. **Check logs:**
   ```bash
   wrangler tail
   ```

---

## 🎯 Summary

**Question:** Do default prompts update when worker.js changes?

**Answer:** ✅ YES, automatically after `wrangler deploy`

**Time:** ~1 minute (deploy + propagation)

**Process:** Edit worker.js → Deploy → Wait → Done ✅

**Documentation:** 4 comprehensive guides in this directory

---

**Last Updated:** 2026-02-05  
**Version:** 1.0  
**Status:** ✅ Complete and tested  
**Languages:** Bulgarian + English
