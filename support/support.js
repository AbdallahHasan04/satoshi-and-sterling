import { KOFI_URL, KOFI_EMBED_URL } from '../lib/config.js';
import { getSettings, applyTheme } from '../lib/settings.js';

const frame = document.getElementById('kofi-frame');
const loading = document.getElementById('frame-loading');

document.getElementById('kofi-link').href = KOFI_URL;
frame.addEventListener('load', () => loading.remove(), { once: true });
frame.src = KOFI_EMBED_URL;

getSettings().then(s => applyTheme(s.theme));
