#!/usr/bin/env bash
# Уеб обвивката на приложението (capacitor-shell/) — общата за Android (build-apk.yml) и iOS (build-ios.yml).
# Копира корена без бекенда, админа, плащането, документацията и другите проекти, и маха web-only кода.
# Пуска се от корена на репото. Нов root файл влиза в приложението, освен ако не е изключен тук.
set -euo pipefail
rm -rf capacitor-shell
mkdir -p capacitor-shell
rsync -a ./ capacitor-shell/ \
  --delete \
  --exclude '.git/' \
  --exclude '.github/' \
  --exclude 'node_modules/' \
  --exclude 'android/' \
  --exclude 'android-res/' \
  --exclude 'ios/' \
  --exclude 'ios-res/' \
  --exclude 'capacitor-shell/' \
  --include 'docs/' \
  --include 'docs/*.png' \
  --exclude 'docs/**' \
  --exclude 'workflows/' \
  --exclude 'KV/' \
  --exclude 'Plan1/' \
  --exclude 'Plan2/' \
  --exclude 'Protocols/' \
  --exclude 'clients/' \
  --exclude 'samples/' \
  --exclude '*.md' \
  --exclude '*.log' \
  --exclude '*.csv' \
  --exclude '*.keystore' \
  --exclude '*.py' \
  --exclude 'package.json' \
  --exclude 'package-lock.json' \
  --exclude 'twa-manifest.json' \
  --exclude 'capacitor.config.json' \
  --exclude 'wrangler.toml' \
  --exclude 'worker.js' \
  --exclude 'worker.entry.js' \
  --exclude 'app-domain.js' \
  --exclude 'i18n-server.js' \
  --exclude 'email-i18n.js' \
  --exclude 'wording/' \
  --exclude 'access-control.js' \
  --exclude 'billing.js' \
  --exclude 'rewards.js' \
  --exclude 'review/' \
  --exclude 'spend.js' \
  --exclude 'gemini-models.js' \
  --exclude 'iris-gate.js' \
  --exclude 'app-bundle.js' \
  --exclude 'turnstile.js' \
  --exclude 'plan-review.js' \
  --exclude 'email-domain.js' \
  --exclude 'bot-check.js' \
  --exclude 'admin.html' \
  --exclude 'admin-*' \
  --exclude 'pricing.html' \
  --exclude 'brand/nutriin-wordmark-glyphs.json' \
  --exclude 'brand/nutriin-mark.json' \
  --exclude 'plan-response-schemas.js' \
  --exclude 'json-patch.js' \
  --exclude 'food-nutrition.js' \
  --exclude 'food-nutrition-data.js' \
  --exclude 'food-catalog.js' \
  --exclude 'food-catalog-data.js' \
  --exclude 'food-utils.js' \
  --exclude 'fitness/worker.js' \
  --exclude 'fitness/exercise-translate-batch.js' \
  --exclude 'scripts/' \
  --exclude 'studio.html' \
  --exclude 'studio-privacy.html' \
  --exclude 'xb-studio.html' \
  --exclude 'studio-app/' \
  --exclude 'studio-platform/' \
  --exclude 'viber-sender/' \
  --exclude 'client_______________*.json' \
  --exclude 'Errorlist.txt' \
  --exclude 'ai_communication.txt' \
  --exclude 'aicom.txt' \
  --exclude 'dynaquest.txt' \
  --exclude 'NUTRIPLAN_FULL_TEXT_EXPORT.txt' \
  --exclude 'aix.txt' \
  --exclude '*.pdf' \
  --exclude 'loading.gif' \
  --exclude 'log1' \
  --exclude 'workererrors'
# Само за сайта: препращането biocode.website → nutriin.app (i18n.js, между web-only маркерите).
# В приложението не трябва код, който пренасочва към друг домейн — проверките за сигурност го отчитат.
python3 - <<'PY_WEBONLY'
import re
from pathlib import Path
for f in Path('capacitor-shell').rglob('*.js'):
    t = f.read_text(encoding='utf-8', errors='ignore')
    if 'web-only:start' not in t:
        continue
    n = re.sub(r'/\* web-only:start.*?/\* web-only:end \*/\n?', '', t, flags=re.S)
    f.write_text(n, encoding='utf-8')
    print('web-only removed:', f)
PY_WEBONLY
# Версията на пакета страници (обновяването отвътре на iPhone — web-updater.js, app-bundle.js): времето на комита.
# Същото число е във вградения пакет (build-ios.yml) и в изданието (publish-ios-web.yml) от същия комит.
V=$(git log -1 --format=%ct 2>/dev/null || date +%s)
printf '{"version":"%s"}\n' "$V" > capacitor-shell/web-bundle.json
# iPhone (IOS=1 — build-ios.yml и publish-ios-web.yml): без обновяването на APK-то.
if [ "${IOS:-}" = "1" ]; then
  rm -f capacitor-shell/app-update.js
fi
# iPhone: входът да се стартира с initializeAuth преди първия getAuth (firebase-ios.js) — първият модул на страниците с вход.
if [ "${IOS:-}" = "1" ]; then
  python3 - <<'PY_FIREBASE_IOS'
import re
from pathlib import Path
TAG = '<script type="module" src="./firebase-ios.js"></script>'
pages = ['index.html', 'plan.html', 'profile.html', 'plan-pending.html', 'guidelines.html', 'game-analytics.html',
         'food-picker.html', 'plan-update.html', 'plan-book.html', 'quick-answer.html', 'delete-account.html']
for name in pages:
    f = Path('capacitor-shell') / name
    if not f.exists():
        continue
    t = f.read_text(encoding='utf-8')
    if TAG in t:
        continue
    m = re.search(r'<script[^>]*src="\.?/?i18n\.js[^"]*"[^>]*></script>', t)
    if not m:
        raise SystemExit(f'{name}: няма <script src="i18n.js"> — firebase-ios.js няма къде да влезе')
    f.write_text(t[:m.end()] + '\n' + TAG + t[m.end():], encoding='utf-8')
    print('firebase-ios.js →', name)
PY_FIREBASE_IOS
fi
