// App shell: wires state, tabs, inputs, and rendering.

import * as State from './state.js';
import * as UI from './ui.js';

const state = State.load();
let pendingRender = false;

function render() {
  if (pendingRender) return;
  pendingRender = true;
  requestAnimationFrame(() => {
    pendingRender = false;
    renderNow();
  });
}

function renderNow() {
  // Top bar mode toggle
  document.querySelectorAll('.mode-toggle button').forEach((b) => {
    b.classList.toggle('active', b.dataset.mode === state.mode);
  });
  // Tab strip active state
  document.querySelectorAll('nav.tabs button').forEach((b) => {
    b.classList.toggle('active', b.dataset.tab === state.activeTab);
  });
  // Waterfall tab only for MF
  const wfBtn = document.querySelector('nav.tabs button[data-tab="waterfall"]');
  if (wfBtn) wfBtn.style.display = state.mode === 'mf' ? '' : 'none';

  const main = document.getElementById('main');
  let html;
  switch (state.activeTab) {
    case 'dashboard': html = UI.renderDashboard(state); break;
    case 'inputs': html = UI.renderInputs(state); break;
    case 'proforma': html = UI.renderProForma(state); break;
    case 'waterfall':
      if (state.mode !== 'mf') { state.activeTab = 'dashboard'; render(); return; }
      html = UI.renderWaterfall(state); break;
    case 'sensitivity': html = UI.renderSensitivity(state); break;
    case 'saved': html = UI.renderSaved(state); break;
    default: html = UI.renderDashboard(state);
  }
  main.innerHTML = html;
  UI.drawCharts(state, state.activeTab);
  State.save(state);
}

// === Event delegation ===

function setMode(m) {
  if (state.mode === m) return;
  state.mode = m;
  // If currently on waterfall and switching to SF, hop to dashboard.
  if (state.activeTab === 'waterfall' && m !== 'mf') state.activeTab = 'dashboard';
  render();
}

function setTab(t) {
  if (state.activeTab === t) return;
  state.activeTab = t;
  render();
}

document.addEventListener('click', (e) => {
  const modeBtn = e.target.closest('.mode-toggle button');
  if (modeBtn) { setMode(modeBtn.dataset.mode); return; }

  const tabBtn = e.target.closest('nav.tabs button');
  if (tabBtn) { setTab(tabBtn.dataset.tab); return; }

  const saveBtn = e.target.closest('#save-deal');
  if (saveBtn) { openSaveDialog(); return; }

  const addUnit = e.target.closest('#add-unit-row');
  if (addUnit) {
    state.mf.unitMix.push({ type: 'New', count: 0, inPlaceRent: 0, proFormaRent: 0 });
    render(); return;
  }
  const removeUnit = e.target.closest('button[data-action="remove-unit"]');
  if (removeUnit) {
    const idx = parseInt(removeUnit.dataset.idx, 10);
    state.mf.unitMix.splice(idx, 1);
    render(); return;
  }
  const loadDeal = e.target.closest('button[data-action="load-deal"]');
  if (loadDeal) {
    State.loadDeal(state, loadDeal.dataset.id);
    state.activeTab = 'dashboard';
    render(); return;
  }
  const deleteDeal = e.target.closest('button[data-action="delete-deal"]');
  if (deleteDeal) {
    if (confirm('Delete this saved deal?')) {
      State.deleteDeal(state, deleteDeal.dataset.id);
      render();
    }
    return;
  }
  // Dialog backdrop click
  const backdrop = e.target.closest('.dialog-backdrop');
  if (backdrop && e.target === backdrop) closeSaveDialog();
  const cancelBtn = e.target.closest('#dialog-cancel');
  if (cancelBtn) closeSaveDialog();
  const confirmSaveBtn = e.target.closest('#dialog-save');
  if (confirmSaveBtn) confirmSave();
});

// Input change handler — preserves cursor by NOT re-rendering on input,
// only on blur OR on changes that affect layout (toggles, selects).
document.addEventListener('input', (e) => {
  const t = e.target;
  if (!t.matches('input, select')) return;
  if (t.id === 'proforma-toggle') {
    state.proFormaView = t.checked ? 'after' : 'pre';
    render();
    return;
  }
  if (t.classList.contains('unit-field')) {
    const row = t.closest('.unit-row');
    const idx = parseInt(row.dataset.idx, 10);
    const key = t.dataset.key;
    const val = key === 'type' ? t.value : parseFloat(t.value) || 0;
    state.mf.unitMix[idx][key] = val;
    if (state.activeTab === 'inputs') return; // don't full re-render while typing
    render();
    return;
  }
  if (t.name === 'refiEnabled') {
    state.sf.refiEnabled = t.checked;
    render();
    return;
  }
  if (t.name === 'rateMode') {
    state.mf.rateMode = t.value;
    render();
    return;
  }
  // Numeric inputs: store but don't re-render inputs tab (avoids cursor jump)
  const fmtAttr = t.dataset.fmt || '';
  const raw = parseFloat(t.value);
  if (!isFinite(raw)) return;
  const val = fmtAttr === 'pct' ? raw / 100 : raw;
  const name = t.name || t.id.replace(/^i_/, '');
  // Waterfall fields
  if (state.activeTab === 'waterfall' && ['lpShare', 'prefRate', 'tier1LP', 'tier1GP', 'tier2Hurdle', 'tier2LP', 'tier2GP'].includes(name)) {
    state.mf.waterfall[name] = val;
    if (state.activeTab !== 'inputs') render();
    return;
  }
  const target = state.mode === 'sf' ? state.sf : state.mf;
  if (name in target) {
    target[name] = val;
    // For inputs tab, defer re-render to blur to avoid cursor jump.
    if (state.activeTab !== 'inputs') render();
  }
});

// On blur, re-render the inputs tab so dependent fields/displays update.
document.addEventListener('blur', (e) => {
  if (!e.target.matches('input, select')) return;
  if (state.activeTab === 'inputs') render();
}, true);

// === Save dialog ===
function openSaveDialog() {
  const dlg = document.createElement('div');
  dlg.className = 'dialog-backdrop';
  dlg.id = 'save-dialog';
  const defaultName = state.mode === 'sf'
    ? `SF — $${(state.sf.purchasePrice / 1000).toFixed(0)}k`
    : `MF — $${(state.mf.purchasePrice / 1_000_000).toFixed(1)}M, ${state.mf.unitMix.reduce((s, u) => s + u.count, 0)}u`;
  dlg.innerHTML = `
    <div class="dialog">
      <h3>Save underwriting</h3>
      <p class="small muted" style="margin:0 0 10px">Stored in this browser's local storage only.</p>
      <input class="field-input" type="text" id="dialog-name" value="${defaultName}" />
      <div class="btn-row" style="margin-top:14px;justify-content:flex-end">
        <button class="btn" id="dialog-cancel">Cancel</button>
        <button class="btn primary" id="dialog-save">Save</button>
      </div>
    </div>
  `;
  document.body.appendChild(dlg);
  setTimeout(() => document.getElementById('dialog-name').focus(), 50);
  document.getElementById('dialog-name').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') confirmSave();
    if (e.key === 'Escape') closeSaveDialog();
  });
}
function closeSaveDialog() {
  const dlg = document.getElementById('save-dialog');
  if (dlg) dlg.remove();
}
function confirmSave() {
  const nm = document.getElementById('dialog-name');
  const name = (nm && nm.value.trim()) || 'Untitled deal';
  State.saveDeal(state, name);
  closeSaveDialog();
  state.activeTab = 'saved';
  render();
}

// === PWA service worker ===
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch((e) => console.warn('SW register failed', e));
  });
}

// Redraw charts on resize
let resizeTimer;
window.addEventListener('resize', () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => UI.drawCharts(state, state.activeTab), 120);
});

// Initial render
renderNow();
