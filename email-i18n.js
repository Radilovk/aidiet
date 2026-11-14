/**
 * Eatologix — имейлите на езика на клиента (en, de, es, ru; bg е изходният).
 *
 * Шаблоните в worker.entry.js са на български (и могат да се редактират от админа в KV само на
 * български). За чужд език: полетата на шаблона идват от тук, а фиксираните текстове в HTML-а
 * се подменят по точен текст (localizeEmailHtml). Езикът: userData.lang / тялото на заявката.
 */
const L = ['en', 'de', 'es', 'ru'];
export const isEmailLang = (lang) => L.includes(String(lang || '').toLowerCase());

// Полетата на шаблоните (вместо българските от KV).
export const EMAIL_TEMPLATES = {
  ready: {
    en: { subject: 'Your personal nutrition plan is ready! 🥗', headerSubtitle: 'Personal nutrition plan', greeting: 'Hi {name}! 👋', paragraph1: 'Great news: your <strong>personal 7-day nutrition plan</strong> is ready and waiting for you!', paragraph2: 'Our specialist has carefully reviewed your data and built an individual plan around your goals and needs.', buttonText: 'See my plan →' },
    de: { subject: 'Dein persönlicher Ernährungsplan ist fertig! 🥗', headerSubtitle: 'Persönlicher Ernährungsplan', greeting: 'Hallo {name}! 👋', paragraph1: 'Gute Nachrichten: Dein <strong>persönlicher 7-Tage-Ernährungsplan</strong> ist fertig und wartet auf dich!', paragraph2: 'Unsere Fachkraft hat deine Angaben sorgfältig geprüft und einen individuellen Plan für deine Ziele und Bedürfnisse erstellt.', buttonText: 'Zu meinem Plan →' },
    es: { subject: '¡Tu plan de alimentación personal está listo! 🥗', headerSubtitle: 'Plan de alimentación personal', greeting: '¡Hola, {name}! 👋', paragraph1: 'Buenas noticias: tu <strong>plan de alimentación personal de 7 días</strong> ya está listo.', paragraph2: 'Nuestro especialista ha revisado tus datos con atención y ha creado un plan individual según tus objetivos y necesidades.', buttonText: 'Ver mi plan →' },
    ru: { subject: 'Твой персональный план питания готов! 🥗', headerSubtitle: 'Персональный план питания', greeting: 'Привет, {name}! 👋', paragraph1: 'Отличные новости: твой <strong>персональный 7-дневный план питания</strong> готов и уже доступен!', paragraph2: 'Наш специалист внимательно изучил твои данные и составил индивидуальный план под твои цели и потребности.', buttonText: 'Смотреть мой план →' }
  },
  updated: {
    en: { subject: 'Your nutrition plan has been updated 🥗', headerSubtitle: 'Plan update', greeting: 'Hi {name}! 👋', paragraph1: 'Your specialist has made changes to your <strong>personal nutrition plan</strong>.', paragraph2: 'Tap the button below to load the new version. The link works once and is valid for 72 hours.', buttonText: 'Load the updated plan →' },
    de: { subject: 'Dein Ernährungsplan wurde aktualisiert 🥗', headerSubtitle: 'Plan-Update', greeting: 'Hallo {name}! 👋', paragraph1: 'Deine Fachkraft hat Änderungen an deinem <strong>persönlichen Ernährungsplan</strong> vorgenommen.', paragraph2: 'Tippe unten auf den Button, um die neue Version zu laden. Der Link ist einmalig und 72 Stunden gültig.', buttonText: 'Aktualisierten Plan laden →' },
    es: { subject: 'Tu plan de alimentación se ha actualizado 🥗', headerSubtitle: 'Actualización del plan', greeting: '¡Hola, {name}! 👋', paragraph1: 'Tu especialista ha hecho cambios en tu <strong>plan de alimentación personal</strong>.', paragraph2: 'Pulsa el botón de abajo para cargar la nueva versión. El enlace es de un solo uso y válido durante 72 horas.', buttonText: 'Cargar el plan actualizado →' },
    ru: { subject: 'Твой план питания обновлён 🥗', headerSubtitle: 'Обновление плана', greeting: 'Привет, {name}! 👋', paragraph1: 'Специалист внёс изменения в твой <strong>персональный план питания</strong>.', paragraph2: 'Нажми кнопку ниже, чтобы загрузить новую версию. Ссылка одноразовая и действует 72 часа.', buttonText: 'Загрузить обновлённый план →' }
  }
};

export const RESET_SUBJECT = {
  en: 'Password reset — Eatologix 🔒', de: 'Passwort zurücksetzen — Eatologix 🔒',
  es: 'Restablecer contraseña — Eatologix 🔒', ru: 'Сброс пароля — Eatologix 🔒'
};

// Фиксираните текстове в HTML-а на имейлите: точен български текст → превод.
const PHRASES = {
  'Твоят план е готов': ['Your plan is ready', 'Dein Plan ist fertig', 'Tu plan está listo', 'Твой план готов'],
  'Планът ти е актуализиран': ['Your plan has been updated', 'Dein Plan wurde aktualisiert', 'Tu plan se ha actualizado', 'Твой план обновлён'],
  'Какво включва твоят план:': ['What your plan includes:', 'Was dein Plan enthält:', 'Qué incluye tu plan:', 'Что входит в твой план:'],
  '7-дневна програма с подробни рецепти': ['A 7-day programme with detailed recipes', 'Ein 7-Tage-Programm mit ausführlichen Rezepten', 'Un programa de 7 días con recetas detalladas', '7-дневная программа с подробными рецептами'],
  'Изчислени калории и макронутриенти': ['Calculated calories and macronutrients', 'Berechnete Kalorien und Makronährstoffe', 'Calorías y macronutrientes calculados', 'Рассчитанные калории и макронутриенты'],
  'Персонализирани препоръки и добавки': ['Personal recommendations and supplements', 'Persönliche Empfehlungen und Nahrungsergänzung', 'Recomendaciones y suplementos personalizados', 'Персональные рекомендации и добавки'],
  'Чат консултация с AI диетолог': ['Chat with an AI nutrition assistant', 'Chat-Beratung mit einem KI-Ernährungsassistenten', 'Consulta por chat con un asistente de nutrición con IA', 'Чат-консультация с ИИ-диетологом'],
  'Ако имате въпроси, пишете ни на': ['If you have any questions, write to us at', 'Bei Fragen schreib uns an', 'Si tienes preguntas, escríbenos a', 'Если есть вопросы, пиши нам на'],
  'Персонален хранителен план': ['Personal nutrition plan', 'Persönlicher Ernährungsplan', 'Plan de alimentación personal', 'Персональный план питания'],
  'Нулиране на парола': ['Password reset', 'Passwort zurücksetzen', 'Restablecer contraseña', 'Сброс пароля'],
  'Заявка за нулиране на парола 🔒': ['Password reset request 🔒', 'Anfrage zum Zurücksetzen des Passworts 🔒', 'Solicitud de restablecimiento de contraseña 🔒', 'Запрос на сброс пароля 🔒'],
  'Получихме заявка за нулиране на паролата за вашия акаунт в Eatologix.': ['We received a request to reset the password for your Eatologix account.', 'Wir haben eine Anfrage zum Zurücksetzen des Passworts für dein Eatologix-Konto erhalten.', 'Hemos recibido una solicitud para restablecer la contraseña de tu cuenta de Eatologix.', 'Мы получили запрос на сброс пароля для твоего аккаунта Eatologix.'],
  'Натиснете бутона по-долу, за да зададете нова парола. Линкът е валиден за <strong>1 час</strong>.': ['Tap the button below to set a new password. The link is valid for <strong>1 hour</strong>.', 'Tippe unten auf den Button, um ein neues Passwort festzulegen. Der Link ist <strong>1 Stunde</strong> gültig.', 'Pulsa el botón de abajo para crear una contraseña nueva. El enlace es válido durante <strong>1 hora</strong>.', 'Нажми кнопку ниже, чтобы задать новый пароль. Ссылка действует <strong>1 час</strong>.'],
  'Нулирай паролата →': ['Reset password →', 'Passwort zurücksetzen →', 'Restablecer contraseña →', 'Сбросить пароль →'],
  'Ако не сте поискали нулиране на парола, можете да игнорирате този имейл. Акаунтът ви е в безопасност.': ["If you didn't ask to reset your password, you can ignore this email. Your account is safe.", 'Wenn du kein Zurücksetzen angefordert hast, kannst du diese E-Mail ignorieren. Dein Konto ist sicher.', 'Si no has pedido restablecer la contraseña, puedes ignorar este correo. Tu cuenta está segura.', 'Если ты не запрашивал(а) сброс пароля, просто проигнорируй это письмо. Твой аккаунт в безопасности.']
};

/** Полетата на шаблона за чужд език (null за български — тогава остава шаблонът от KV). */
export function emailTemplateFor(kind, lang) {
  const l = String(lang || '').toLowerCase();
  return isEmailLang(l) ? (EMAIL_TEMPLATES[kind] || {})[l] || null : null;
}

/** Подменя фиксираните български текстове в готовия HTML. */
export function localizeEmailHtml(html, lang) {
  const l = String(lang || '').toLowerCase();
  const i = L.indexOf(l);
  if (i < 0 || typeof html !== 'string') return html;
  let out = html.replace('<html lang="bg">', `<html lang="${l}">`);
  // По-дългите първо — да не се подмени част от по-дълъг текст.
  for (const bg of Object.keys(PHRASES).sort((a, b) => b.length - a.length)) out = out.split(bg).join(PHRASES[bg][i]);
  return out;
}
