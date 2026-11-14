// js/dom.js
// Updates the DOM in place. Rows are matched by data-player-id, so a refresh
// writes only the text and classes that changed, and never clears the table.

// Write text only when it differs, so the browser does no work for unchanged cells.
export function setText(el, text) {
  if (!el) return el;
  const value = text == null ? '' : String(text);
  if (el.textContent !== value) el.textContent = value;
  return el;
}

// Toggle a class only when it needs to change.
export function setClass(el, name, on) {
  if (el && el.classList.contains(name) !== on) el.classList.toggle(name, on);
  return el;
}

/**
 * Keep `container` in step with `items` without rebuilding it.
 * spec.create(item) returns a new row element with cells already in place.
 * spec.update(row, item) writes changed text and classes into an existing row.
 * The container should hold only keyed rows (no header or group rows).
 */
export function syncKeyed(container, items, spec) {
  const existing = new Map();
  for (const el of container.children) {
    if (el.dataset.playerId !== undefined) existing.set(el.dataset.playerId, el);
  }

  // First render: build every row in a DocumentFragment and insert it once.
  if (existing.size === 0) {
    const frag = document.createDocumentFragment();
    for (const item of items) {
      const row = spec.create(item);
      spec.update(row, item);
      frag.append(row);
    }
    container.append(frag);
    return;
  }

  // Later renders: reuse rows by key. A row moves only when it is out of order.
  const wanted = new Set();
  let cursor = container.firstElementChild;
  for (const item of items) {
    const key = String(item.id);
    wanted.add(key);
    let row = existing.get(key);
    if (!row) row = spec.create(item);
    if (row === cursor) cursor = cursor.nextElementSibling;
    else container.insertBefore(row, cursor);
    spec.update(row, item);
  }

  // Remove rows that are no longer in the data (for example a player removed from the squad).
  for (const [key, el] of existing) {
    if (!wanted.has(key)) el.remove();
  }
}
