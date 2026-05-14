# Активиране на Google вход — само с браузър

Следвай стъпките по-долу **без конзола или терминал**.  
Отнема ~10 минути.

---

## Стъпка 1 — Създай Firebase проект

1. Отвори **[console.firebase.google.com](https://console.firebase.google.com)**
2. Кликни **"Add project"** (или „Създай проект")
3. Въведи произволно име (напр. `nutriplan`) → **Continue**
4. Google Analytics — избери **No** → **Create project**
5. Изчакай и кликни **Continue**

---

## Стъпка 2 — Активирай Google вход

1. В лявото меню кликни **Build → Authentication**
2. Кликни **"Get started"**
3. В таба **"Sign-in method"** кликни **Google**
4. Постави **Enable** на ON
5. Въведи имейла си в „Project support email" → **Save**

---

## Стъпка 3 — Добави уеб приложение и вземи конфигурацията

1. Кликни иконата ⚙️ **Project Settings** (горе вляво до „Project Overview")
2. Скрол надолу до секция **"Your apps"**
3. Кликни иконата **`</>`** (Web)
4. Въведи произволно „App nickname" (напр. `web`) → **Register app**
5. Виждаш блок с код — **копирай само обекта `firebaseConfig`**:

```js
const firebaseConfig = {
  apiKey: "AIzaSy...",
  authDomain: "nutriplan-xxx.firebaseapp.com",
  projectId: "nutriplan-xxx",
  storageBucket: "nutriplan-xxx.appspot.com",
  messagingSenderId: "123456789",
  appId: "1:123456789:web:abc123"
};
```

6. Кликни **Continue to console**

---

## Стъпка 4 — Добави Authorized Domain

1. Пак в **Authentication → Settings → Authorized domains**
2. Кликни **"Add domain"**
3. Въведи: `biocode.website`
4. Кликни **Add**

---

## Стъпка 5 — Попълни конфигурацията в profile.html

1. Отвори файла `profile.html` в текстов редактор (Notepad++, VS Code и т.н.)
2. Намери секцията близо до края на файла (Ctrl+F):

```
⚠️  ПОПЪЛНИ ТЕЗИ 6 СТОЙНОСТИ ОТ FIREBASE CONSOLE
```

3. Замени стойностите с тези от стъпка 3:

```js
// ПРЕДИ (placeholder):
const firebaseConfig = {
    apiKey:            "YOUR_API_KEY",
    authDomain:        "YOUR_PROJECT_ID.firebaseapp.com",
    projectId:         "YOUR_PROJECT_ID",
    storageBucket:     "YOUR_PROJECT_ID.appspot.com",
    messagingSenderId: "YOUR_SENDER_ID",
    appId:             "YOUR_APP_ID"
};

// СЛЕД (с реалните стойности):
const firebaseConfig = {
    apiKey:            "AIzaSy...",
    authDomain:        "nutriplan-xxx.firebaseapp.com",
    projectId:         "nutriplan-xxx",
    storageBucket:     "nutriplan-xxx.appspot.com",
    messagingSenderId: "123456789",
    appId:             "1:123456789:web:abc123"
};
```

4. Запази файла

---

## Стъпка 6 — Добави секрет в Cloudflare Worker

Това е единственото нещо, което изисква достъп до Cloudflare Dashboard (но не и конзола).

1. Отвори **[dash.cloudflare.com](https://dash.cloudflare.com)**
2. Навигирай: **Workers & Pages → aidiet → Settings → Variables**
3. В секция **"Environment Variables"** кликни **"Edit variables"**
4. Кликни **"Add variable"**
5. Въведи:
   - **Variable name**: `FIREBASE_PROJECT_ID`
   - **Value**: твоя Project ID от Firebase (напр. `nutriplan-xxx`)
6. Активирай **"Encrypt"** (за сигурност)
7. Кликни **"Save and deploy"**

---

## Стъпка 7 — Публикувай промените

1. Качи обновения `profile.html` в GitHub репото (commit + push)
2. GitHub Actions автоматично деплойва Worker-а (ако е настроено), или деплойни ръчно от Cloudflare Dashboard

---

## Готово ✅

След тези стъпки потребителите ще виждат бутон **"Вход с Google"** в профила си.  
При вход: снимката и името им се показват автоматично.  
Планът им се синхронизира между устройства.

---

## Какво е направено автоматично (не трябва да правиш)

| Компонент | Направено |
|-----------|-----------|
| Backend endpoint `POST /api/auth/social` | ✅ в worker.js |
| JWT верификация с Google JWKS | ✅ в worker.js |
| CORS header `Cross-Origin-Opener-Policy` | ✅ в worker.js |
| UI бутон „Вход с Google" | ✅ в profile.html |
| UI бутон „Изход" | ✅ в profile.html |
| Показване на снимка и име след вход | ✅ в profile.html |
| Запазване на userId в localStorage | ✅ в profile.html |
| Скриване на бутона когато не е конфигуриран | ✅ автоматично |
