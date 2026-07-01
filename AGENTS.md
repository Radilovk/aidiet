# AGENTS.md

## Cursor Cloud specific instructions

### Product overview

NutriPlan (`aidiet`) is a Bulgarian health/nutrition PWA: static HTML/JS/CSS frontend + Cloudflare Worker API (`worker.js`). Client data is primarily in `localStorage`. See `README.md` and `QUICK_START.md` for feature and deployment docs.

### Services (dev)

| Service | Port | Start command |
|---------|------|---------------|
| Static frontend | 8000 | `python3 -m http.server 8000` from repo root (see note below) |
| Cloudflare Worker | 8787 | `npm run dev` (`wrangler dev`) |

**Note:** `npm run serve` runs `python -m http.server`, but this VM only has `python3` on PATH. Use `python3 -m http.server 8000` unless `python` is installed.

### API URL caveat (important)

Most HTML pages hardcode `WORKER_URL = 'https://aidiet.radilov-k.workers.dev'`. Local `wrangler dev` on port 8787 is **not** used by the frontend unless you change those URLs. For full-stack local API testing, either point fetches at `http://127.0.0.1:8787` or use the deployed worker (works without local secrets for many flows).

Local `wrangler dev` may return 500 on `/api/generate-plan` when AI keys are missing (multi-step pipeline fails at step 1). The deployed worker can still generate plans. `/api/admin/get-config` and similar read endpoints work locally with emulated KV.

### Lint / tests

- No ESLint/Prettier scripts in `package.json`.
- `npm test` only prints a message to open `docs/archive/test-files/test.html` in a browser (root `test.html` was removed; use archive copy or manual UI flow).

### Quick verification commands

```bash
# Static site
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:8000/index.html?stay=1

# Local worker
curl -s http://127.0.0.1:8787/api/admin/get-config | head -c 200

# Production worker (used by default in frontend)
curl -s -X POST https://aidiet.radilov-k.workers.dev/api/generate-plan \
  -H "Content-Type: application/json" \
  -d '{"name":"Test User","age":30,"height":180,"weight":85,"gender":"Мъж","goal":"Отслабване","email":"test@example.com"}'
```

### Optional secrets (not required for basic UI dev)

Configure via `wrangler secret put` when testing AI locally: `OPENAI_API_KEY`, `GEMINI_API_KEY`, `ANTHROPIC_API_KEY`, Firebase, VAPID, Resend, etc. See `wrangler.toml` comments and `FIREBASE_SETUP.md`.

### tmux sessions

If you start long-running servers in tmux, use descriptive names (e.g. `nutriplan-static`, `nutriplan-worker`) and `tmux -f /exec-daemon/tmux.portal.conf`.
