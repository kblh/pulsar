import { serializeScene, applyScene, cleanName } from './scene.js';

function el(tag, props = {}, ...children) {
  const e = Object.assign(document.createElement(tag), props);
  e.append(...children);
  return e;
}

/**
 * [save] [load] in the header bar and the save row / scene list in the panel below it.
 * `sceneUi` is what applyScene needs: { clear, addFxPanel, addModulePanel }.
 */
export function mountScenes({ engine, store, sceneUi, barEl, panelEl }) {
  let mode = null; // 'save' | 'load' | null
  let lastName = '';
  let pendingDelete = null;
  let deleteTimer = null;
  let renaming = null;
  let messageTimer = null;

  const message = el('span', { className: 'muted' });
  const say = (text) => {
    message.textContent = text;
    clearTimeout(messageTimer);
    messageTimer = setTimeout(() => { message.textContent = ''; }, 5000);
  };

  const saveBtn = el('button', { textContent: '[save]' });
  const loadBtn = el('button', { textContent: '[load]' });
  barEl.append(saveBtn, ' ', loadBtn, ' ', message);

  const toggleMode = (next) => {
    mode = mode === next ? null : next;
    pendingDelete = null;
    renaming = null;
    render();
  };
  saveBtn.onclick = () => toggleMode('save');
  loadBtn.onclick = () => toggleMode('load');

  function doSave(name) {
    if (!engine.modules.length && !engine.effects.length) {
      say('nothing to save');
      return;
    }
    const r = store.save(name, serializeScene({ modules: engine.modules, effects: engine.effects, stoppedByTransport: engine.stoppedByTransport }));
    if (!r.ok) {
      say(r.error);
      return;
    }
    lastName = cleanName(name, 'scene');
    say(`saved "${lastName}"`);
    mode = null;
    render();
  }

  async function doLoad(entry) {
    await engine.resume();
    const scene = store.get(entry.id);
    if (!scene) {
      say(`"${entry.name}" could not be loaded`);
      return;
    }
    const { skipped } = applyScene(engine, scene, sceneUi);
    lastName = entry.name;
    say(skipped.length ? `loaded "${entry.name}", skipped: ${skipped.join(', ')}` : `loaded "${entry.name}"`);
    mode = null;
    render();
  }

  function saveRow() {
    const input = el('input', { type: 'text', value: lastName, spellcheck: false, maxLength: 24 });
    input.onkeydown = (e) => {
      if (e.key === 'Enter') doSave(input.value);
      else if (e.key === 'Escape') toggleMode('save');
    };
    const ok = el('button', { textContent: '[ok]' });
    ok.onclick = () => doSave(input.value);
    const cancel = el('button', { textContent: '[cancel]' });
    cancel.onclick = () => toggleMode('save');
    queueMicrotask(() => input.focus());
    return el('div', { className: 'row' }, el('label', { textContent: 'save as' }), input, ok, cancel);
  }

  function sceneRow(entry) {
    if (renaming === entry.id) {
      const input = el('input', { type: 'text', value: entry.name, spellcheck: false, maxLength: 24 });
      let done = false;
      const finish = (commit) => {
        if (done) return;
        done = true;
        renaming = null;
        if (commit) {
          const r = store.rename(entry.id, input.value);
          if (!r.ok) say(r.error);
        }
        render();
      };
      input.onkeydown = (e) => {
        if (e.key === 'Enter') finish(true);
        else if (e.key === 'Escape') finish(false);
      };
      input.onblur = () => finish(true);
      queueMicrotask(() => { input.focus(); input.select(); });
      return el('div', { className: 'row' }, input);
    }
    const name = el('button', { textContent: entry.name, className: 'scene-name' });
    name.onclick = () => doLoad(entry);
    const rename = el('button', { textContent: '[rename]' });
    rename.onclick = () => { renaming = entry.id; pendingDelete = null; render(); };
    const sure = pendingDelete === entry.id;
    const del = el('button', { textContent: sure ? '[sure?]' : '[x]' });
    del.onclick = () => {
      clearTimeout(deleteTimer);
      if (!sure) {
        pendingDelete = entry.id;
        deleteTimer = setTimeout(() => { pendingDelete = null; render(); }, 3000);
        render();
        return;
      }
      pendingDelete = null;
      const r = store.remove(entry.id);
      if (!r.ok) say(r.error);
      render();
    };
    return el('div', { className: 'row' }, name, el('span', { className: 'spacer' }), rename, del);
  }

  function render() {
    panelEl.replaceChildren();
    if (mode === 'save') panelEl.append(saveRow());
    if (mode === 'load') {
      const scenes = store.list();
      if (!scenes.length) panelEl.append(el('div', { className: 'muted', textContent: 'no saved scenes' }));
      for (const entry of scenes) panelEl.append(sceneRow(entry));
    }
  }
  render();
}
