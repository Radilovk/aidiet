/**
 * Неонова анимация на упражнение от 3 SVG кадъра (workout-guide, CC BY-SA 4.0).
 *
 * Кадрите са едноцветни контури → използват се като CSS маска върху градиент,
 * така цветът идва от темата (без промяна на файловете). Сиянието е drop-shadow
 * на обвивката (маската отрязва собствения filter на елемента).
 * Ред на кадрите: 1 → 2 → 3 → 2 (плавно „движение“). prefers-reduced-motion → статичен кадър.
 */

/** Неонови палитри по мускулна група. */
const THEMES = {
  legs: ['#00f0ff', '#7c5cff'],
  glutes: ['#ff4fd8', '#8b5cff'],
  push: ['#ff8a3d', '#ff2e88'],
  pull: ['#39ff9f', '#00c8ff'],
  core: ['#ffd23f', '#ff7a3d'],
  mobility: ['#9ef6ff', '#c3a6ff'],
  cardio: ['#ff3d6e', '#ffb13d'],
};

const TARGET_THEME = {
  quads: 'legs', hamstrings: 'legs', calves: 'legs', adductors: 'legs', abductors: 'legs',
  glutes: 'glutes',
  pectorals: 'push', delts: 'push', triceps: 'push',
  lats: 'pull', 'upper back': 'pull', biceps: 'pull', traps: 'pull', forearms: 'pull',
  abs: 'core', spine: 'core',
  'cardiovascular system': 'cardio',
};

export function exerciseTheme(media = {}) {
  if (media.category === 'mobility') return 'mobility';
  if (media.category === 'cardio' || media.category === 'plyometric') return 'cardio';
  return TARGET_THEME[String(media.target || '').toLowerCase()] || 'core';
}

export function themeColors(name) {
  return THEMES[name] || THEMES.core;
}

/**
 * @param {{ frames?: string[], imageUrl?: string, gifUrl?: string, target?: string, category?: string }} media
 * @param {{ className?: string, alt?: string, onClick?: () => void, animate?: boolean }} [opts]
 * @returns {HTMLElement}
 */
export function exerciseVisual(media, { className = '', alt = '', onClick = null, animate = true } = {}) {
  const frames = Array.isArray(media?.frames) ? media.frames.filter(Boolean) : [];
  let node;
  if (frames.length) {
    const [c1, c2] = themeColors(exerciseTheme(media));
    node = document.createElement('div');
    node.className = `xv ${animate ? 'xv-anim' : ''} ${className}`.trim();
    node.setAttribute('role', 'img');
    if (alt) node.setAttribute('aria-label', alt);
    node.style.setProperty('--xv-c1', c1);
    node.style.setProperty('--xv-c2', c2);
    const stage = document.createElement('div');
    stage.className = 'xv-stage';
    frames.slice(0, 3).forEach((url, i) => {
      const f = document.createElement('div');
      f.className = `xv-f xv-f${i + 1}`;
      f.style.setProperty('--xv-u', `url("${url}")`);
      stage.append(f);
    });
    node.append(stage);
  } else if (media?.imageUrl || media?.gifUrl) {
    // Стари планове (GIF база) — показват се както преди
    node = document.createElement('img');
    node.className = className;
    node.src = media.gifUrl && !className.includes('thumb') ? media.gifUrl : (media.imageUrl || media.gifUrl);
    node.alt = alt;
    node.loading = 'lazy';
  } else {
    node = document.createElement('div');
    node.className = `${className} ex-thumb-placeholder`.trim();
    node.textContent = '🏋';
  }
  if (onClick) node.addEventListener('click', onClick);
  return node;
}

/** Ред за посочване на автора (изискване на CC BY-SA 4.0). */
export const VISUAL_ATTRIBUTION_HTML = 'Илюстрации: <a href="https://github.com/everkinetic/data" target="_blank" rel="noopener">Everkinetic</a> / <a href="https://github.com/bryllim/workout-guide" target="_blank" rel="noopener">Bryl Lim</a>, <a href="https://creativecommons.org/licenses/by-sa/4.0/" target="_blank" rel="noopener">CC BY-SA 4.0</a> (оцветени)';
