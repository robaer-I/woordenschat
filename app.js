'use strict';
/* Mijn Woordenschat — offline telefoon-app. Alle gegevens staan in IndexedDB op het toestel. */

// Versienummer rechtsboven. Verhoog dit bij elke nieuwe versie, samen met VERSION in sw.js.
const APP_VERSION = 4;
const HUES = ['#d9480f', '#2b8a3e', '#1c7ed6', '#ae3ec9', '#e8590c', '#0c8599', '#c2255c', '#5f3dc4'];
const PAGE = 300;
const REPL = String.fromCharCode(0xFFFD);
const app = document.getElementById('app'), layer = document.getElementById('layer');
let langs = [], words = [], ready = false, cur = null, sortBy = 'f', editId = null, hi = -1, qf = '', qd = '', shown = PAGE, busy = false;

/* ---------- opslag (IndexedDB) ---------- */
const store = (() => {
  let dbp = null;
  const open = () => dbp || (dbp = new Promise((res, rej) => {
    const r = indexedDB.open('woordenschat', 1);
    r.onupgradeneeded = () => {
      const db = r.result;
      if (!db.objectStoreNames.contains('langs')) db.createObjectStore('langs', {keyPath: 'id'});
      if (!db.objectStoreNames.contains('words')) db.createObjectStore('words', {keyPath: 'id'});
    };
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  }));
  const tx = async (name, mode, fn) => {
    const db = await open();
    return new Promise((res, rej) => {
      const t = db.transaction(name, mode), s = t.objectStore(name);
      let out; const r = fn(s);
      if (r) r.onsuccess = () => { out = r.result; };
      t.oncomplete = () => res(out);
      t.onerror = () => rej(t.error);
      t.onabort = () => rej(t.error);
    });
  };
  return {
    all: name => tx(name, 'readonly', s => s.getAll()),
    put: (name, obj) => tx(name, 'readwrite', s => { s.put(obj); }),
    del: (name, id) => tx(name, 'readwrite', s => { s.delete(id); }),
    putMany: (name, list) => tx(name, 'readwrite', s => { list.forEach(o => s.put(o)); }),
    delMany: (name, ids) => tx(name, 'readwrite', s => { ids.forEach(id => s.delete(id)); }),
  };
})();
const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 10);

/* ---------- tekst-hulpjes ---------- */
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
const fold = s => Array.from(String(s || '')).map(c => (c.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase() || c)[0]).join('');
const key = s => fold(s).replace(/[¿¡!?.,;:"()\[\]]/g, ' ').replace(/\s+/g, ' ').trim();
const coll = new Intl.Collator('nl', {sensitivity: 'base'});
const sortKey = s => String(s || '').replace(/^[\s¿¡"'(\-–]+/, '');
const slug = s => key(s).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || ('taal-' + Date.now());
const cap = s => s.charAt(0).toUpperCase() + s.slice(1);
function hl(text, q) {
  q = fold(q).trim();
  if (!q) return esc(text);
  const t = Array.from(String(text)), i = fold(text).indexOf(q);
  if (i < 0) return esc(text);
  return esc(t.slice(0, i).join('')) + '<mark>' + esc(t.slice(i, i + q.length).join('')) + '</mark>' + esc(t.slice(i + q.length).join(''));
}
const langOf = id => langs.find(l => l.id === id);
const wordsOf = id => words.filter(w => w.lang === id);
const sortedLangs = () => langs.slice().sort((a, b) => coll.compare(a.name, b.name));

let toastTimer;
function toast(msg, undo) {
  clearTimeout(toastTimer);
  layer.querySelector('.toast')?.remove();
  const el = document.createElement('div');
  el.className = 'toast'; el.setAttribute('role', 'status');
  el.innerHTML = '<span>' + esc(msg) + '</span>' + (undo ? '<button>Ongedaan maken</button>' : '');
  layer.appendChild(el);
  if (undo) el.querySelector('button').onclick = () => { el.remove(); undo(); };
  toastTimer = setTimeout(() => el.remove(), undo ? 7000 : 3000);
}
const fail = e => toast('Opslaan op dit toestel lukte niet' + (e && e.message ? ': ' + e.message : '.'));

/* ---------- bestanden delen / opslaan ---------- */
async function saveFile(blob, filename) {
  const file = new File([blob], filename, {type: blob.type});
  if (navigator.canShare && navigator.canShare({files: [file]})) {
    try { await navigator.share({files: [file], title: filename}); return; }
    catch (e) { if (e && e.name === 'AbortError') return; }
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 10000);
}
async function readFileText(file) {
  const buf = await file.arrayBuffer();
  let t = new TextDecoder('utf-8').decode(buf);
  if (t.includes(REPL)) t = new TextDecoder('windows-1252').decode(buf);
  return t.replace(/^﻿/, '');
}
const stamp = () => new Date().toISOString().slice(0, 10);

/* ---------- weergave ---------- */
function render() { (cur && langOf(cur)) ? renderLang() : (cur = null, renderHome()); }

function renderHome() {
  document.documentElement.style.setProperty('--lang', 'var(--accent)');
  const total = words.length;
  const tiles = sortedLangs().map(l => {
    const n = wordsOf(l.id).length;
    return `<button class="tile" data-open="${esc(l.id)}" style="--c:${esc(l.color || HUES[0])}">
      <span class="label">${esc(l.name)} → NL</span><span class="nm">${esc(l.name)}</span>
      <span class="ct">${n} ${n === 1 ? 'woord' : 'woorden'}</span></button>`;
  }).join('');
  app.innerHTML = `
    <h1>Mijn Woordenschat</h1>
    <p class="sub">Kies een taal. Alles staat op deze telefoon en werkt zonder internet.</p>
    ${!ready ? '<p class="note">Laden…</p>' : (!langs.length ? '<p class="note">Nog geen talen. Voeg er hieronder een toe, of zet een backup terug.</p>' : '')}
    <div class="langs">${tiles}</div>
    <form class="section" id="addLang">
      <label class="label" for="newLang">Taal toevoegen</label>
      <div class="row2"><input type="text" id="newLang" placeholder="bijv. Frans" autocomplete="off"><button class="primary" type="submit">Toevoegen</button></div>
    </form>
    <div class="section">
      <span class="label">Backup</span>
      <div class="row2"><button id="bkSave">Backup maken</button><button id="bkLoad">Backup terugzetten</button></div>
      <p class="sub" style="font-size:14px">Maak af en toe een backup en bewaar die op je pc of in de cloud. Zo raak je je woorden niet kwijt als de telefoon stuk gaat.</p>
    </div>
    <p class="foot">${total} woorden in totaal op dit toestel.</p>`;
  app.querySelectorAll('[data-open]').forEach(b => b.onclick = () => openLang(b.dataset.open));
  document.getElementById('addLang').onsubmit = async e => {
    e.preventDefault();
    const nm = cap(document.getElementById('newLang').value.trim());
    if (!nm) return;
    const ex = langs.find(l => key(l.name) === key(nm));
    if (ex) { openLang(ex.id); return; }
    let id = slug(nm); if (langOf(id)) id += '-' + Date.now();
    const l = {id, name: nm, color: HUES[langs.length % HUES.length], created: Date.now()};
    try { await store.put('langs', l); langs.push(l); toast(nm + ' toegevoegd'); renderHome(); } catch (err) { fail(err); }
  };
  document.getElementById('bkSave').onclick = makeBackup;
  document.getElementById('bkLoad').onclick = restoreDialog;
}

function openLang(id) { cur = id; qf = qd = ''; editId = null; hi = -1; shown = PAGE; renderLang(true); }

function filtered() {
  const f = fold(qf).trim(), d = fold(qd).trim(), k = sortBy, o = k === 'f' ? 'd' : 'f';
  let list = wordsOf(cur);
  if (f) list = list.filter(w => fold(w.f).includes(f));
  if (d) list = list.filter(w => fold(w.d).includes(d));
  return list.sort((a, b) => coll.compare(sortKey(a[k]), sortKey(b[k])) || coll.compare(sortKey(a[o]), sortKey(b[o])));
}
function exactMatches() {
  const f = key(qf), d = key(qd);
  if (!f && !d) return [];
  return wordsOf(cur).filter(w => (!f || key(w.f) === f) && (!d || key(w.d) === d));
}

function renderLang(first) {
  const l = langOf(cur);
  document.documentElement.style.setProperty('--lang', l.color || 'var(--accent)');
  if (first || !document.getElementById('qf')) {
    app.innerHTML = `
      <div class="top">
        <button class="ghost" id="back">← Talen</button>
        <h2><span class="dot"></span>${esc(l.name)}</h2>
      </div>
      <div class="actions">
        <button id="impBtn">TXT inlezen</button>
        <button id="txtBtn">TXT maken</button>
        <button id="pdfBtn">PDF maken</button>
        <button id="delLangBtn" class="ghost" style="color:var(--danger)">Taal verwijderen</button>
      </div>
      <div class="search">
        <div class="fields">
          <label><span class="label">${esc(l.name)}</span><input type="text" id="qf" autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false" enterkeyhint="next" placeholder="Typ een ${esc(l.name.toLowerCase())} woord"></label>
          <label><span class="label">Nederlands</span><input type="text" id="qd" autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false" enterkeyhint="done" placeholder="of het Nederlandse woord"></label>
        </div>
        <div class="statusrow"><div class="status" id="status" aria-live="polite"></div><button id="clearBtn" class="clear" hidden>✕ Wissen</button></div>
      </div>
      <div class="count" id="count"></div>
      <div class="head"><button id="sortF">${esc(l.name)}</button><button id="sortD">Nederlands</button></div>
      <ul class="list" id="list"></ul>`;
    const qfEl = document.getElementById('qf'), qdEl = document.getElementById('qd');
    qfEl.value = qf; qdEl.value = qd;
    document.getElementById('back').onclick = () => { cur = null; renderHome(); window.scrollTo(0, 0); };
    document.getElementById('impBtn').onclick = importDialog;
    document.getElementById('txtBtn').onclick = exportTxt;
    document.getElementById('pdfBtn').onclick = exportPdf;
    document.getElementById('delLangBtn').onclick = deleteLangDialog;
    document.getElementById('sortF').onclick = () => { sortBy = 'f'; drawList(); };
    document.getElementById('sortD').onclick = () => { sortBy = 'd'; drawList(); };
    const onInput = e => {
      const v = e.target.value;
      if (v.includes('=')) {
        const i = v.indexOf('='), a = v.slice(0, i).trim(), b = v.slice(i + 1).trim();
        if (e.target.id === 'qf') { qfEl.value = a; qdEl.value = b; } else { qdEl.value = a; qfEl.value = b; }
      }
      qf = qfEl.value; qd = qdEl.value; hi = -1; editId = null; shown = PAGE; drawList();
    };
    qfEl.oninput = qdEl.oninput = onInput;
    document.getElementById('clearBtn').onclick = () => {
      qf = qd = ''; qfEl.value = ''; qdEl.value = ''; hi = -1; editId = null; shown = PAGE;
      drawList(); qfEl.focus();
    };
    qfEl.onkeydown = qdEl.onkeydown = onKey;
    if (first && matchMedia('(pointer:fine)').matches) setTimeout(() => qfEl.focus(), 0);
  }
  drawList();
}

function drawList() {
  const l = langOf(cur); if (!l) return;
  const list = filtered(), ex = exactMatches(), exIds = new Set(ex.map(w => w.id));
  const st = document.getElementById('status'), all = wordsOf(cur).length, f = qf.trim(), d = qd.trim();
  document.getElementById('clearBtn').hidden = !(qf || qd);
  document.getElementById('sortF').className = sortBy === 'f' ? 'on' : '';
  document.getElementById('sortD').className = sortBy === 'd' ? 'on' : '';
  st.className = 'status';
  if (!f && !d) st.textContent = `Typ in het ${l.name} of Nederlands. Bestaande woorden verschijnen meteen.`;
  else if (f && d && !ex.length) {
    st.className = 'status new';
    st.innerHTML = `<span>Nieuw: <b>${esc(f)}</b> = <b>${esc(d)}</b></span><button class="primary" id="addBtn">Toevoegen</button>`;
    document.getElementById('addBtn').onclick = addCurrent;
  } else if (ex.length) {
    st.className = 'status exists';
    st.innerHTML = `<span class="pill">Staat al in je lijst</span>` + (ex.length === 1 ? `<span>${esc(ex[0].f)} = ${esc(ex[0].d)}</span>` : `<span>${ex.length} keer</span>`);
  } else if (list.length) st.textContent = `${list.length} ${list.length === 1 ? 'woord lijkt' : 'woorden lijken'} hierop. Tik er een aan om te wijzigen, of vul ${f ? 'het Nederlands' : 'het ' + l.name} in om toe te voegen.`;
  else { st.className = 'status new'; st.textContent = `Nog niet in je lijst. Vul ${f ? 'het Nederlands' : 'het ' + l.name} in en tik op Toevoegen.`; }

  document.getElementById('count').textContent = (f || d) ? `${list.length} van ${all} woorden` : `${all} ${all === 1 ? 'woord' : 'woorden'}, alfabetisch op ${sortBy === 'f' ? l.name : 'Nederlands'}`;
  const ul = document.getElementById('list');
  if (!list.length) { ul.innerHTML = `<li class="empty">${all ? 'Geen woorden gevonden.' : 'Nog geen woorden. Typ hierboven een woord en de vertaling.'}</li>`; return; }
  if (hi >= list.length) hi = list.length - 1;
  const eIdx = editId ? list.findIndex(w => w.id === editId) : -1;
  const limit = Math.max(shown, eIdx + 1, hi + 1);
  ul.innerHTML = list.slice(0, limit).map((w, i) => w.id === editId
    ? `<li class="edit">
        <div class="fields">
          <label><span class="label">${esc(l.name)}</span><input type="text" id="ef" value="${esc(w.f)}" autocomplete="off"></label>
          <label><span class="label">Nederlands</span><input type="text" id="ed" value="${esc(w.d)}" autocomplete="off"></label>
        </div>
        <div class="btns"><button class="primary" id="saveE">Opslaan</button><button id="cancelE">Annuleren</button><span class="sp"></span><button class="danger" id="delE">Verwijderen</button></div></li>`
    : `<li class="row${i === hi ? ' hi' : ''}${exIds.has(w.id) ? ' exact' : ''}" data-id="${esc(w.id)}" data-i="${i}"><span class="f">${hl(w.f, qf)}</span><span class="d">${hl(w.d, qd)}</span></li>`
  ).join('') + (list.length > limit ? `<li class="more"><button id="moreBtn">Toon meer (${list.length - limit} over)</button></li>` : '');
  ul.querySelectorAll('.row').forEach(r => r.onclick = () => { editId = r.dataset.id; hi = +r.dataset.i; drawList(); });
  document.getElementById('moreBtn')?.addEventListener('click', () => { shown += PAGE * 2; drawList(); });
  if (editId) wireEdit(list.find(w => w.id === editId));
  if (hi >= 0) ul.querySelector('.row.hi')?.scrollIntoView({block: 'nearest'});
}

function wireEdit(w) {
  if (!w) { editId = null; return; }
  const ef = document.getElementById('ef'), ed = document.getElementById('ed');
  const close = () => { editId = null; drawList(); };
  const save = async () => {
    const f = ef.value.trim(), d = ed.value.trim();
    if (!f || !d) { toast('Vul beide velden in.'); return; }
    if (f === w.f && d === w.d) return close();
    const nw = {...w, f, d};
    try { await store.put('words', nw); Object.assign(w, nw); toast('Gewijzigd'); close(); } catch (e) { fail(e); }
  };
  document.getElementById('saveE').onclick = save;
  document.getElementById('cancelE').onclick = close;
  document.getElementById('delE').onclick = async () => {
    try {
      await store.del('words', w.id);
      words = words.filter(x => x.id !== w.id); close();
      toast(`Verwijderd: ${w.f}`, async () => { try { await store.put('words', w); words.push(w); drawList(); } catch (e) { fail(e); } });
    } catch (e) { fail(e); }
  };
  [ef, ed].forEach(i => i.onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); save(); } if (e.key === 'Escape') close(); });
}

function onKey(e) {
  const list = filtered();
  if (e.key === 'ArrowDown') { e.preventDefault(); hi = Math.min(list.length - 1, hi + 1); drawList(); }
  else if (e.key === 'ArrowUp') { e.preventDefault(); hi = Math.max(-1, hi - 1); drawList(); }
  else if (e.key === 'Escape') { qf = qd = ''; document.getElementById('qf').value = ''; document.getElementById('qd').value = ''; hi = -1; editId = null; drawList(); }
  else if (e.key === 'Enter') {
    e.preventDefault();
    if (hi >= 0 && list[hi]) { editId = list[hi].id; drawList(); return; }
    const f = qf.trim(), d = qd.trim();
    if (f && d) { if (!exactMatches().length) addCurrent(); return; }
    if (f && !d) document.getElementById('qd').focus();
    else if (d && !f) document.getElementById('qf').focus();
  }
}

async function addCurrent() {
  const f = qf.trim(), d = qd.trim();
  if (!f || !d || busy || exactMatches().length) return;
  busy = true;
  const w = {id: newId(), lang: cur, f, d, t: Date.now()};
  try {
    await store.put('words', w); words.push(w);
    toast(`Toegevoegd: ${f} = ${d}`);
    qf = qd = ''; document.getElementById('qf').value = ''; document.getElementById('qd').value = ''; hi = -1;
    drawList(); document.getElementById('qf').focus();
  } catch (e) { fail(e); }
  busy = false;
}

/* ---------- dialogen ---------- */
function dialog(html) {
  layer.querySelector('.overlay')?.remove();
  const o = document.createElement('div'); o.className = 'overlay';
  o.innerHTML = `<div class="dialog" role="dialog" aria-modal="true">${html}</div>`;
  layer.appendChild(o);
  o.addEventListener('click', e => { if (e.target === o && !o.dataset.lock) o.remove(); });
  return o;
}

function parseTxt(text) {
  const out = [];
  text.split(/\r?\n/).forEach(line => {
    const i = line.indexOf('='); if (i < 0) return;
    const f = line.slice(0, i).trim(), d = line.slice(i + 1).trim();
    if (f && d) out.push({f, d});
  });
  return out;
}
function freshFor(langId, rows) {
  const have = new Set(wordsOf(langId).map(w => key(w.f) + '=' + key(w.d))), seen = new Set();
  return rows.filter(r => { const k = key(r.f) + '=' + key(r.d); if (have.has(k) || seen.has(k)) return false; seen.add(k); return true; });
}

function importDialog() {
  const opts = sortedLangs().map(l => `<option value="${esc(l.id)}" ${l.id === cur ? 'selected' : ''}>${esc(l.name)}</option>`).join('');
  const o = dialog(`
    <h2>TXT-bestand inlezen</h2>
    <p>Elke regel als <b>vreemd woord = Nederlandse vertaling</b>. Woorden die al bestaan worden overgeslagen.</p>
    <label class="label" for="impLang">1. Taal van het bestand</label><select id="impLang">${opts}</select>
    <label class="label" for="impFile">2. Bestand (.txt)</label><input type="file" id="impFile" accept=".txt,text/plain">
    <p id="impInfo" style="color:var(--muted)"></p>
    <div class="btns"><button id="impCancel">Annuleren</button><button class="primary" id="impGo" disabled>Inlezen</button></div>`);
  let rows = [];
  const info = o.querySelector('#impInfo'), go = o.querySelector('#impGo'), sel = o.querySelector('#impLang');
  const evaluate = () => {
    const fresh = freshFor(sel.value, rows);
    if (rows.length) info.textContent = `${rows.length} regels gevonden: ${fresh.length} nieuw, ${rows.length - fresh.length} bestaan al.`;
    go.disabled = !fresh.length; go.textContent = fresh.length ? `${fresh.length} woorden inlezen` : 'Inlezen';
    return fresh;
  };
  sel.onchange = evaluate;
  o.querySelector('#impFile').onchange = async e => {
    const file = e.target.files[0]; if (!file) return;
    rows = parseTxt(await readFileText(file));
    if (!rows.length) info.textContent = 'Geen regels met een "=" gevonden in dit bestand.';
    evaluate();
  };
  o.querySelector('#impCancel').onclick = () => o.remove();
  go.onclick = async () => {
    const fresh = evaluate(); if (!fresh.length) return;
    const lang = sel.value, now = Date.now();
    const list = fresh.map((r, i) => ({id: newId() + i, lang, f: r.f, d: r.d, t: now}));
    try { await store.putMany('words', list); words.push(...list); o.remove(); toast(`${list.length} woorden ingelezen`); openLang(lang); }
    catch (e) { info.textContent = 'Inlezen lukte niet: ' + (e && e.message || e); }
  };
}

function deleteLangDialog() {
  const l = langOf(cur), n = wordsOf(cur).length;
  const o = dialog(`
    <h2>${esc(l.name)} verwijderen?</h2>
    <p>De taal ${esc(l.name)} en alle <b>${n}</b> ${n === 1 ? 'woord' : 'woorden'} worden van deze telefoon verwijderd. Dit kan niet ongedaan worden gemaakt.</p>
    <p style="color:var(--muted)">Tip: maak eerst een backup of PDF.</p>
    <div class="btns"><button id="dlNo">Annuleren</button><button class="danger" id="dlYes">Ja, verder</button></div>`);
  o.querySelector('#dlNo').onclick = () => o.remove();
  o.querySelector('#dlYes').onclick = () => {
    o.querySelector('.dialog').innerHTML = `
      <h2>Laatste bevestiging</h2>
      <p>Typ <b>${esc(l.name)}</b> om definitief te verwijderen.</p>
      <input type="text" id="dlName" autocomplete="off">
      <div class="btns"><button id="dlNo2">Annuleren</button><button class="danger" id="dlGo" disabled>Definitief verwijderen</button></div>`;
    const inp = o.querySelector('#dlName'), go = o.querySelector('#dlGo');
    inp.focus();
    inp.oninput = () => { go.disabled = key(inp.value) !== key(l.name); };
    o.querySelector('#dlNo2').onclick = () => o.remove();
    go.onclick = async () => {
      go.disabled = true;
      try {
        await store.delMany('words', wordsOf(l.id).map(w => w.id));
        await store.del('langs', l.id);
        words = words.filter(w => w.lang !== l.id); langs = langs.filter(x => x.id !== l.id);
        o.remove(); cur = null; renderHome(); toast(`${l.name} is verwijderd`);
      } catch (e) { fail(e); go.disabled = false; }
    };
  };
}

/* ---------- export ---------- */
function sortedFor(l) { return wordsOf(l.id).sort((a, b) => coll.compare(sortKey(a.f), sortKey(b.f))); }

async function exportTxt() {
  const l = langOf(cur);
  const text = sortedFor(l).map(w => `${w.f} = ${w.d}`).join('\r\n') + '\r\n';
  await saveFile(new Blob(['﻿' + text], {type: 'text/plain'}), `${l.name} - Nederlands.txt`);
}

async function exportPdf() {
  const l = langOf(cur);
  if (!window.jspdf) { toast('De PDF-maker is niet geladen. Open de app opnieuw.'); return; }
  const list = wordsOf(cur).sort((a, b) => coll.compare(sortKey(a[sortBy]), sortKey(b[sortBy])));
  const doc = new window.jspdf.jsPDF({unit: 'mm', format: 'a4'});
  const W = 210, M = 16, colW = (W - 2 * M - 6) / 2, lh = 5.2;
  const left = sortBy === 'f' ? ['f', l.name] : ['d', 'Nederlands'], right = sortBy === 'f' ? ['d', 'Nederlands'] : ['f', l.name];
  let y = 0, page = 1;
  const header = () => {
    doc.setFont('helvetica', 'bold'); doc.setFontSize(16); doc.setTextColor(0); doc.text(`${l.name} – Nederlands`, M, 18);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.setTextColor(110);
    doc.text(`${list.length} woorden · ${new Date().toLocaleDateString('nl-NL')} · pagina ${page}`, M, 24);
    doc.setTextColor(0); doc.setFont('helvetica', 'bold');
    doc.text(left[1].toUpperCase(), M, 33); doc.text(right[1].toUpperCase(), M + colW + 6, 33);
    doc.setDrawColor(180); doc.line(M, 35, W - M, 35);
    y = 41; doc.setFontSize(10.5);
  };
  header();
  list.forEach((w, i) => {
    const a = doc.splitTextToSize(String(w[left[0]]), colW), b = doc.splitTextToSize(String(w[right[0]]), colW);
    const h = Math.max(a.length, b.length) * lh;
    if (y + h > 297 - 14) { doc.addPage(); page++; header(); }
    if (i % 2 === 0) { doc.setFillColor(242, 243, 247); doc.rect(M - 2, y - 4, W - 2 * M + 4, h + 1.2, 'F'); }
    doc.setFont('helvetica', 'bold'); doc.text(a, M, y);
    doc.setFont('helvetica', 'normal'); doc.text(b, M + colW + 6, y);
    y += h + 1.2;
  });
  await saveFile(doc.output('blob'), `${l.name} - Nederlands.pdf`);
}

/* ---------- backup ---------- */
async function makeBackup() {
  const data = {app: 'woordenschat', version: 1, made: new Date().toISOString(),
    langs: langs.map(({id, name, color}) => ({id, name, color})),
    words: words.map(({lang, f, d, t}) => ({lang, f, d, t}))};
  await saveFile(new Blob([JSON.stringify(data)], {type: 'application/json'}), `woordenschat-backup-${stamp()}.json`);
}

function restoreDialog() {
  const o = dialog(`
    <h2>Backup terugzetten</h2>
    <p>Kies een backupbestand (.json) van deze app of van de online versie. Woorden die er al zijn worden overgeslagen; niets wordt gewist.</p>
    <input type="file" id="rsFile" accept=".json,application/json">
    <p id="rsInfo" style="color:var(--muted)"></p>
    <div class="btns"><button id="rsCancel">Annuleren</button><button class="primary" id="rsGo" disabled>Terugzetten</button></div>`);
  let plan = null;
  const info = o.querySelector('#rsInfo'), go = o.querySelector('#rsGo');
  o.querySelector('#rsCancel').onclick = () => o.remove();
  o.querySelector('#rsFile').onchange = async e => {
    const file = e.target.files[0]; if (!file) return;
    try {
      const data = JSON.parse(await readFileText(file));
      if (!data || data.app !== 'woordenschat' || !Array.isArray(data.langs) || !Array.isArray(data.words)) throw new Error('geen Woordenschat-backup');
      const newLangs = [], map = {};
      data.langs.forEach(bl => {
        const ex = langs.find(l => key(l.name) === key(bl.name)) || newLangs.find(l => key(l.name) === key(bl.name));
        if (ex) { map[bl.id] = ex.id; return; }
        let id = slug(bl.name); if (langOf(id) || newLangs.some(l => l.id === id)) id += '-' + Date.now();
        const nl = {id, name: bl.name, color: bl.color || HUES[(langs.length + newLangs.length) % HUES.length], created: Date.now()};
        newLangs.push(nl); map[bl.id] = id;
      });
      const have = new Set(words.map(w => w.lang + '|' + key(w.f) + '=' + key(w.d)));
      const newWords = [];
      data.words.forEach((w, i) => {
        const lang = map[w.lang]; if (!lang || !w.f || !w.d) return;
        const k = lang + '|' + key(w.f) + '=' + key(w.d);
        if (have.has(k)) return; have.add(k);
        newWords.push({id: newId() + i, lang, f: String(w.f), d: String(w.d), t: w.t || Date.now()});
      });
      plan = {newLangs, newWords};
      info.textContent = `${data.langs.length} talen en ${data.words.length} woorden in de backup: ${newLangs.length} nieuwe talen, ${newWords.length} nieuwe woorden.`;
      go.disabled = !(newLangs.length || newWords.length);
    } catch (err) { plan = null; go.disabled = true; info.textContent = 'Dit bestand kan niet gelezen worden (' + err.message + ').'; }
  };
  go.onclick = async () => {
    if (!plan) return;
    go.disabled = true; info.textContent = 'Bezig…';
    try {
      if (plan.newLangs.length) await store.putMany('langs', plan.newLangs);
      if (plan.newWords.length) await store.putMany('words', plan.newWords);
      langs.push(...plan.newLangs); words.push(...plan.newWords);
      o.remove(); toast(`${plan.newWords.length} woorden teruggezet`); renderHome();
    } catch (e) { info.textContent = 'Terugzetten lukte niet: ' + (e && e.message || e); go.disabled = false; }
  };
}

/* ---------- start ---------- */
(async () => {
  try {
    [langs, words] = await Promise.all([store.all('langs'), store.all('words')]);
    if (!langs.length && !words.length && !localStorage.getItem('ws-seeded')) {
      const seed = [{id: 'spaans', name: 'Spaans', color: HUES[0], created: Date.now()}, {id: 'italiaans', name: 'Italiaans', color: HUES[1], created: Date.now()}];
      await store.putMany('langs', seed); langs = seed;
      try { localStorage.setItem('ws-seeded', '1'); } catch {}
    }
  } catch (e) {
    app.innerHTML = '<h1>Mijn Woordenschat</h1><p class="note">Deze browser laat de app geen gegevens bewaren (' + esc(e && e.message || e) + '). Gebruik Chrome of Safari, niet in een privévenster.</p>';
    return;
  }
  ready = true; render();
  try { if (navigator.storage && navigator.storage.persist) navigator.storage.persist(); } catch {}
})();

/* ---------- versie ---------- */
const verEl = document.createElement('div');
verEl.className = 'ver'; verEl.textContent = 'versie ' + APP_VERSION;
document.body.appendChild(verEl);

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js', {updateViaCache: 'none'}).then(reg => {
      // Bij terugkeren naar de app (die vaak niet echt herstart) toch op updates controleren
      document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') reg.update().catch(() => {}); });
      reg.addEventListener('updatefound', () => {
        const nw = reg.installing;
        if (!nw || !navigator.serviceWorker.controller) return; // eerste installatie
        nw.addEventListener('statechange', () => {
          if (nw.state !== 'activated') return;
          verEl.innerHTML = 'Nieuwe versie klaar <button>Vernieuwen</button>';
          verEl.classList.add('new');
          verEl.querySelector('button').onclick = () => location.reload();
        });
      });
    }).catch(() => {});
  });
}
