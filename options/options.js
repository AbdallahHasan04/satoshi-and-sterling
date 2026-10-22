import * as store from '../lib/storage.js';
import { getFiat, getCoins } from '../lib/rates.js';
import { buildCatalog } from '../lib/currencies.js';
import { getSettings, saveSettings, applyTheme } from '../lib/settings.js';
import { CurrencyPicker } from '../popup/picker.js';

const savedEl = document.getElementById('saved');
let savedTimer;
let settings;

async function persist() {
  await saveSettings(settings);
  savedEl.hidden = false;
  clearTimeout(savedTimer);
  savedTimer = setTimeout(() => { savedEl.hidden = true; }, 1500);
}

const homePicker = new CurrencyPicker(document.getElementById('home-picker'), {
  label: 'Convert selections to',
  onChange: key => { settings.homeCurrency = key; persist(); },
});

async function loadCatalog() {
  const [fiat, coins] = await Promise.all([getFiat().catch(() => store.get('fiat')), getCoins().catch(() => store.get('coins'))]);
  homePicker.setGroups(buildCatalog(fiat, coins).groups);
}

async function init() {
  settings = await getSettings();
  applyTheme(settings.theme);

  for (const name of ['theme', 'copyFormat']) {
    for (const input of document.querySelectorAll(`input[name="${name}"]`)) {
      input.checked = input.value === settings[name];
      input.addEventListener('change', () => {
        settings[name] = input.value;
        if (name === 'theme') applyTheme(input.value);
        persist();
      });
    }
  }

  homePicker.setValue(settings.homeCurrency);
  loadCatalog();

  document.getElementById('clear-cache').addEventListener('click', async e => {
    await store.remove('fiat', 'coins', 'history', 'ffCurrencies', 'memeIds', 'stocks');
    e.target.textContent = 'Cache cleared ✓';
    loadCatalog();
  });
}

init();
