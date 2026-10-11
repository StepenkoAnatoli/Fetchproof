// The panel's page. Every value from the server is placed with textContent, never as HTML.
'use strict';

const token = new URLSearchParams(location.hash.slice(1)).get('t') || '';
const $ = (id) => document.getElementById(id);

async function call(route, body) {
  const options = { headers: { 'x-panel-token': token } };
  if (body !== undefined) {
    options.method = 'POST';
    options.headers['content-type'] = 'application/json';
    options.body = JSON.stringify(body);
  }
  const res = await fetch(route, options);
  const data = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

function banner(text) {
  $('banner').hidden = !text;
  $('banner').textContent = text || '';
}

function show(title, text) {
  $('output-title').textContent = title;
  $('output').textContent = text;
}

function render(s) {
  $('topic').textContent = s.topic || (s.isProject ? '(this project has no topic yet)' : '(not a research project)');
  $('project').textContent = s.project;
  $('project-path').value = $('project-path').value || s.project;
  const role = $('role');
  role.textContent = s.role;
  role.className = `badge ${s.role}`;
  $('version').textContent = `kit ${s.kitVersion}`;
  $('config-path').textContent = s.configPath;
  const search = s.keys.search;
  $('search-state').textContent = search.set ? `set (${search.source})` : 'not set';
  $('firecrawl-state').textContent = s.keys.firecrawl.environment ? 'FIRECRAWL_API_KEY is set in this environment.' : '';
  $('brief').disabled = !s.brief;
  $('builder-note').textContent = s.role === 'builder'
    ? 'This machine is declared a builder: it builds from the brief and never collects. The steps below are the ones it follows.'
    : (s.brief ? 'Preflight must print PASS before the hand-off.' : 'research/BRIEF.md does not exist yet: finish phase 1 before handing off.');
  $('builder-text').textContent = s.builderInstructions;
  $('update-note').textContent = s.update.sameCopy
    ? `This panel runs from the installed copy (${s.update.to}). To update, get the new kit (git pull or a download), start the panel from it, and press Update.`
    : `Installs ${s.update.from} over ${s.update.to}. Preview first.`;
  $('update').disabled = s.update.sameCopy;
  document.querySelector('[data-run="update-preview"]').disabled = s.update.sameCopy;
}

function renderRequests(r) {
  $('requests-folder').textContent = r.folder;
  if (document.activeElement?.closest?.('#auto-form') == null) {
    $('auto-mode').value = r.settings.mode;
    $('auto-per').value = r.settings.perRequestPages;
    $('auto-daily').value = r.settings.dailyPages;
    $('auto-every').value = r.settings.intervalMinutes;
    $('auto-topics').value = r.settings.topicsFolder;
  }
  const parts = [`${r.spent.pages} of ${r.settings.dailyPages} page(s) used or reserved today`];
  if (r.busy) parts.push('collecting now');
  if (r.lastCheck) parts.push(`last check ${r.lastCheck}`);
  if (r.blocked) parts.push(`BLOCKED: ${r.blocked}`);
  if (r.paused) parts.push(`PAUSED: ${r.paused}`);
  $('auto-state').textContent = parts.join(' - ');
  $('auto-resume').disabled = !r.paused;
  const body = document.querySelector('#requests tbody');
  body.replaceChildren(...(r.requests.length ? r.requests : [{ id: '(none yet)', status: '', pages: '', fact: '', detail: '' }]).map((q) => {
    const tr = document.createElement('tr');
    for (const value of [q.id, q.status, q.pages, q.fact, [q.detail, q.git].filter(Boolean).join(' - ')]) {
      const td = document.createElement('td');
      td.textContent = String(value ?? '');
      tr.append(td);
    }
    if (q.output) {
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = 'View output';
      button.setAttribute('aria-label', `View output for request ${q.id}`);
      button.addEventListener('click', () => show(`request ${q.id}`, q.output));
      tr.lastElementChild.append(button);
    }
    return tr;
  }));
  $('auto-notes').textContent = r.notes.slice().reverse().join('\n');
}

async function refreshRequests() {
  try { renderRequests(await call('/api/requests')); } catch (err) { banner(err.message); }
}

async function refresh() {
  try { render(await call('/api/state')); banner(''); } catch (err) { banner(err.message); }
}

async function run(command, button) {
  const buttons = document.querySelectorAll('button');
  buttons.forEach((b) => { b.disabled = true; });
  show(command, `running ${command}...`);
  try {
    const result = await call('/api/run', { command });
    show(`${command} - exit ${result.code}`, result.output || '(no output)');
  } catch (err) {
    show(command, err.message);
  } finally {
    buttons.forEach((b) => { b.disabled = false; });
    await refresh();
    if (button) button.focus();
  }
}

document.addEventListener('DOMContentLoaded', () => {
  if (!token) banner('Open the panel from the address it printed in the terminal; this one has no token.');

  $('connect').addEventListener('click', () => {
    const section = $('builder');
    section.hidden = !section.hidden;
    if (!section.hidden) $('project-path').focus();
  });

  for (const button of document.querySelectorAll('[data-run]')) {
    button.addEventListener('click', () => run(button.dataset.run, button));
  }

  $('project-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    try { render(await call('/api/project', { path: $('project-path').value })); banner(''); } catch (err) { banner(err.message); }
  });

  $('search-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const input = $('search-key');
    try {
      const result = await call('/api/key/search', { key: input.value });
      input.value = '';
      $('search-state').textContent = result.keys.search.set ? `saved (${result.keys.search.source})` : 'cleared';
      banner('');
    } catch (err) { banner(err.message); }
  });

  $('copy-builder').addEventListener('click', async () => {
    try { await navigator.clipboard.writeText($('builder-text').textContent); banner(''); show('Copied', 'The builder instructions are on the clipboard.'); }
    catch { banner('Copy failed: select the text in the builder panel and copy it by hand.'); }
  });

  $('brief').addEventListener('click', async () => {
    try { const brief = await call('/api/brief'); show(brief.path, brief.text); } catch (err) { show('BRIEF.md', err.message); }
  });

  $('auto-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const settings = {
      mode: $('auto-mode').value,
      perRequestPages: Number($('auto-per').value),
      dailyPages: Number($('auto-daily').value),
      intervalMinutes: Number($('auto-every').value),
      topicsFolder: $('auto-topics').value,
    };
    try { renderRequests(await call('/api/autocollect', { settings })); banner(''); } catch (err) { banner(err.message); }
  });

  $('auto-check').addEventListener('click', async () => {
    const button = $('auto-check');
    button.disabled = true;
    $('auto-state').textContent = 'pulling and checking requests...';
    try { renderRequests(await call('/api/requests/check', {})); banner(''); } catch (err) { banner(err.message); }
    finally { button.disabled = false; }
  });

  $('auto-resume').addEventListener('click', async () => {
    try { renderRequests(await call('/api/requests/resume', {})); banner(''); } catch (err) { banner(err.message); }
  });

  refresh();
  refreshRequests();
  setInterval(refreshRequests, 15000);
});
