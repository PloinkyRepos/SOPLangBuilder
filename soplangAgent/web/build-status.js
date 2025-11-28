import { createAgentClient } from '/MCPBrowserClient.js';

const SOPLANG_MCP = '/mcps/soplangAgent/mcp';
const client = createAgentClient(SOPLANG_MCP);

let warnings = [];
let errors = [];
let variables = [];

const extractMcpText = (result) => {
  if (!result || !Array.isArray(result.content)) return '';
  return result.content
    .map((item) => {
      if (typeof item?.text === 'string') return item.text;
      if (typeof item?.data === 'string') return item.data;
      return '';
    })
    .filter(Boolean)
    .join('\n');
};

async function callTool(name, args = {}) {
  const result = await client.callTool(name, args);
  const text = extractMcpText(result);
  if (text) {
    try {
      return JSON.parse(text);
    } catch (_) {
      return text;
    }
  }
  return result;
}

async function loadVariables() {
  const data = await callTool('soplang-tool', { pluginName: 'SoplangBuilder', methodName: 'getVariablesWithValues', params: [] });
  variables = Array.isArray(data) ? data : [];
  renderVars();
}

async function rebuild() {
  const btn = document.getElementById('start-build');
  btn.disabled = true;
  try {
    const result = await callTool('soplang-tool', { pluginName: 'SoplangBuilder', methodName: 'buildFromMarkdown', params: [] });
    warnings = Array.isArray(result?.warnings) ? result.warnings : [];
    errors = Array.isArray(result?.errors) ? result.errors : [];
    await loadVariables();
    renderErrors();
  } catch (err) {
    errors = [err.message || 'Build failed'];
    renderErrors();
  } finally {
    btn.disabled = false;
  }
}

function renderErrors() {
  const body = document.getElementById('errors-body');
  if ((!warnings || !warnings.length) && (!errors || !errors.length)) {
    body.textContent = 'No errors';
    return;
  }
  const lines = [];
  warnings.forEach((w) => lines.push(`<div class="warning-item">${w}</div>`));
  errors.forEach((e) => {
    if (typeof e === 'object' && e.text) {
      lines.push(`<div class="error-item">${e.text}${e.err ? ` (${e.err})` : ''}</div>`);
    } else {
      lines.push(`<div class="error-item">${e}</div>`);
    }
  });
  body.innerHTML = lines.join('');
}

function renderVars() {
  const body = document.getElementById('vars-body');
  if (!variables.length) {
    body.innerHTML = '<tr><td colspan="5" class="table-message">No variables</td></tr>';
    return;
  }
  const eyeSvg = '<svg xmlns="http://www.w3.org/2000/svg" class="eye-icon" viewBox="0 0 24 24" fill="none" stroke="#2563eb" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"></circle><path d="M2.458 12C3.732 7.943 7.523 5 12 5c4.477 0 8.268 2.943 9.542 7-1.274 4.057-5.065 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"></path></svg>';
  const okSvg = '<svg class="status-icon" viewBox="0 0 24 24" fill="none" stroke="#10b981" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 13l4 4L19 7"></path></svg>';
  const errSvg = '<svg class="status-icon" viewBox="0 0 24 24" fill="none" stroke="#ef4444" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"></circle><line x1="9" y1="9" x2="15" y2="15"></line><line x1="15" y1="9" x2="9" y2="15"></line></svg>';
  body.innerHTML = variables
    .map((v) => `
      <tr>
        <td>${v.errorInfo ? errSvg : okSvg}</td>
        <td>${v.varName || v.name || v.varId || '—'}</td>
        <td>${v.docId || v.documentId || '—'}</td>
        <td>${v.value === undefined ? '—' : (typeof v.value === 'object' ? JSON.stringify(v.value) : v.value)}</td>
        <td><span class="pointer eye-icon" data-name="${v.varName || v.name || 'var'}">${eyeSvg}</span></td>
      </tr>
    `)
    .join('');
  attachVarClicks();
}

function switchTab(target) {
  document.querySelectorAll('.tab').forEach((tab) => {
    tab.classList.toggle('active', tab.dataset.tab === target);
  });
  document.querySelectorAll('.tab-content').forEach((pane) => {
    pane.classList.toggle('hidden', pane.dataset.content !== target);
  });
}

document.querySelectorAll('.tab').forEach((tab) => {
  tab.addEventListener('click', () => switchTab(tab.dataset.tab));
});

document.getElementById('start-build').addEventListener('click', rebuild);
document.getElementById('refresh-status').addEventListener('click', () => {
  renderErrors();
  renderVars();
});

function showModal(content) {
  const backdrop = document.getElementById('var-modal');
  const body = document.getElementById('var-modal-body');
  body.textContent = content;
  backdrop.style.display = 'flex';
}

function closeModal() {
  document.getElementById('var-modal').style.display = 'none';
}

document.getElementById('var-modal').addEventListener('click', (e) => {
  if (e.target.id === 'var-modal' || e.target.dataset.action === 'close-modal') {
    closeModal();
  }
});

function attachVarClicks() {
  document.querySelectorAll('#vars-body tr').forEach((row) => {
    const icon = row.querySelector('.eye-icon');
    if (!icon) return;
    icon.addEventListener('click', () => {
      const name = icon.dataset.name;
      const variable = variables.find(v => (v.varName || v.name || v.varId) === name);
      if (!variable) return;
      showModal(JSON.stringify(variable, null, 2));
    });
  });
}

loadVariables();
renderErrors();
switchTab('errors');
