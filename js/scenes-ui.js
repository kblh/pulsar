import { serializeScene, applyScene, cleanName } from './scene.js';
import { sceneToFile, scenesToFile, parseSceneFile, uniqueName, MAX_FILE_BYTES } from './scene-file.js';

function el(tag, props = {}, ...children) {
  const e = Object.assign(document.createElement(tag), props);
  e.append(...children);
  return e;
}

function defaultDownload(filename, text) {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  el('a', { href: url, download: filename }).click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * [save] [load] in the header bar and the save row / scene list in the panel below it.
 * `sceneUi` is what applyScene needs: { clear, addFxPanel, addModulePanel }.
 */
export function mountScenes({ engine, store, sceneUi, barEl, panelEl, download = defaultDownload }) {
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

  const fileInput = el('input', { type: 'file', accept: '.json,application/json', multiple: true, hidden: true });
  const saveBtn = el('button', { textContent: '[save]' });
  const loadBtn = el('button', { textContent: '[load]' });
  barEl.append(saveBtn, ' ', loadBtn, ' ', message, fileInput);

  const disarmDelete = () => {
    clearTimeout(deleteTimer);
    pendingDelete = null;
  };

  const toggleMode = (next) => {
    mode = mode === next ? null : next;
    disarmDelete();
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
    await engine.ready; // a scene with a bitcrusher needs the worklet
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

  function exportCurrent(name) {
    if (!engine.modules.length && !engine.effects.length) {
      say('nothing to export');
      return;
    }
    const scene = serializeScene({ modules: engine.modules, effects: engine.effects, stoppedByTransport: engine.stoppedByTransport });
    const file = sceneToFile(name, scene);
    download(file.filename, file.text);
  }

  function exportEntry(entry) {
    const scene = store.get(entry.id);
    if (!scene) {
      say(`"${entry.name}" could not be exported`);
      return;
    }
    const file = sceneToFile(entry.name, scene);
    download(file.filename, file.text);
  }

  function exportAll() {
    const entries = store.list().flatMap((e) => {
      const scene = store.get(e.id);
      return scene ? [{ name: e.name, scene }] : [];
    });
    if (!entries.length) {
      say('nothing to export');
      return;
    }
    const file = scenesToFile(entries);
    download(file.filename, file.text);
  }

  async function doImport(files) {
    let imported = 0;
    let skipped = 0;
    const reasons = [];
    const notes = [];
    let storageError = null;
    for (const file of files) {
      if (file.size > MAX_FILE_BYTES) { // refuse before reading a huge file into memory
        skipped++;
        reasons.push(`${file.name}: file is larger than 1 MB`);
        continue;
      }
      let text;
      try {
        text = await file.text();
      } catch {
        skipped++;
        reasons.push(`${file.name}: could not be read`);
        continue;
      }
      const parsed = parseSceneFile(text, file.name);
      const { entries, problems } = parsed;
      skipped += parsed.skipped;
      for (const p of problems) reasons.push(`${file.name}: ${p}`);
      for (const n of parsed.notes) notes.push(`${file.name}: ${n}`);
      for (const entry of entries) {
        if (storageError) {
          skipped++;
          continue;
        }
        const r = store.save(uniqueName(entry.name, store.list().map((x) => x.name)), entry.scene);
        if (r.ok) {
          imported++;
        } else {
          storageError = r.error;
          skipped++;
          reasons.push(r.error);
        }
      }
    }
    const dropped = notes.length ? `; parts dropped: ${notes.slice(0, 2).join('; ')}` : '';
    say(`imported ${imported}${skipped ? `, skipped ${skipped}: ${reasons.slice(0, 3).join('; ')}` : ''}${dropped}`);
    render();
  }

  fileInput.onchange = () => {
    const files = [...fileInput.files];
    fileInput.value = ''; // the same file can be picked again
    if (files.length) doImport(files);
  };

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
    const exportFile = el('button', { textContent: '[export file]' });
    exportFile.onclick = () => exportCurrent(input.value);
    queueMicrotask(() => input.focus());
    return el('div', { className: 'row' }, el('label', { textContent: 'save as' }), input, ok, exportFile, cancel);
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
    const exportBtn = el('button', { textContent: '[export]' });
    exportBtn.onclick = () => exportEntry(entry);
    const rename = el('button', { textContent: '[rename]' });
    rename.onclick = () => { renaming = entry.id; disarmDelete(); render(); };
    const sure = pendingDelete === entry.id;
    const del = el('button', { textContent: sure ? '[sure?]' : '[x]' });
    del.onclick = () => {
      disarmDelete();
      if (!sure) {
        pendingDelete = entry.id;
        deleteTimer = setTimeout(() => {
          pendingDelete = null;
          if (mode === 'load' && !renaming) render(); // never rebuild the panel under something being typed
        }, 3000);
        render();
        return;
      }
      const r = store.remove(entry.id);
      if (!r.ok) say(r.error);
      render();
    };
    return el('div', { className: 'row' }, name, el('span', { className: 'spacer' }), exportBtn, rename, del);
  }

  function render() {
    panelEl.replaceChildren();
    if (mode === 'save') panelEl.append(saveRow());
    if (mode === 'load') {
      const scenes = store.list();
      if (!scenes.length) panelEl.append(el('div', { className: 'muted', textContent: 'no saved scenes' }));
      for (const entry of scenes) panelEl.append(sceneRow(entry));
      const importBtn = el('button', { textContent: '[import]' });
      importBtn.onclick = () => fileInput.click();
      const actions = el('div', { className: 'row' }, importBtn);
      if (scenes.length) {
        const all = el('button', { textContent: '[export all]' });
        all.onclick = exportAll;
        actions.append(all);
      }
      panelEl.append(actions);
    }
  }
  render();
}
