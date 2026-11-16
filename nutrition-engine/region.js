/**
 * Къде е клиентът — за сезона и за кухнята на менюто.
 *
 * Държавата идва от заявката (Cloudflare: request.cf.country → userData.country),
 * езикът — от интерфейса (userData.lang). Без тях: България и български.
 *
 * - Сезонът: в южното полукълбо е обърнат; в тропиците продуктите са целогодишни
 *   и сезонът не дава бонус, нито спира ястие.
 * - Кухнята: ястията с cuisine "bg" (кавърма, сарми, попара…) са у дома за
 *   Балканите и за всеки, който пише на български; за другите идват по-рядко,
 *   не изчезват.
 */

/** Южното полукълбо, умерен пояс. */
const SOUTHERN = new Set(['AU', 'NZ', 'AR', 'CL', 'UY', 'PY', 'ZA', 'LS', 'SZ', 'NA', 'BW']);

/** Тропици: плодове и зеленчуци през цялата година. */
const TROPICAL = new Set([
  'SG', 'MY', 'ID', 'TH', 'VN', 'PH', 'KH', 'LA', 'MM', 'LK', 'BN', 'TL',
  'BR', 'CO', 'VE', 'EC', 'PE', 'BO', 'CR', 'PA', 'GT', 'HN', 'NI', 'SV', 'BZ', 'DO', 'CU', 'JM', 'PR', 'HT', 'TT', 'BS', 'BB',
  'NG', 'GH', 'CI', 'CM', 'KE', 'TZ', 'UG', 'RW', 'ET', 'SN', 'CD', 'CG', 'GA', 'AO', 'MZ', 'MG', 'ZM', 'ZW', 'MW', 'BJ', 'TG', 'SL', 'LR', 'GN', 'ML', 'BF', 'SO', 'MU', 'SC',
  'FJ', 'PG', 'WS', 'TO', 'MV',
]);

/** Където българската кухня е у дома (продуктите и ястията са познати). */
const BALKAN = new Set(['BG', 'MK', 'RS', 'GR', 'RO', 'TR', 'AL', 'ME', 'BA', 'HR', 'SI', 'XK', 'MD', 'CY']);

const NORTH_SEASONS = ['winter', 'winter', 'spring', 'spring', 'spring', 'summer',
  'summer', 'summer', 'autumn', 'autumn', 'autumn', 'winter'];

/** @param {{ country?: string, lang?: string }} [userData] */
export function regionOf(userData = {}) {
  const country = /^[A-Za-z]{2}$/.test(String(userData?.country || '')) ? String(userData.country).toUpperCase() : '';
  const lang = String(userData?.lang || '').toLowerCase();
  const climate = TROPICAL.has(country) ? 'tropical' : SOUTHERN.has(country) ? 'south' : 'north';
  const localCuisine = !lang || lang === 'bg' || !country || BALKAN.has(country);
  return { country, lang: lang || 'bg', climate, localCuisine };
}

/** Сезонът на датата за климата на клиента; null в тропиците (без сезон). */
export function seasonFor(date = new Date(), climate = 'north') {
  if (climate === 'tropical') return null;
  const month = climate === 'south' ? (date.getMonth() + 6) % 12 : date.getMonth();
  return NORTH_SEASONS[month];
}

/** С толкова точки по-малко е ястие от българската кухня извън дома ѝ: идва около 4 пъти по-рядко (test:region). */
export const FOREIGN_CUISINE_PENALTY = { main: 2, breakfast: 1.5, snack: 1, late: 1 };
