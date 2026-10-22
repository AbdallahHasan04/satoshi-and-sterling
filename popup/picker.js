// Searchable currency dropdown (combobox + listbox).
let uid = 0;

export function iconNode(item) {
  const span = document.createElement('span');
  span.className = `cur-icon cur-icon--${item.kind}`;
  if (item.kind === 'crypto' && item.image) {
    const img = document.createElement('img');
    img.src = item.image;
    img.alt = '';
    img.loading = 'lazy';
    img.width = img.height = 20;
    img.addEventListener('error', () => { img.remove(); span.textContent = item.code.slice(0, 1); }, { once: true });
    span.append(img);
  } else {
    span.textContent = item.symbol && item.symbol !== item.code ? item.symbol : item.code.slice(0, 1);
  }
  return span;
}

export function currencyLabel(item) {
  const frag = document.createDocumentFragment();
  const code = document.createElement('span');
  code.className = 'cur-code';
  code.textContent = item.code;
  const name = document.createElement('span');
  name.className = 'cur-name';
  name.textContent = item.name;
  frag.append(iconNode(item), code, name);
  return frag;
}

function rank(item, q) {
  const code = item.code.toLowerCase();
  const name = item.name.toLowerCase();
  if (code === q) return 0;
  if (code.startsWith(q)) return 1;
  if (name.startsWith(q)) return 2;
  return 3;
}

export class CurrencyPicker {
  constructor(root, { onChange, label = 'Currency', placeholder = 'Select currency', resetAfterChoose = false } = {}) {
    this.root = root;
    this.onChange = onChange;
    this.placeholder = placeholder;
    this.resetAfterChoose = resetAfterChoose;
    this.groups = [];
    this.byKey = new Map();
    this.value = null;
    this.visible = [];
    this.active = -1;
    this.id = `picker-${++uid}`;

    root.classList.add('picker');
    root.innerHTML = `
      <button type="button" class="picker-btn" aria-haspopup="listbox" aria-expanded="false"></button>
      <div class="picker-pop" hidden>
        <input type="search" class="picker-search" placeholder="Search currency or coin…" autocomplete="off" spellcheck="false"
               role="combobox" aria-autocomplete="list" aria-expanded="true" aria-controls="${this.id}-list">
        <ul class="picker-list" id="${this.id}-list" role="listbox"></ul>
      </div>`;
    this.btn = root.querySelector('.picker-btn');
    this.pop = root.querySelector('.picker-pop');
    this.search = root.querySelector('.picker-search');
    this.list = root.querySelector('.picker-list');
    this.btn.setAttribute('aria-label', label);
    this.search.setAttribute('aria-label', `Search ${label.toLowerCase()}`);
    this.list.setAttribute('aria-label', label);

    this.btn.addEventListener('click', () => (this.isOpen ? this.close() : this.open()));
    this.btn.addEventListener('keydown', e => {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); this.open(); }
    });
    this.search.addEventListener('input', () => this.renderList(true));
    this.search.addEventListener('keydown', e => this.onKey(e));
    this.list.addEventListener('pointerdown', e => e.preventDefault()); // keep focus in the search box
    this.list.addEventListener('click', e => {
      const li = e.target.closest('[data-key]');
      if (li) this.choose(li.dataset.key);
    });
    document.addEventListener('pointerdown', e => {
      if (this.isOpen && !root.contains(e.target)) this.close();
    });
    this.renderButton();
  }

  get isOpen() { return !this.pop.hidden; }

  setGroups(groups) {
    this.groups = groups;
    this.byKey = new Map(groups.flatMap(g => g.items.map(i => [i.key, i])));
    this.renderButton();
    if (this.isOpen) this.renderList();
  }

  setValue(key) {
    this.value = key;
    this.renderButton();
  }

  renderButton() {
    const item = this.byKey.get(this.value);
    const caret = document.createElement('span');
    caret.className = 'picker-caret';
    caret.setAttribute('aria-hidden', 'true');
    if (item) {
      this.btn.replaceChildren(currencyLabel(item), caret);
    } else {
      const ph = document.createElement('span');
      ph.className = 'picker-placeholder';
      ph.textContent = this.groups.length || this.resetAfterChoose ? this.placeholder : 'Loading…';
      this.btn.replaceChildren(ph, caret);
    }
  }

  open() {
    if (!this.groups.length) return;
    this.pop.hidden = false;
    this.btn.setAttribute('aria-expanded', 'true');
    this.search.value = '';
    this.renderList();
    // Open upward when there's no room below (e.g. the "add currency" picker at the bottom).
    const rect = this.root.getBoundingClientRect();
    const viewport = document.documentElement.clientHeight;
    this.root.classList.toggle('picker--up', viewport - rect.bottom < 300 && rect.top > viewport - rect.bottom);
    this.search.focus();
    this.list.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'center' });
  }

  close({ focus = false } = {}) {
    this.pop.hidden = true;
    this.btn.setAttribute('aria-expanded', 'false');
    this.search.removeAttribute('aria-activedescendant');
    if (focus) this.btn.focus();
  }

  renderList(fromTyping = false) {
    const q = this.search.value.trim().toLowerCase();
    const frag = document.createDocumentFragment();
    this.visible = [];
    let groups = this.groups.map(group => ({ label: group.label, items: group.items }));
    if (q) {
      for (const group of groups) {
        group.items = group.items
          .filter(i => i.code.toLowerCase().includes(q) || i.name.toLowerCase().includes(q))
          .sort((a, b) => rank(a, q) - rank(b, q) || a.code.localeCompare(b.code));
      }
      // The group holding the best match goes first, so "sol" + Enter picks SOL, not SBD.
      const best = g => (g.items.length ? rank(g.items[0], q) : 9);
      groups = groups.sort((a, b) => best(a) - best(b));
    }
    for (const { label, items } of groups) {
      if (!items.length) continue;
      const head = document.createElement('li');
      head.className = 'picker-group';
      head.setAttribute('role', 'presentation');
      head.textContent = label;
      frag.append(head);
      for (const item of items) {
        const li = document.createElement('li');
        li.id = `${this.id}-opt-${this.visible.length}`;
        li.className = 'picker-option';
        li.setAttribute('role', 'option');
        li.dataset.key = item.key;
        li.setAttribute('aria-selected', String(item.key === this.value));
        li.append(currencyLabel(item));
        frag.append(li);
        this.visible.push(item);
      }
    }
    if (!this.visible.length) {
      const empty = document.createElement('li');
      empty.className = 'picker-empty';
      empty.textContent = 'No matches';
      frag.append(empty);
    }
    this.list.replaceChildren(frag);
    const selected = this.visible.findIndex(i => i.key === this.value);
    this.setActive(fromTyping || selected < 0 ? 0 : selected, false);
  }

  setActive(index, scroll = true) {
    if (!this.visible.length) { this.active = -1; return; }
    this.active = Math.max(0, Math.min(index, this.visible.length - 1));
    this.list.querySelector('.is-active')?.classList.remove('is-active');
    const el = this.list.querySelector(`#${this.id}-opt-${this.active}`);
    el?.classList.add('is-active');
    if (el) this.search.setAttribute('aria-activedescendant', el.id);
    if (scroll) el?.scrollIntoView({ block: 'nearest' });
  }

  onKey(e) {
    switch (e.key) {
      case 'ArrowDown': e.preventDefault(); this.setActive(this.active + 1); break;
      case 'ArrowUp': e.preventDefault(); this.setActive(this.active - 1); break;
      case 'PageDown': e.preventDefault(); this.setActive(this.active + 8); break;
      case 'PageUp': e.preventDefault(); this.setActive(this.active - 8); break;
      case 'Enter':
        e.preventDefault();
        if (this.visible[this.active]) this.choose(this.visible[this.active].key);
        break;
      case 'Escape': e.preventDefault(); e.stopPropagation(); this.close({ focus: true }); break;
      case 'Tab': this.close(); break;
    }
  }

  choose(key) {
    const changed = key !== this.value;
    if (this.resetAfterChoose) this.value = null;
    else this.value = key;
    this.renderButton();
    this.close({ focus: true });
    if (changed || this.resetAfterChoose) this.onChange?.(key);
  }
}
