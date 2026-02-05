# Archived Documentation

This directory contains historical development notes, implementation summaries, and fix documentation that were created during the development process. These files are kept for reference but are not part of the active project documentation.

## Directory Structure

### `/` (Root)
92 markdown/HTML files containing:
- **Analysis Reports:**
  - `ДОКЛАД_АНАЛИЗ_СХЕМА.md` - Comprehensive analysis of ПЪЛНА_СХЕМА_АНАЛИЗ_И_ПЛАН.md (Bulgarian, 1126 lines, 36 issues identified)
  - `SCHEMA_ANALYSIS_REPORT_SUMMARY_EN.md` - Executive summary of schema analysis (English)
  - `ПЪЛНА_СХЕМА_АНАЛИЗ_И_ПЛАН.md` - Full schema documentation (2138 lines)
  - `ПЛАН_ДЕЙСТВИЕ_ПРОБЛЕМИ.html` - **Interactive issue resolution tracker** (HTML form for tracking decisions on all 36 problems)
  - `РЪКОВОДСТВО_ПЛАН_ДЕЙСТВИЕ.md` - User guide for the issue tracker
- Implementation summaries and progress reports (IMPLEMENTATION_SUMMARY_*.md)
- Bug fix documentation (CORS_FIX_NOTES.md, JSON_PARSING_FIX.md, etc.)
- Feature integration notes (MEALLOGIC_INTEGRATION.md, etc.)
- Optimization reports (OPTIMIZATION_SUMMARY*.md, TOKEN_OPTIMIZATION*.md)
- PWA setup and fix documentation (PWA_*.md - 14 files)
- PR summaries and review notes (PR_SUMMARY*.md, REVIEW_SUMMARY*.md)
- Visual guides (VISUAL_GUIDE_*.md)
- Validation and testing guides (VALIDATION_*.md, TESTING_*.md)
- Bulgarian language duplicates of many documents

### `/assets`
Development reference files:
- `ICON_README.txt` - Icon creation and conversion guide
- `archprompt.txt` - Bulgarian AI prompt for meal planning (v5.1)
- `meallogic.txt` - English AI prompt for meal constructor (v8)
- `Icopx.png` - Unused icon file
- `icon-512x512e.png` - Duplicate icon file

### `/test-files`
Test and diagnostic HTML files:
- `test.html` - Main test file
- `test-analysis.html` - Analysis testing
- `test-local-storage.html` - LocalStorage testing
- `pwa-diagnostic.html` - PWA diagnostics tool
- `ios-banner-demo.html` - iOS banner demo
- `sample.json` - Sample meal plan data

### `/logove`
AI communication logs from testing sessions (14 log files)

## What to Keep Active

For current project documentation, see the main README.md file in the project root. Active documentation includes:
- README.md - Main project documentation
- ARCHITECTURE.md - Technical architecture
- QUICK_START.md - Getting started guide
- FEATURES_GUIDE.md - Feature documentation  
- DEPLOYMENT_CHECKLIST.md - Deployment guide
- DOCS.md - Documentation index
