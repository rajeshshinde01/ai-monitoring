const severityRank = { healthy: 0, warning: 1, critical: 2 };
let data;
let currentUser = null;
const isAdministrator = () => currentUser?.role === 'administrator';
const isDeveloperOrAdministrator = () => ['administrator', 'developer'].includes(currentUser?.role);
const isReadOnly = () => currentUser?.role === 'readonly';
const roleLabel = role => role === 'administrator' ? 'Administrator' : role === 'readonly' ? 'Read-only' : 'Developer / Operator';
let administratorLoginMode = false;
let breakGlassSetupAvailable = false;
let breakGlassEnabled = false;
let breakGlassUsername = 'admin';
let selectedPodName;
let selectedLogIndex;
let logExplorerPodName;
let logExplorerSelectedIndex;
let logExplorerJsonOpen = false;
let logExplorerLevel = 'all';
let logExplorerSearch = '';
let logExplorerFieldSearch = '';
let logExplorerRange = 'all';
let logExplorerBefore = 5;
let logExplorerAfter = 0;
let logExplorerLiveTail = true;
let activeTab = 'overview';
let assistantMessages = [{ role: 'assistant', text: 'I am ready to help with the live L1ControlScope view. Try: “Which pod needs attention?” or “Show memory risk.”' }];
let assistantWaiting = false;
let assistantOpen = false;
let assistantDraft = '';
let assistantRuntimeOpen = false;
let assistantRuntime = { enabled: false, base_url: 'http://ollama:11434', model: 'llama3.2:3b' };
let assistantRuntimeStatus = '';
let splunkSettings = { enabled: false, base_url: '', index: 'main', pod_field: 'kubernetes.pod_name', scope_field: 'kubernetes.namespace', scope_value: '', lookback_minutes: 15 };
let splunkTokenConfigured = false;
let splunkSettingsStatus = '';
let prometheusSettings = { enabled: true, base_url: '' };
let prometheusTokenConfigured = false;
let prometheusSettingsStatus = '';
let observabilityData = { samples: [], events: [], capacity: [], dependencies: [], service_map: { nodes: [], edges: [] } };
let observabilityMinutes = 60;
let trendMode = 'capacity';
let investigationPodName = '';
let selectedDeploymentName;
let selectedDeploymentResource;
let podSearch = '';
let podFilter = 'all';
let podSort = 'attention';
let podPage = 1;
let podPageSize = 25;
let deploymentSearch = '';
let deploymentFilter = 'all';
let deploymentSort = 'attention';
let deploymentPage = 1;
let deploymentPageSize = 25;
let selectedAccessUserEmail = '';
let acknowledgedAlerts = {};
let alertHistory = [];
let sourceHealth = { status: 'checking', collector: {} };
let urlMonitorEnvironment = 'dev';
let urlMonitors = [];
let urlMonitorSearch = '';
let urlMonitorStatus = 'all';
let urlMonitorActionMenu = '';
let urlMonitorEditingId = '';
let correlationIntelligence = null;
let developerInvestigationPod = '';
let developerInvestigationWorkspace = null;
let sharedInvestigationRestored = false;
let incidentReplayIndex = -1;
let incidentReplayTimer = null;

function renderCorrelationIntelligence() {
  const target = document.querySelector('#correlation-intelligence');
  if (!target) return;
  if (!correlationIntelligence) { target.className = 'correlation-intelligence empty'; target.textContent = 'Correlating current operational signals…'; return; }
  const summary = correlationIntelligence.summary || {};
  const incidents = correlationIntelligence.incidents || [];
  target.className = 'correlation-intelligence';
  target.innerHTML = `<section class="correlation-overview"><div><span>Open investigations</span><strong>${summary.total || 0}</strong><small>Ranked by operational impact</small></div><div><span>Critical</span><strong>${summary.critical || 0}</strong><small>Immediate investigation</small></div><div><span>Signals reviewed</span><strong>${summary.signals_correlated || 0}</strong><small>URLs, deployments, pods, logs</small></div><div class="correlation-trust"><b>Rule-based & evidence-led</b><small>No AI connection required.</small></div></section>${incidents.length ? `<div class="correlation-list">${incidents.map((item, index) => `<article class="correlation-card ${escapeHtml(item.severity)}"><header><div><span class="correlation-rank">${String(index + 1).padStart(2, '0')}</span><div><small>${escapeHtml(item.environment?.toUpperCase() || 'PLATFORM')} · IMPACT ${item.score}/100</small><h3>${escapeHtml(item.title)}</h3><p>${escapeHtml(item.summary)}</p></div></div><span class="status ${item.severity}">${escapeHtml(item.severity)}</span></header><div class="correlation-body"><section><span>LIKELY CAUSE</span><p>${escapeHtml(item.probable_cause)}</p><span>OBSERVED EVIDENCE</span><ul>${item.evidence.map(value => `<li>${escapeHtml(value)}</li>`).join('')}</ul></section><aside><div class="confidence"><span style="width:${item.confidence}%"></span></div><small>${item.confidence}% evidence strength</small><b>Recommended next action</b><p>${escapeHtml(item.recommendation)}</p>${item.pod ? `<button type="button" data-correlation-pod="${escapeHtml(item.pod)}">Open pod investigation</button>` : `<button type="button" data-correlation-urls>Open URL monitoring</button>`}</aside></div></article>`).join('')}</div>` : '<div class="correlation-clear"><span>✓</span><div><strong>No correlated incidents right now</strong><p>Current URL, deployment, pod, capacity, and log rules do not require action.</p></div></div>'}`;
  const releases = correlationIntelligence.release_timeline || [];
  const commitFromImage = image => String(image || '').match(/(?:^|[:@-])([a-f0-9]{7,40})(?:$|\b)/i)?.[1];
  target.insertAdjacentHTML('beforeend', `<section class="release-timeline"><header><div><span>RELEASE OBSERVATION</span><h3>Deployment and image timeline</h3></div><small>Read automatically from the runtime—no pipeline change</small></header>${releases.length ? `<div>${releases.map(change => { const commit = commitFromImage(change.current_image); return `<article><i class="${change.severity === 'warning' ? 'changed' : ''}"></i><div><b>${escapeHtml(change.workload || change.pod || 'Workload')}</b><p>${escapeHtml(change.detail || change.current_image || 'Release observed')}</p><small>${new Date(Number(change.timestamp) * 1000).toLocaleString()}${commit ? ` · Possible commit ${escapeHtml(commit.slice(0, 12))}` : ' · Commit unavailable in runtime metadata'}</small></div><span>${escapeHtml(change.change_type === 'image' ? 'Image changed' : 'Observed')}</span></article>`; }).join('')}</div>` : '<p class="release-empty">The current release baseline has been captured. Future image and readiness changes will appear here automatically.</p>'}</section>`);
  const comparisons = correlationIntelligence.deployment_comparisons || [];
  const comparisonMetric = (label, key, before, after, suffix = '') => { const delta = before && after ? Number(after[key]) - Number(before[key]) : null; const tone = delta == null || delta === 0 ? 'neutral' : (key === 'ready_percent' ? delta < 0 : delta > 0) ? 'worse' : 'better'; return `<div><span>${label}</span><b>${before ? `${before[key]}${suffix}` : '—'} <i>→</i> ${after ? `${after[key]}${suffix}` : '—'}</b><small class="${tone}">${delta == null ? 'Baseline unavailable' : `${delta > 0 ? '+' : ''}${delta.toFixed(1)}${suffix}`}</small></div>`; };
  target.insertAdjacentHTML('beforeend', `<section class="deployment-comparison"><header><div><span>RELEASE IMPACT</span><h3>Before / after deployment comparison</h3></div><small>15-minute windows · runtime evidence</small></header>${comparisons.length ? `<div>${comparisons.map(item => `<article class="${item.status}"><div class="comparison-heading"><div><b>${escapeHtml(item.workload)}</b><small>${new Date(Number(item.changed_at) * 1000).toLocaleString()}</small></div><span>${item.status === 'regressed' ? 'Regression detected' : item.status === 'stable' ? 'No regression detected' : 'Collecting baseline'}</span></div><div class="image-change"><code>${escapeHtml(item.previous_image || 'No previous image recorded')}</code><i>→</i><code>${escapeHtml(item.current_image || 'Image unavailable')}</code></div><div class="comparison-metrics">${comparisonMetric('Readiness', 'ready_percent', item.before, item.after, '%')}${comparisonMetric('Log errors', 'errors', item.before, item.after)}${comparisonMetric('Restarts', 'restarts', item.before, item.after)}${comparisonMetric('Memory', 'memory_percent', item.before, item.after, '%')}${comparisonMetric('CPU', 'cpu_percent', item.before, item.after, '%')}</div><p>${item.status === 'collecting' ? 'L1ControlScope has captured this release and is collecting enough pre/post samples for a reliable comparison.' : item.status === 'regressed' ? 'One or more operational signals worsened after this release. Review the changed metrics and correlated logs before deciding whether to roll back.' : 'The monitored readiness, restart, error, memory, and CPU signals did not materially regress in the available comparison window.'}</p></article>`).join('')}</div>` : '<p class="release-empty">No release observation is available yet. The comparison will begin automatically when an image is first observed or changes.</p>'}</section>`);
  target.querySelectorAll('.deployment-comparison article').forEach((card, index) => { const item = comparisons[index]; if (item?.status !== 'collecting' || item.previous_image) return; card.querySelector('.comparison-heading > span').textContent = 'Baseline unavailable'; card.querySelector(':scope > p').textContent = 'This is the first observed release, so no earlier 15-minute baseline exists. L1ControlScope will automatically compare the next image change against retained runtime evidence.'; });
  target.querySelectorAll('[data-correlation-pod]').forEach(button => button.addEventListener('click', () => openPodInvestigation(button.dataset.correlationPod)));
  target.querySelectorAll('[data-correlation-urls]').forEach(button => button.addEventListener('click', () => { window.history.replaceState(null, '', '#url-monitoring'); setWorkspacePage('url-monitoring'); window.scrollTo({ top: 0, behavior: 'smooth' }); }));
}

async function loadCorrelationIntelligence() {
  if (!isDeveloperOrAdministrator()) return;
  try {
    const response = await fetch('/api/operations-intelligence/correlations');
    if (!response.ok) throw new Error('Correlation service unavailable');
    correlationIntelligence = await response.json();
  } catch (error) {
    correlationIntelligence = { summary: {}, incidents: [{ severity: 'warning', score: 0, confidence: 0, title: 'Intelligence is temporarily unavailable', summary: error.message, probable_cause: 'The live correlation request could not complete.', evidence: [], recommendation: 'Refresh after the monitoring connection recovers.' }] };
  }
  renderCorrelationIntelligence();
}

const workloadViewsKey = 'l1controlscope-workload-views';
function savedWorkloadViews() {
  try { return JSON.parse(localStorage.getItem(workloadViewsKey) || '[]'); } catch { return []; }
}
function saveWorkloadView() {
  const name = window.prompt('Name this workload view');
  if (!name?.trim()) return;
  const view = { name: name.trim().slice(0, 60), filter: deploymentFilter, sort: deploymentSort, page_size: deploymentPageSize };
  const views = savedWorkloadViews().filter(item => item.name !== view.name);
  views.push(view);
  localStorage.setItem(workloadViewsKey, JSON.stringify(views.slice(-12)));
  renderWorkloads(data?.inventory);
}

const percent = value => `${Number(value).toFixed(0)}%`;
const severityClass = value => `status ${value}`;
const escapeHtml = value => String(value ?? '').replace(/[&<>'"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char]));
const command = (label, value, note = '') => `<div class="command-card"><div><strong>${label}</strong><small>${note}</small></div><code>${escapeHtml(value)}</code><button class="copy-command" data-command="${escapeHtml(value)}">Copy</button></div>`;

// These are deliberately global because summary cards and the floating
// Intelligence assistant can be opened from outside the main workspace setup.
function pageFromTarget(targetId) {
  const page = targetId === 'observability-center' ? 'operations' : targetId === 'deployment-readiness' || targetId === 'deployment-inspector' || targetId === 'container-monitoring' ? 'workloads' : targetId === 'log-explorer-panel' ? 'logs' : targetId === 'developer-investigation' ? 'investigation' : targetId === 'url-monitoring' ? 'url-monitoring' : targetId === 'data-sources' ? 'data-sources' : targetId === 'access-center' ? 'access' : targetId === 'intelligence-center' ? 'intelligence' : targetId === 'alert-center' ? 'alerts' : 'overview';
  if ((page === 'access' || page === 'data-sources') && !isAdministrator()) return 'overview';
  if ((page === 'logs' || page === 'operations') && !isDeveloperOrAdministrator()) return 'overview';
  return page;
}

function renderUrlMonitors() {
  const environments = ['dev', 'qa', 'uat', 'prod'];
  const visible = urlMonitors.filter(item => item.environment === urlMonitorEnvironment && (`${item.name} ${item.url}`).toLowerCase().includes(urlMonitorSearch.toLowerCase()) && (urlMonitorStatus === 'all' || (urlMonitorStatus === 'attention' ? ['degraded', 'down'].includes(item.status) : item.status === urlMonitorStatus)));
  const operational = urlMonitors.filter(item => item.status === 'operational').length;
  const attention = urlMonitors.filter(item => ['degraded', 'down'].includes(item.status)).length;
  const averageLatency = Math.round(urlMonitors.filter(item => item.latency_ms != null).reduce((total, item) => total + item.latency_ms, 0) / Math.max(1, urlMonitors.filter(item => item.latency_ms != null).length));
  document.querySelector('#url-monitor-banner').innerHTML = `<div class="url-banner-icon ${attention ? 'attention' : ''}">${attention ? '!' : '✓'}</div><div><strong>${attention ? `${attention} endpoint${attention === 1 ? '' : 's'} need attention` : urlMonitors.length ? 'All monitored endpoints are operational' : 'Ready to monitor your applications'}</strong><p>${attention ? 'Review degraded or unreachable applications below.' : urlMonitors.length ? 'Every enabled health check returned its expected response.' : 'Add your first environment URL to begin availability checks.'}</p></div><span>${operational}/${urlMonitors.filter(item => item.status !== 'disabled').length || 0} healthy</span>`;
  document.querySelector('#url-monitor-summary').innerHTML = `<article><div class="metric-icon configured">◎</div><div><span>Configured URLs</span><strong>${urlMonitors.length}</strong><small>${new Set(urlMonitors.map(item => item.environment)).size} active environments</small></div></article><article><div class="metric-icon healthy">✓</div><div><span>Operational</span><strong>${operational}</strong><small>Expected response received</small></div></article><article><div class="metric-icon warning">!</div><div><span>Needs attention</span><strong>${attention}</strong><small>Degraded or unreachable</small></div></article><article><div class="metric-icon latency">⌁</div><div><span>Average latency</span><strong>${averageLatency || '—'}${averageLatency ? ' ms' : ''}</strong><small>Across latest checks</small></div></article>`;
  document.querySelector('#url-monitor-tabs').innerHTML = environments.map(environment => { const items = urlMonitors.filter(item => item.environment === environment); const issues = items.filter(item => ['degraded','down'].includes(item.status)).length; return `<button type="button" class="${environment === urlMonitorEnvironment ? 'active' : ''}" data-url-environment="${environment}"><i class="env-dot ${issues ? 'attention' : ''}"></i><b>${environment.toUpperCase()}</b><small>${items.length} URL${items.length === 1 ? '' : 's'}</small>${issues ? `<em>${issues}</em>` : ''}</button>`; }).join('');
  document.querySelectorAll('[data-url-environment]').forEach(button => button.addEventListener('click', () => { urlMonitorEnvironment = button.dataset.urlEnvironment; renderUrlMonitors(); }));
  document.querySelector('#url-monitor-list').className = 'url-monitor-list';
  document.querySelector('#url-monitor-list').innerHTML = `<div class="url-monitor-list-head"><span>APPLICATION & ENDPOINT</span><span>HEALTH</span><span>RESPONSE</span><span>EXPECTED</span><span>LAST CHECK</span><span></span></div>${visible.length ? visible.map(item => `<article class="url-monitor-card"><div class="url-app"><span class="url-app-icon">${escapeHtml(item.name.slice(0,2).toUpperCase())}</span><div><strong>${escapeHtml(item.name)}</strong><a href="${escapeHtml(item.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(item.url)} ↗</a><small>${escapeHtml(item.environment.toUpperCase())} · ${escapeHtml(item.health_path || '/')}</small></div></div><span class="status ${item.status === 'operational' ? 'healthy' : item.status === 'degraded' ? 'warning' : item.status === 'disabled' ? '' : 'critical'}"><i></i>${escapeHtml(item.status)}</span><div class="url-response"><strong>${item.latency_ms == null ? '—' : `${item.latency_ms} ms`}</strong><small>${item.status_code ? `HTTP ${item.status_code}` : item.error || 'Not checked'}</small></div><div class="url-expected"><strong>HTTP ${item.expected_status}</strong><small>${item.enabled ? 'Monitoring enabled' : 'Monitoring disabled'}</small></div><div class="url-checked"><strong>${item.checked_at ? new Date(item.checked_at).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit',second:'2-digit'}) : '—'}</strong><small>Latest run</small></div>${isAdministrator() ? `<div class="url-row-actions">${urlMonitorActionMenu === item.id ? `<button type="button" data-url-edit="${escapeHtml(item.id)}">Edit</button><button type="button" class="danger" data-url-delete="${escapeHtml(item.id)}">Delete</button>` : `<button type="button" class="url-row-menu" data-url-menu="${escapeHtml(item.id)}" aria-label="Actions for ${escapeHtml(item.name)}">•••</button>`}</div>` : '<span></span>'}</article>`).join('') : `<div class="url-monitor-empty"><span>◎</span><strong>No matching ${urlMonitorEnvironment.toUpperCase()} URLs</strong><p>Add an environment URL or adjust the current search and status filters.</p></div>`}`;
  document.querySelectorAll('[data-url-menu]').forEach(button => button.addEventListener('click', () => { urlMonitorActionMenu = button.dataset.urlMenu; renderUrlMonitors(); }));
  document.querySelectorAll('[data-url-edit]').forEach(button => button.addEventListener('click', () => { urlMonitorEditingId = button.dataset.urlEdit; urlMonitorActionMenu = ''; renderUrlMonitors(); document.querySelector('.url-monitor-add')?.scrollIntoView({ behavior: 'smooth', block: 'center' }); }));
  document.querySelectorAll('[data-url-delete]').forEach(button => button.addEventListener('click', async () => { if (!window.confirm('Delete this URL monitor?')) return; await fetch(`/api/url-monitors/${encodeURIComponent(button.dataset.urlDelete)}`, { method: 'DELETE' }); await loadUrlMonitors(); }));
  const admin = document.querySelector('#url-monitor-admin');
  const editing = urlMonitors.find(item => item.id === urlMonitorEditingId);
  admin.innerHTML = isAdministrator() ? `<details class="url-monitor-add" ${editing ? 'open' : ''}><summary><span>${editing ? '✎' : '＋'}</span><div><strong>${editing ? 'Edit application endpoint' : 'Add an application endpoint'}</strong><small>${editing ? 'Update the URL, health path, expected response, or monitoring state' : 'Configure an approved URL for continuous environment monitoring'}</small></div><b>${editing ? 'Editing' : 'Open form'}</b></summary><form id="url-monitor-form"><label>Application name<input name="name" required maxlength="120" placeholder="Customer portal" value="${escapeHtml(editing?.name || '')}"></label><label>Environment<select name="environment">${environments.map(environment => `<option value="${environment}" ${editing?.environment === environment ? 'selected' : ''}>${environment.toUpperCase()}</option>`).join('')}</select></label><label class="wide-field">Application URL<input name="url" type="url" required placeholder="https://app-dev.example.com" value="${escapeHtml(editing?.url || '')}"></label><label>Health-check path<input name="health_path" placeholder="/health or /" value="${escapeHtml(editing?.health_path || '')}"></label><label>Expected response<input name="expected_status" type="number" min="100" max="599" value="${Number(editing?.expected_status || 200)}"></label><label class="url-monitor-enabled"><input name="enabled" type="checkbox" ${editing?.enabled === false ? '' : 'checked'}><span>Enable continuous checks</span></label><button type="submit" class="primary">${editing ? 'Save changes' : 'Add endpoint'}</button>${editing ? '<button type="button" class="url-edit-cancel" data-url-edit-cancel>Cancel</button>' : ''}<p class="form-message"></p></form></details>` : '<p class="rule-view-only">Administrators manage URLs. You can review and refresh their current status.</p>';
  admin.querySelector('#url-monitor-form')?.addEventListener('submit', saveUrlMonitor);
  admin.querySelector('[data-url-edit-cancel]')?.addEventListener('click', () => { urlMonitorEditingId = ''; renderUrlMonitors(); });
}

async function loadUrlMonitors() {
  const button = document.querySelector('#url-monitor-refresh');
  button?.classList.add('loading'); if (button) button.querySelector('span').textContent = 'Checking endpoints…';
  const response = await fetch('/api/url-monitors');
  if (!response.ok) { document.querySelector('#url-monitor-list').innerHTML = '<p class="empty">URL monitoring is unavailable for this account.</p>'; button?.classList.remove('loading'); return; }
  urlMonitors = (await response.json()).monitors || [];
  document.querySelector('#url-monitor-updated').textContent = `Last checked ${new Date().toLocaleTimeString([], {hour:'2-digit',minute:'2-digit',second:'2-digit'})}`;
  button?.classList.remove('loading'); if (button) button.querySelector('span').textContent = 'Run health check';
  renderUrlMonitors();
}

async function saveUrlMonitor(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const values = Object.fromEntries(new FormData(form).entries());
  const payload = { ...values, expected_status: Number(values.expected_status), enabled: form.elements.enabled.checked };
  const endpoint = urlMonitorEditingId ? `/api/url-monitors/${encodeURIComponent(urlMonitorEditingId)}` : '/api/url-monitors';
  const response = await fetch(endpoint, { method: urlMonitorEditingId ? 'PUT' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
  const result = await response.json();
  if (!response.ok) { form.querySelector('.form-message').textContent = result.detail || 'Unable to add URL.'; return; }
  urlMonitorEnvironment = payload.environment; urlMonitorEditingId = ''; urlMonitorActionMenu = ''; form.reset(); await loadUrlMonitors();
}

function setWorkspacePage(page) {
  document.body.dataset.page = page;
  document.querySelectorAll('[data-workspace-tab], .workspace-nav a').forEach(tab => {
    const targetId = (tab.getAttribute('href') || '#overview').slice(1);
    const selected = pageFromTarget(targetId) === page && !(page === 'overview' && targetId !== 'overview');
    tab.classList.toggle('active', selected);
    if (selected) tab.setAttribute('aria-current', 'page'); else tab.removeAttribute('aria-current');
  });
}

function assistantMessageHtml(message) {
  const actions = message.actions?.length ? `<div class="assistant-message-actions">${message.actions.map(action => `<button data-assistant-action="${escapeHtml(action.type)}" data-assistant-pod="${escapeHtml(action.pod)}">${escapeHtml(action.label)}</button>`).join('')}</div>` : '';
  const source = message.provider === 'ollama' ? ` · Local Ollama (${message.model})` : message.provider === 'python-fallback' ? ' · Python fallback' : '';
  const scope = message.scope ? `<div class="assistant-query-scope"><b>Search scope</b>${message.scope.sources?.length ? `<span>${escapeHtml(message.scope.sources.join(' + '))}</span>` : ''}${message.scope.time_range_minutes ? `<span>${Math.round(message.scope.time_range_minutes / 60)}h</span>` : ''}${message.scope.matched_pods?.length ? `<span>${escapeHtml(message.scope.matched_pods.join(', '))}</span>` : ''}${message.scope.terms?.length ? `<span>Terms: ${escapeHtml(message.scope.terms.join(', '))}</span>` : ''}</div>` : '';
  return `<article class="assistant-message ${message.role}"><span>${message.role === 'user' ? 'You' : `L1ControlScope Operations${escapeHtml(source)}`}</span>${scope}<p>${escapeHtml(message.text).replaceAll('\n', '<br>')}</p>${actions}</article>`;
}

function renderAssistant() {
  const target = document.querySelector('#assistant');
  const operationsPanel = target.closest('.optional-ai');
  if (operationsPanel) {
    operationsPanel.open = true;
    operationsPanel.querySelector('summary b').textContent = 'Ask Operations';
    operationsPanel.querySelector('summary small').textContent = 'Search app evidence first; optional AI only summarizes verified results';
  }
  const runtime = `<section class="assistant-runtime ${assistantRuntimeOpen ? 'open' : ''}"><div class="integration-heading"><strong>AI runtime</strong><small>Optional grounded response wording</small></div><label class="assistant-runtime-toggle"><input id="runtime-enabled" type="checkbox" ${assistantRuntime.enabled ? 'checked' : ''}> Enable local Ollama for grounded assistant responses</label><label>Ollama address<input id="runtime-base-url" value="${escapeHtml(assistantRuntime.base_url)}" placeholder="http://ollama:11434"></label><label>Approved model<input id="runtime-model" value="${escapeHtml(assistantRuntime.model)}" placeholder="llama3.2:3b"></label><div class="assistant-runtime-actions"><button type="button" class="primary" data-runtime-save>Save settings</button><button type="button" data-runtime-test>Test connection</button></div><p class="assistant-runtime-status">${escapeHtml(assistantRuntimeStatus || 'Settings stay inside PulseOps local storage. The connection test sends no telemetry or logs.')}</p></section>`;
  target.innerHTML = `${runtime}<div class="assistant-suggestions"><button data-assistant-prompt="Which pod needs attention?" ${assistantWaiting ? 'disabled' : ''}>⌁ Attention</button><button data-assistant-prompt="Show memory risk and forecast" ${assistantWaiting ? 'disabled' : ''}>◒ Memory</button><button data-assistant-prompt="What errors are in the logs?" ${assistantWaiting ? 'disabled' : ''}>⚠ Logs</button><button data-assistant-prompt="Run database playbook" ${assistantWaiting ? 'disabled' : ''}>▤ DB playbook</button><button data-assistant-prompt="Show incident timeline" ${assistantWaiting ? 'disabled' : ''}>◷ Timeline</button></div><div class="assistant-chat" aria-live="polite">${assistantMessages.map(assistantMessageHtml).join('')}${assistantWaiting ? '<article class="assistant-message assistant"><span>PulseOps Intelligence</span><p>Reviewing current telemetry…</p></article>' : ''}</div><form id="assistant-form" class="assistant-form"><label for="assistant-question">Ask about your operations</label><div><input id="assistant-question" maxlength="1000" value="${escapeHtml(assistantDraft)}" placeholder="Example: How many pods are running?" autocomplete="off"><button ${assistantWaiting ? 'disabled' : ''}>Ask</button></div><small>Python-based, data-grounded analysis of live telemetry and masked logs.</small></form>`;
  target.querySelectorAll('[data-assistant-prompt]').forEach(button => button.addEventListener('click', () => { assistantDraft = ''; askAssistant(button.dataset.assistantPrompt); }));
  target.querySelector('#assistant-form').addEventListener('submit', event => {
    event.preventDefault();
    askAssistant(assistantDraft);
  });
  target.querySelector('#assistant-question').addEventListener('input', event => { assistantDraft = event.target.value; });
  target.querySelector('[data-runtime-save]').addEventListener('click', saveAssistantRuntime);
  target.querySelector('[data-runtime-test]').addEventListener('click', testAssistantRuntime);
  if (!isAdministrator()) target.querySelector('.assistant-runtime')?.querySelectorAll('input,button').forEach(control => { control.disabled = true; });
  target.querySelectorAll('[data-assistant-action]').forEach(button => button.addEventListener('click', () => {
    const pod = button.dataset.assistantPod;
    if (button.dataset.assistantAction === 'open-pod') {
      selectPod(pod);
      document.querySelector('#container-monitoring').scrollIntoView({ behavior: 'smooth', block: 'start' });
    } else if (button.dataset.assistantAction === 'view-logs') {
      logExplorerPodName = pod;
      logExplorerSelectedIndex = undefined;
      renderLogExplorer();
      document.querySelector('#log-explorer-panel').scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }));
  const chat = target.querySelector('.assistant-chat');
  chat.scrollTop = chat.scrollHeight;
}

function runtimeFormValues() {
  return { enabled: document.querySelector('#runtime-enabled').checked, base_url: document.querySelector('#runtime-base-url').value.trim(), model: document.querySelector('#runtime-model').value.trim() };
}

async function loadAssistantRuntime() {
  try {
    const response = await fetch('/api/ai-runtime');
    const payload = await response.json();
    if (response.ok && payload.runtime) assistantRuntime = payload.runtime;
  } catch { assistantRuntimeStatus = 'Runtime settings are unavailable until the PulseOps backend is connected.'; }
}

function splunkFormValues() {
  return { enabled: document.querySelector('#splunk-enabled').checked, base_url: document.querySelector('#splunk-base-url').value.trim(), index: document.querySelector('#splunk-index').value.trim(), pod_field: splunkSettings.pod_field || 'kubernetes.pod_name', scope_field: document.querySelector('#splunk-scope-field').value.trim(), scope_value: document.querySelector('#splunk-scope-value').value.trim(), lookback_minutes: Number(document.querySelector('#splunk-lookback').value) || 15 };
}

function renderDataSources() {
  const target = document.querySelector('#data-sources-content');
  if (!target) return;
  const windows = [[15, '15 minutes'], [60, '60 minutes'], [120, '2 hours'], [480, '8 hours'], [720, '12 hours'], [1440, '24 hours'], [2880, '2 days'], [11520, '8 days'], [21600, '15 days'], [43200, '1 month']];
  target.innerHTML = `<article class="data-source-card"><span class="status healthy">Optional</span><h3>Kubernetes / OpenShift</h3><p>Preferred source for current pods, deployments, Services, CPU, memory, and restart counts. Requires platform-provided read-only access.</p><p class="source-status">PulseOps automatically uses this source when its monitoring identity has permission.</p></article><article class="data-source-card"><span class="status ${splunkSettings.enabled ? 'healthy' : 'warning'}">${splunkSettings.enabled ? 'Configured' : 'Not configured'}</span><h3>Splunk</h3><p>External workload evidence and all logs for the selected application scope. The token stays in a Secret.</p><label><input id="splunk-enabled" type="checkbox" ${splunkSettings.enabled ? 'checked' : ''}> Enable Splunk source</label><label>Management URL<input id="splunk-base-url" value="${escapeHtml(splunkSettings.base_url)}" placeholder="https://splunk.company.example:8089"></label><label>Index<input id="splunk-index" value="${escapeHtml(splunkSettings.index)}"></label><label>Application scope field<input id="splunk-scope-field" value="${escapeHtml(splunkSettings.scope_field || 'kubernetes.namespace')}"></label><label>Application scope value<input id="splunk-scope-value" value="${escapeHtml(splunkSettings.scope_value || '')}" placeholder="mindspark-official"></label><label>Search window<select id="splunk-lookback">${windows.map(([value, label]) => `<option value="${value}" ${Number(splunkSettings.lookback_minutes) === value ? 'selected' : ''}>${label}</option>`).join('')}</select></label><div class="source-actions"><button class="primary" data-splunk-save>Save Splunk</button><button data-splunk-test>Test connection</button></div><p class="source-status">${escapeHtml(splunkSettingsStatus || (splunkTokenConfigured ? 'API token is securely configured. Pod-field mapping is managed internally.' : 'SPLUNK_API_TOKEN and SPLUNK_ALLOWED_HOSTS must be provided by an administrator.'))}</p></article><article class="data-source-card"><span class="status ${prometheusSettings.enabled ? 'healthy' : 'warning'}">${prometheusSettings.enabled ? 'Configured' : 'Disabled'}</span><h3>Prometheus</h3><p>Numeric CPU, memory, restart, and availability history for forecasting. Any token remains in a Secret.</p><label><input id="prometheus-enabled" type="checkbox" ${prometheusSettings.enabled ? 'checked' : ''}> Enable Prometheus source</label><label>Prometheus URL<input id="prometheus-base-url" value="${escapeHtml(prometheusSettings.base_url)}" placeholder="https://prometheus.company.example"></label><div class="source-actions"><button class="primary" data-prometheus-save>Save Prometheus</button><button data-prometheus-test>Test connection</button></div><p class="source-status">${escapeHtml(prometheusSettingsStatus || (prometheusTokenConfigured ? 'API token is securely configured.' : 'PROMETHEUS_ALLOWED_HOSTS must be provided by an administrator. Add PROMETHEUS_API_TOKEN only when your endpoint requires it.'))}</p></article>`;
  const collector = sourceHealth.collector || {};
  const runtimeSource = data?.mode === 'docker' ? 'Local Docker' : data?.mode === 'splunk' ? 'Splunk' : data?.mode === 'kubernetes' ? 'Kubernetes / OpenShift' : 'Waiting for telemetry';
  const readiness = sourceHealth.status === 'ready';
  const sourceCards = [
    ['Live telemetry', runtimeSource, readiness ? 'healthy' : 'warning', readiness ? `Current · updated ${collector.age_seconds ?? '—'}s ago` : 'Telemetry is not ready.'],
    ['Prometheus', prometheusSettings.enabled ? 'Enabled' : 'Disabled', prometheusSettings.enabled ? 'healthy' : 'warning', prometheusSettings.enabled ? 'Trends and forecasts available.' : 'Forecast history unavailable.'],
    ['Splunk fallback', splunkSettings.enabled ? 'Enabled' : 'Not enabled', splunkSettings.enabled && splunkTokenConfigured ? 'healthy' : 'warning', splunkSettings.enabled ? (splunkTokenConfigured ? 'Fallback logs ready.' : 'Token still required.') : 'Optional log fallback.'],
  ];
  target.insertAdjacentHTML('afterbegin', `<section class="source-health-board"><div><p class="eyebrow">SOURCE STATUS</p><h3>Evidence available to this dashboard</h3><p>Use the configuration cards below only when a connection needs to be changed or tested.</p></div><div class="source-health-items">${sourceCards.map(([label, value, status, detail]) => `<article class="source-health-item"><span class="${severityClass(status)}">${escapeHtml(status === 'healthy' ? 'available' : 'attention')}</span><strong>${escapeHtml(label)}</strong><b>${escapeHtml(value)}</b><small>${escapeHtml(detail)}</small></article>`).join('')}</div></section>`);
  target.querySelector('[data-splunk-save]').addEventListener('click', saveSplunkSettings);
  target.querySelector('[data-splunk-test]').addEventListener('click', testSplunkSettings);
  target.querySelector('[data-prometheus-save]').addEventListener('click', savePrometheusSettings);
  target.querySelector('[data-prometheus-test]').addEventListener('click', testPrometheusSettings);
  if (!isAdministrator()) {
    target.querySelectorAll('input, select, button').forEach(control => { control.disabled = true; });
    target.insertAdjacentHTML('afterbegin', '<p class="source-status">View-only access. An administrator manages connections and settings.</p>');
  }
}

function prometheusFormValues() { return { enabled: document.querySelector('#prometheus-enabled').checked, base_url: document.querySelector('#prometheus-base-url').value.trim() }; }

async function loadPrometheusSettings() { try { const response = await fetch('/api/prometheus-settings'); const payload = await response.json(); if (response.ok && payload.settings) { prometheusSettings = payload.settings; prometheusTokenConfigured = Boolean(payload.token_configured); } } catch { prometheusSettingsStatus = 'Prometheus settings are unavailable until the PulseOps backend is connected.'; } }

async function savePrometheusSettings() { prometheusSettingsStatus = 'Saving Prometheus settings…'; renderDataSources(); try { const response = await fetch('/api/prometheus-settings', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(prometheusFormValues()) }); const payload = await response.json(); if (!response.ok) throw new Error(payload.detail || 'Unable to save Prometheus settings.'); prometheusSettings = payload.settings; prometheusTokenConfigured = Boolean(payload.token_configured); prometheusSettingsStatus = prometheusSettings.enabled ? 'Saved. PulseOps will use Prometheus history for supported forecast metrics.' : 'Saved. Prometheus is disabled.'; } catch (error) { prometheusSettingsStatus = error.message; } renderDataSources(); }

async function testPrometheusSettings() { prometheusSettingsStatus = 'Testing the approved Prometheus endpoint…'; renderDataSources(); try { const response = await fetch('/api/prometheus-settings/test', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(prometheusFormValues()) }); const payload = await response.json(); if (!response.ok) throw new Error(payload.detail || 'Unable to test Prometheus.'); prometheusSettingsStatus = payload.message; } catch (error) { prometheusSettingsStatus = error.message; } renderDataSources(); }

async function loadSplunkSettings() {
  try {
    const response = await fetch('/api/splunk-settings');
    const payload = await response.json();
    if (response.ok && payload.settings) { splunkSettings = payload.settings; splunkTokenConfigured = Boolean(payload.token_configured); }
  } catch { splunkSettingsStatus = 'Splunk settings are unavailable until the PulseOps backend is connected.'; }
}

async function saveSplunkSettings() {
  splunkSettingsStatus = 'Saving Splunk fallback settings…';
  renderDataSources();
  try {
    const response = await fetch('/api/splunk-settings', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(splunkFormValues()) });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.detail || 'Unable to save Splunk settings.');
    splunkSettings = payload.settings; splunkTokenConfigured = Boolean(payload.token_configured);
    splunkSettingsStatus = splunkSettings.enabled ? 'Saved. Kubernetes remains primary; if access is denied, PulseOps will use Splunk for indexed workload records and logs.' : 'Saved. Splunk external monitoring is disabled.';
  } catch (error) { splunkSettingsStatus = error.message; }
  renderDataSources();
}

async function testSplunkSettings() {
  splunkSettingsStatus = 'Testing the approved Splunk endpoint…';
  renderDataSources();
  try {
    const response = await fetch('/api/splunk-settings/test', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(splunkFormValues()) });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.detail || 'Unable to test Splunk.');
    splunkSettingsStatus = payload.message;
  } catch (error) { splunkSettingsStatus = error.message; }
  renderDataSources();
}

async function saveAssistantRuntime() {
  assistantRuntimeStatus = 'Saving local runtime settings…';
  renderAssistant();
  try {
    const response = await fetch('/api/ai-runtime', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(runtimeFormValues()) });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.detail || 'Unable to save settings.');
    assistantRuntime = payload.runtime;
    assistantRuntimeStatus = assistantRuntime.enabled ? 'Saved. The next PulseOps answer will use local Ollama only to concisely explain verified telemetry findings.' : 'Saved. PulseOps will use Python Operations Intelligence until local Ollama is enabled.';
  } catch (error) { assistantRuntimeStatus = error.message; }
  renderAssistant();
}

async function testAssistantRuntime() {
  assistantRuntimeStatus = 'Testing the local Ollama service…';
  renderAssistant();
  try {
    const response = await fetch('/api/ai-runtime/test', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(runtimeFormValues()) });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.detail || 'Unable to test Ollama.');
    assistantRuntimeStatus = payload.connected ? `${payload.message} ${payload.selected_model_available ? `The selected model (${payload.selected_model}) is available.` : `Pull the selected model (${payload.selected_model}) before enabling future integration.`}` : payload.message;
  } catch (error) { assistantRuntimeStatus = error.message; }
  renderAssistant();
}

async function askAssistant(question) {
  const cleanQuestion = String(question || '').trim();
  if (cleanQuestion.length < 3 || assistantWaiting) return;
  setAssistantOpen(true);
  assistantDraft = '';
  assistantMessages.push({ role: 'user', text: cleanQuestion });
  assistantWaiting = true;
  renderAssistant();
  try {
    const response = await fetch('/api/assistant', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ question: cleanQuestion, current_pod: selectedPodName || null }) });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.detail || 'Unable to review live telemetry.');
    assistantMessages.push({ role: 'assistant', text: `${payload.answer}${payload.runtime?.notice ? `\n\n${payload.runtime.notice}` : ''}`, actions: payload.actions || [], scope: payload.scope, provider: payload.runtime?.provider, model: payload.runtime?.model });
  } catch (error) {
    assistantMessages.push({ role: 'assistant', text: `I could not review the live telemetry: ${error.message}` });
  } finally {
    assistantWaiting = false;
    // Keep the chat useful and compact during a long monitoring session.
    assistantMessages = assistantMessages.slice(-12);
    renderAssistant();
  }
}

function setAssistantOpen(open) {
  assistantOpen = open;
  if (open) {
    window.history.replaceState(null, '', '#intelligence-center');
    setWorkspacePage('intelligence');
    renderAssistant();
    setTimeout(() => document.querySelector('#assistant-question')?.focus(), 120);
  }
}

function renderSummary(summary) {
  const cards = [['▣', 'Deployments ready', `${summary.running_deployments}/${summary.deployments}`, 'deployment-readiness'], ['◈', 'Pods running', `${summary.running_pods}/${summary.pods}`, 'container-monitoring'], ['✓', 'Healthy pods', `${summary.healthy_pods}/${summary.pods}`, 'container-monitoring'], ['⌁', 'Average CPU', percent(summary.average_cpu_percent)], ['◒', 'Memory', percent(summary.average_memory_percent)], ['↻', 'Restarts', summary.total_restarts, 'container-monitoring'], ['⇄', 'Exposed services', `${summary.exposed_services}/${summary.services}`, 'deployment-readiness'], ['!', 'Alerts', summary.alerts]];
  document.querySelector('#summary').innerHTML = cards.map(([icon, label, value, target]) => target ? `<button class="metric metric-button" data-summary-target="${target}" aria-label="View ${label} list"><span class="metric-icon">${icon}</span><div><span>${label}</span><strong>${value}</strong><small>View list →</small></div></button>` : `<article class="metric"><span class="metric-icon">${icon}</span><div><span>${label}</span><strong>${value}</strong></div></article>`).join('');
  document.querySelectorAll('[data-summary-target]').forEach(button => button.addEventListener('click', () => {
    const target = document.querySelector(`#${button.dataset.summaryTarget}`);
    const page = pageFromTarget(button.dataset.summaryTarget);
    window.history.replaceState(null, '', `#${button.dataset.summaryTarget}`);
    setWorkspacePage(page);
    setTimeout(() => {
      target.scrollIntoView({ behavior: 'smooth', block: 'start' });
      target.classList.remove('panel-focus');
      requestAnimationFrame(() => target.classList.add('panel-focus'));
      setTimeout(() => target.classList.remove('panel-focus'), 1600);
    }, 0);
  }));
}

function renderPlatformHealth(summary, alerts) {
  const target = document.querySelector('#platform-health');
  const critical = (alerts || []).filter(item => item.severity === 'critical').length;
  const warning = (alerts || []).filter(item => item.severity === 'warning').length;
  const unhealthyPods = Math.max(0, Number(summary.pods || 0) - Number(summary.healthy_pods || 0));
  const status = critical ? 'critical' : warning || unhealthyPods ? 'warning' : 'healthy';
  const headline = critical ? 'Immediate attention is required' : warning || unhealthyPods ? 'Attention items need review' : 'Platform is operating normally';
  const detail = critical ? `${critical} critical alert${critical === 1 ? '' : 's'} detected.` : warning ? `${warning} warning alert${warning === 1 ? '' : 's'} and ${unhealthyPods} workload${unhealthyPods === 1 ? '' : 's'} need review.` : `${summary.healthy_pods}/${summary.pods} pods healthy · no active critical signal.`;
  target.innerHTML = `<div class="platform-health-copy"><span class="${severityClass(status)}">${status === 'healthy' ? 'Healthy' : status === 'warning' ? 'Attention' : 'Critical'}</span><div><strong>${headline}</strong><small>${detail}</small></div></div><button type="button" data-platform-health-action>${status === 'healthy' ? 'Open operations' : 'Review attention'}</button>`;
  target.querySelector('[data-platform-health-action]').addEventListener('click', () => { const id = status === 'healthy' ? 'observability-center' : 'alert-center'; window.history.replaceState(null, '', `#${id}`); setWorkspacePage(pageFromTarget(id)); document.querySelector(`#${id}`).scrollIntoView({ behavior: 'smooth', block: 'start' }); });
}

function renderOverviewFocus(overview, report) {
  const capacity = report?.capacity || [];
  const events = report?.events || [];
  const highest = capacity.reduce((current, item) => !current || Number(item.forecast_percent) > Number(current.forecast_percent) ? item : current, null);
  const alert = [...(overview.alerts || [])].sort((left, right) => severityRank[right.severity] - severityRank[left.severity])[0];
  const event = events[0];
  const cards = [
    { label: 'Alerts', value: alert ? `${alert.severity} alert` : 'No active alerts', detail: alert ? alert.message : 'No immediate action is required.', page: 'alerts', hash: '#alert-center', status: alert?.severity || 'healthy' },
    { label: 'Resource watch', value: highest ? `${percent(highest.forecast_percent)} expected use` : 'No forecast yet', detail: highest ? highest.pod : 'Collecting resource history.', page: 'operations', hash: '#observability-center', status: highest?.risk || 'healthy' },
    { label: 'Latest activity', value: event?.title || 'No recent changes', detail: event?.detail || 'No workload or alert changes in the current window.', page: 'operations', hash: '#observability-center', status: event?.severity || 'healthy' },
  ];
  document.querySelector('#overview-focus-content').innerHTML = cards.map(card => `<button class="overview-focus-card" data-overview-page="${card.page}" data-overview-hash="${card.hash}"><span class="${severityClass(card.status)}">${escapeHtml(card.label)}</span><strong>${escapeHtml(card.value)}</strong><small>${escapeHtml(card.detail)}</small><em>Open details →</em></button>`).join('');
  document.querySelectorAll('[data-overview-page]').forEach(button => button.addEventListener('click', () => {
    window.history.replaceState(null, '', button.dataset.overviewHash);
    setWorkspacePage(button.dataset.overviewPage);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }));
}

function svgSeries(samples, selector, color, width = 760, height = 188, maximum = null, label = 'Value', suffix = '%') {
  const values = samples.map(selector).map(value => Number(value) || 0);
  if (values.length < 2) return '';
  const max = maximum ?? Math.max(...values, 1);
  const points = values.map((value, index) => `${14 + index / (values.length - 1) * (width - 28)},${height - 18 - value / max * (height - 36)}`);
  const fill = color === '#416ce4' ? 'rgba(65,108,228,.14)' : color === '#845bd4' ? 'rgba(132,91,212,.12)' : 'rgba(210,103,81,.14)';
  const markers = points.map((point, index) => { const [x, y] = point.split(','); const timestamp = new Date(samples[index].timestamp * 1000).toLocaleTimeString(); return `<circle class="trend-hit" cx="${x}" cy="${y}" r="7"><title>${escapeHtml(`${timestamp} · ${label}: ${values[index]}${suffix}`)}</title></circle>`; }).join('');
  const [lastX, lastY] = points.at(-1).split(',');
  return `<polygon points="14,${height - 18} ${points.join(' ')} ${width - 14},${height - 18}" fill="${fill}"/><polyline fill="none" stroke="${color}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" points="${points.join(' ')}"/>${markers}<circle class="trend-current" cx="${lastX}" cy="${lastY}" r="4" fill="${color}"><title>${escapeHtml(`Now · ${label}: ${values.at(-1)}${suffix}`)}</title></circle>`;
}

function trendInsight(samples, selector, label, suffix = '%') {
  const values = samples.map(selector).map(value => Number(value) || 0).slice(-6);
  const current = values.at(-1) || 0;
  const first = values[0] ?? current;
  const tolerance = suffix === '%' ? 2 : 1;
  const direction = current - first > tolerance ? 'Rising' : first - current > tolerance ? 'Falling' : 'Stable';
  return `<article class="trend-kpi"><span>${escapeHtml(label)}</span><strong>${suffix === '%' ? percent(current) : `${current} ${suffix}`}</strong><small class="${direction === 'Rising' ? 'rising' : direction === 'Falling' ? 'falling' : ''}">${direction} across recent readings</small></article>`;
}

function renderObservability(report) {
  observabilityData = report || observabilityData;
  const samples = report?.samples || [];
  document.querySelector('#trend-note').textContent = samples.length ? `${samples.length} live readings · last ${report.range_minutes} minutes` : 'Collecting live history';
  const ranges = [[15, '15m'], [60, '1h'], [360, '6h'], [1440, '24h']];
  const rangeControls = `<div class="trend-range-controls" aria-label="Trend time range">${ranges.map(([minutes, label]) => `<button type="button" data-trend-range="${minutes}" class="${observabilityMinutes === minutes ? 'active' : ''}">${label}</button>`).join('')}</div>`;
  const modeControls = `<div class="trend-mode-controls" aria-label="Trend metric group"><button type="button" data-trend-mode="capacity" class="${trendMode === 'capacity' ? 'active' : ''}">Capacity</button><button type="button" data-trend-mode="events" class="${trendMode === 'events' ? 'active' : ''}">Error events</button></div>`;
  const capacityView = trendMode === 'capacity';
  const eventMaximum = Math.max(...samples.map(item => Number(item.summary?.errors) || 0), 1);
  const trendLegend = capacityView ? '<div class="trend-legend"><span class="cpu">CPU usage</span><span class="memory">Memory usage</span><small>Percentage of container limits</small></div>' : `<div class="trend-legend"><span class="errors">Log errors</span><small>Events per observation · peak ${eventMaximum}</small></div>`;
  const trendLines = capacityView
    ? `${svgSeries(samples, item => item.summary.cpu, '#416ce4', 760, 188, 100, 'CPU', '%')}${svgSeries(samples, item => item.summary.memory, '#845bd4', 760, 188, 100, 'Memory', '%')}`
    : svgSeries(samples, item => item.summary.errors, '#d26751', 760, 188, eventMaximum, 'Errors', ' events');
  const trendSummary = capacityView ? 'Capacity view keeps CPU and memory on the same percentage scale.' : 'Event view isolates log-error volume so it is never confused with percentage metrics.';
  const trendKpis = capacityView
    ? `<div class="trend-kpis">${trendInsight(samples, item => item.summary.cpu, 'CPU now')}${trendInsight(samples, item => item.summary.memory, 'Memory now')}</div>`
    : `<div class="trend-kpis">${trendInsight(samples, item => item.summary.errors, 'Errors now', 'events')}</div>`;
  document.querySelector('#operations-trends').innerHTML = samples.length > 1
    ? `<div class="trend-toolbar">${modeControls}${rangeControls}</div>${trendLegend}${trendKpis}<div class="trend-canvas"><svg viewBox="0 0 760 188" preserveAspectRatio="none"><line class="trend-grid" x1="14" x2="746" y1="28" y2="28"/><line class="trend-grid" x1="14" x2="746" y1="94" y2="94"/><line class="trend-grid" x1="14" x2="746" y1="170" y2="170"/>${trendLines}</svg></div><div class="trend-axis"><span>${new Date(samples[0].timestamp * 1000).toLocaleTimeString()}</span><span>${capacityView ? '0–100%' : `0–${eventMaximum} events`}</span><span>Now</span></div><p class="trend-summary">${trendSummary}</p>`
    : `${modeControls}${rangeControls}<p class="empty">Collecting at least two live readings to draw operational trends.</p>`;
  document.querySelectorAll('[data-trend-range]').forEach(button => button.addEventListener('click', () => { observabilityMinutes = Number(button.dataset.trendRange); load(); }));
  document.querySelectorAll('[data-trend-mode]').forEach(button => button.addEventListener('click', () => { trendMode = button.dataset.trendMode; renderObservability(observabilityData); }));
  const slo = report?.slo || {};
  document.querySelector('#slo-health').innerHTML = `<div class="slo-score"><span class="${severityClass(slo.status || 'healthy')}">${escapeHtml(slo.status || 'healthy')}</span><strong>${Number(slo.availability_percent || 0).toFixed(1)}%</strong><p>Availability target: ${slo.target_percent || 99.5}%</p><div class="slo-meta"><span>${slo.error_pods || 0} error workloads</span><span>${slo.restart_events || 0} restart events</span></div><p>${escapeHtml(slo.note || '')}</p></div>`;
  const capacity = report?.capacity || [];
  document.querySelector('#capacity-ranking').innerHTML = capacity.length ? `<div class="capacity-list">${capacity.slice(0, 5).map(item => { const maximum = Math.max(item.cpu_percent, item.memory_percent, item.forecast_percent); const headroom = Math.max(0, 100 - item.forecast_percent); return `<button class="capacity-row" data-capacity-pod="${escapeHtml(item.pod)}"><div class="capacity-copy"><strong>${escapeHtml(item.pod)}</strong><div class="capacity-metrics"><span>CPU <b>${percent(item.cpu_percent)}</b></span><span>Memory <b>${percent(item.memory_percent)}</b></span><span>Forecast <b>${percent(item.forecast_percent)}</b></span><span>Headroom <b>${percent(headroom)}</b></span></div><div class="capacity-bar"><i style="width:${Math.min(100, maximum)}%"></i></div></div><span class="${severityClass(item.risk)}">${escapeHtml(item.risk)}</span></button>`; }).join('')}</div>` : '<p class="empty">No capacity readings are available.</p>';
  const highestForecast = capacity.reduce((highest, item) => !highest || Number(item.forecast_percent) > Number(highest.forecast_percent) ? item : highest, null);
  const averageForecast = capacity.length ? capacity.reduce((total, item) => total + Number(item.forecast_percent || 0), 0) / capacity.length : 0;
  const averageCpu = capacity.length ? capacity.reduce((total, item) => total + Number(item.cpu_percent || 0), 0) / capacity.length : 0;
  const averageMemory = capacity.length ? capacity.reduce((total, item) => total + Number(item.memory_percent || 0), 0) / capacity.length : 0;
  const lowestHeadroom = Math.max(0, 100 - highestForecast?.forecast_percent || 0);
  document.querySelector('#capacity-summary').innerHTML = highestForecast ? `<p class="eyebrow">QUICK SUMMARY</p><h3>Available capacity</h3><div class="capacity-visual"><div class="capacity-gauge" style="--gauge:${lowestHeadroom}%"><div><strong>${percent(lowestHeadroom)}</strong><span>available</span></div></div><div class="capacity-visual-copy"><strong>Most used workload</strong><p>Expected highest usage</p><b>${escapeHtml(highestForecast.pod)}</b></div></div><div class="capacity-profile"><div><span>CPU in use</span><b>${percent(averageCpu)}</b><i><em style="width:${Math.min(100, averageCpu)}%"></em></i></div><div><span>Memory in use</span><b>${percent(averageMemory)}</b><i><em style="width:${Math.min(100, averageMemory)}%"></em></i></div><div><span>Expected usage</span><b>${percent(averageForecast)}</b><i><em style="width:${Math.min(100, averageForecast)}%"></em></i></div></div><dl><div><dt>Highest expected use</dt><dd>${percent(highestForecast.forecast_percent)}</dd><small>${escapeHtml(highestForecast.pod)}</small></div><div><dt>Workloads checked</dt><dd>${capacity.length}</dd><small>live workloads</small></div></dl><p class="capacity-summary-note">Values refresh automatically with current monitoring data.</p>` : '<p class="empty">Capacity information appears when monitored workloads report resource usage.</p>';
  document.querySelectorAll('[data-capacity-pod]').forEach(button => button.addEventListener('click', () => openPodInvestigation(button.dataset.capacityPod)));
  document.querySelector('[data-capacity-prioritise]').onclick = () => {
    if (highestForecast?.pod) openPodInvestigation(highestForecast.pod);
  };
  const map = report?.service_map || { nodes: [], edges: [] };
  const mapOrder = { Frontend: 0, Backend: 1, Database: 2, 'AI runtime': 3, Workload: 4 };
  const orderedNodes = [...map.nodes].sort((left, right) => (mapOrder[left.kind] ?? 9) - (mapOrder[right.kind] ?? 9));
  document.querySelector('#service-map').innerHTML = orderedNodes.length ? orderedNodes.map(node => { const edge = map.edges.find(item => item.to === node.id); return `${edge ? `<span class="service-edge">→ ${escapeHtml(edge.label)}</span>` : ''}<button class="service-node" data-service-pod="${escapeHtml(node.id)}"><strong>${escapeHtml(node.label)}</strong><small>${escapeHtml(node.kind)} · ${escapeHtml(node.status)}</small></button>`; }).join('') : '<p class="empty">Service relationships appear after matching workloads are observed.</p>';
  document.querySelectorAll('[data-service-pod]').forEach(button => button.addEventListener('click', () => openPodInvestigation(button.dataset.servicePod)));
  const dependencies = report?.dependencies || [];
  document.querySelector('#dependencies').innerHTML = dependencies.length ? dependencies.map(item => `<button class="dependency-row" data-dependency-pod="${escapeHtml(item.name)}"><div><strong>${escapeHtml(item.name)}</strong><small>${escapeHtml(item.type)} · ${escapeHtml(item.detail)}</small></div><span class="${severityClass(item.status)}">${escapeHtml(item.status)}</span></button>`).join('') : '<p class="empty">No dependencies are currently inferred.</p>';
  const healthyDependencies = dependencies.filter(item => item.status === 'healthy').length;
  const attentionDependencies = dependencies.length - healthyDependencies;
  document.querySelector('#dependency-summary').innerHTML = `<p class="eyebrow">DEPENDENCY SUMMARY</p><h3>Connection status</h3><div><span>Connected services</span><strong>${dependencies.length}</strong></div><div><span>Healthy</span><strong>${healthyDependencies}</strong></div><div><span>Needs attention</span><strong>${attentionDependencies}</strong></div><p>${attentionDependencies ? 'Review the affected service and its related pod.' : 'All inferred service connections are healthy.'}</p>`;
  document.querySelectorAll('[data-dependency-pod]').forEach(button => button.addEventListener('click', () => openPodInvestigation(button.dataset.dependencyPod)));
  const events = report?.events || [];
  document.querySelector('#event-timeline').innerHTML = events.length ? events.slice(0, 8).map(event => `<button class="event-row" data-event-pod="${escapeHtml(event.pod || '')}"><div><span class="${severityClass(event.severity || 'warning')}">${escapeHtml(event.kind)}</span><strong>${escapeHtml(event.title)}</strong><p>${escapeHtml(event.detail || 'Live monitoring event')}</p></div><small>${new Date(event.timestamp * 1000).toLocaleTimeString()}</small></button>`).join('') : '<p class="empty">No workload changes, restart changes, or alert transitions in this selected range.</p>';
  document.querySelectorAll('[data-event-pod]').forEach(button => button.addEventListener('click', () => { if (button.dataset.eventPod) openPodInvestigation(button.dataset.eventPod); }));
}

function closeInvestigationDrawer() {
  investigationPodName = '';
  document.body.classList.remove('investigation-drawer-open');
  document.querySelector('#investigation-drawer').setAttribute('aria-hidden', 'true');
  document.querySelector('#investigation-backdrop').hidden = true;
}

function openInvestigationDetails(name) {
  closeInvestigationDrawer();
  window.history.replaceState(null, '', '#container-monitoring');
  setWorkspacePage('workloads');
  selectPod(name);
  document.querySelector('.detail-panel').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function renderInvestigationDrawer(name) {
  const pod = data?.pods?.find(item => item.name === name);
  if (!pod) return closeInvestigationDrawer();
  const analysis = data.analysis?.[name] || { severity: 'healthy', counts: { errors: 0, warnings: 0, oom_events: 0 }, findings: [] };
  const forecast = data.forecasts?.find(item => item.pod === name);
  const alerts = (data.alerts || []).filter(item => item.pod === name);
  const events = (observabilityData.events || []).filter(item => item.pod === name).slice(0, 3);
  const evidence = (data.incident_evidence || []).filter(item => item.pod === name).slice(0, 1);
  const deployment = (data.deployments || []).find(item => (item.resources || []).some(resource => resource.pod?.name === name));
  const health = pod.risk === 'critical' ? 'critical' : analysis.severity === 'warning' || pod.risk === 'warning' ? 'warning' : 'healthy';
  document.querySelector('#investigation-title').textContent = pod.name;
  document.querySelector('#investigation-subtitle').textContent = `${pod.namespace || 'default'} · ${pod.node || 'runtime'} · live workload context`;
  document.querySelector('#investigation-content').innerHTML = `
    <div class="investigation-state"><span class="${severityClass(health)}">${escapeHtml(pod.status)}</span><p>${escapeHtml(analysis.findings?.[0] || 'No critical pattern found in the live telemetry sample.')}</p></div>
    <section class="investigation-metrics"><article><span>Memory</span><strong>${pod.memory_mib} MiB</strong><small>${percent(pod.memory_percent)} of limit</small></article><article><span>CPU</span><strong>${percent(pod.cpu_percent)}</strong><small>${pod.cpu_millicores} millicores</small></article><article><span>Restarts</span><strong>${pod.restarts}</strong><small>since start</small></article><article><span>Log errors</span><strong>${analysis.counts.errors}</strong><small>${analysis.counts.warnings} warnings</small></article></section>
    <section class="investigation-section"><p class="eyebrow">RELATED WORKLOAD</p><strong>${escapeHtml(deployment?.name || 'No deployment mapping')}</strong><small>${escapeHtml(pod.image || 'Image unavailable')}</small></section>
    <section class="investigation-section"><p class="eyebrow">RECENT CHANGES</p>${events.length ? `<ul>${events.map(event => `<li><strong>${escapeHtml(event.title)}</strong><span>${escapeHtml(event.detail || 'Live monitoring event')}</span></li>`).join('')}</ul>` : '<p class="muted">No restart, deployment, or alert transition in the selected window.</p>'}</section>
    <section class="investigation-section"><p class="eyebrow">EVIDENCE</p><div class="investigation-evidence"><span>${alerts.length} active alert${alerts.length === 1 ? '' : 's'}</span><span>${evidence.length ? 'Pre-restart snapshot captured' : 'No captured incident snapshot'}</span><span>${forecast ? `${percent(forecast.forecast_percent ?? forecast.current_percent)} memory outlook` : 'No memory forecast yet'}</span></div></section>
    <div class="investigation-actions">${isDeveloperOrAdministrator() ? `<button type="button" class="primary" data-developer-workspace="${escapeHtml(name)}">Developer workspace</button>` : ''}<button type="button" data-investigation-details="${escapeHtml(name)}">Open full details</button>${isDeveloperOrAdministrator() ? `<button type="button" data-investigation-logs="${escapeHtml(name)}">Open logs</button>` : ''}<button type="button" data-investigation-alerts="${escapeHtml(name)}">View alerts</button></div>`;
  document.querySelector('[data-developer-workspace]')?.addEventListener('click', () => openDeveloperInvestigation(name));
  document.querySelector('[data-investigation-details]').addEventListener('click', () => openInvestigationDetails(name));
  document.querySelector('[data-investigation-logs]')?.addEventListener('click', () => {
    closeInvestigationDrawer(); logExplorerPodName = name; logExplorerLevel = 'all'; logExplorerSearch = ''; setWorkspacePage('logs'); renderLogExplorer(); document.querySelector('#log-explorer-panel').scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
  document.querySelector('[data-investigation-alerts]').addEventListener('click', () => {
    closeInvestigationDrawer(); window.history.replaceState(null, '', '#alert-center'); setWorkspacePage('alerts'); document.querySelector('#alert-center').scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
}

function openPodInvestigation(name) {
  if (!data?.pods?.some(pod => pod.name === name)) return;
  investigationPodName = name;
  selectPod(name);
  renderInvestigationDrawer(name);
  document.body.classList.add('investigation-drawer-open');
  document.querySelector('#investigation-drawer').setAttribute('aria-hidden', 'false');
  document.querySelector('#investigation-backdrop').hidden = false;
}

function ensureDeveloperInvestigationPage() {
  if (!document.querySelector('a[href="#developer-investigation"]')) {
    const link = document.createElement('a');
    link.href = '#developer-investigation'; link.innerHTML = '<span>⌕</span> Investigation';
    link.hidden = !isDeveloperOrAdministrator();
    document.querySelector('.workspace-nav a[href="#intelligence-center"]')?.before(link);
  }
  if (!document.querySelector('#developer-investigation')) {
    const panel = document.createElement('article');
    panel.id = 'developer-investigation'; panel.className = 'panel wide page-section page-investigation developer-investigation';
    panel.innerHTML = '<div class="empty">Loading available workloads and recent signals…</div>';
    document.querySelector('.layout')?.insertBefore(panel, document.querySelector('#intelligence-center'));
  }
}

function renderDeveloperInvestigationLanding() {
  const target = document.querySelector('#developer-investigation');
  if (!target) return;
  const pods = [...(data?.pods || [])].sort((left, right) => {
    const rank = { critical: 3, warning: 2, healthy: 1 };
    return (rank[right.risk] || 0) - (rank[left.risk] || 0) || Number(right.restarts || 0) - Number(left.restarts || 0) || left.name.localeCompare(right.name);
  });
  const groups = groupedErrorSignatures().slice(0, 5);
  const unhealthy = pods.filter(pod => pod.risk === 'critical' || pod.risk === 'warning' || pod.status !== 'Running');
  const restarts = pods.reduce((sum, pod) => sum + Number(pod.restarts || 0), 0);
  const logErrors = pods.reduce((sum, pod) => sum + Number(data?.analysis?.[pod.name]?.counts?.errors || 0), 0);
  target.innerHTML = `<header class="developer-investigation-hero investigation-landing-hero"><div><p class="eyebrow">DEVELOPER INVESTIGATION WORKSPACE</p><h2>Choose where to investigate</h2><p>Start from an application or pod. The workspace will automatically combine its deployment, logs, errors, URLs, restarts, release changes, and captured evidence.</p></div></header>
  <section class="developer-investigation-summary"><article><span>Available pods</span><strong>${pods.length}</strong><small>Live monitored workloads</small></article><article><span>Needs attention</span><strong>${unhealthy.length}</strong><small>Warning, critical, or not running</small></article><article><span>Restarts</span><strong>${restarts}</strong><small>Across monitored pods</small></article><article><span>Log errors</span><strong>${logErrors}</strong><small>${groups.length} grouped signatures</small></article></section>
  <div class="investigation-landing-grid"><section><div class="investigation-block-heading"><div><p class="eyebrow">APPLICATIONS & PODS</p><h3>Start an investigation</h3></div><span class="muted">Attention first</span></div>${pods.length ? `<div class="investigation-pod-picker">${pods.map(pod => { const analysis = data?.analysis?.[pod.name] || { counts: { errors: 0 } }; return `<button type="button" data-investigation-start="${escapeHtml(pod.name)}"><span class="${severityClass(pod.risk)}">${escapeHtml(pod.risk || pod.status)}</span><div><b>${escapeHtml(pod.name)}</b><small>${escapeHtml(pod.namespace || 'default')} · ${escapeHtml(pod.status)} · ${Number(pod.restarts || 0)} restarts</small></div><strong>${Number(analysis.counts?.errors || 0)} errors <i>→</i></strong></button>`; }).join('')}</div>` : '<p class="empty">No pods are available from the connected runtime yet.</p>'}</section>
  <section><div class="investigation-block-heading"><div><p class="eyebrow">RECENT SIGNALS</p><h3>Grouped error signatures</h3></div></div>${groups.length ? `<div class="workspace-error-groups">${groups.map(group => `<article><b>${escapeHtml(group.signature)}</b><p>${group.count} occurrence${group.count === 1 ? '' : 's'} · ${group.pods.size} pod${group.pods.size === 1 ? '' : 's'}</p><small>${escapeHtml([...group.pods].join(', '))}</small><button type="button" data-investigation-start="${escapeHtml(group.examplePod)}">Investigate matching pod</button></article>`).join('')}</div>` : '<p class="empty">No grouped error or warning signatures are currently present.</p>'}</section></div>`;
  target.querySelectorAll('[data-investigation-start]').forEach(button => button.addEventListener('click', () => openDeveloperInvestigation(button.dataset.investigationStart)));
}

function investigationShareUrl(workspaceId) {
  const url = new URL(window.location.href);
  url.searchParams.set('investigation', workspaceId);
  url.hash = 'developer-investigation';
  return url.toString();
}

function sourceCodeContext(image, signature = '') {
  const source = data?.source_context || {};
  const repository = String(source.repository_url || '').replace(/\.git$/, '').replace(/\/$/, '');
  if (!/^https?:\/\//i.test(repository)) return null;
  const imageCommit = String(image || '').match(/(?:^|[:@-])([a-f0-9]{7,40})(?:$|\b)/i)?.[1];
  const ref = source.commit_sha || imageCommit || source.default_branch || 'main';
  const location = String(signature).match(/(?:^|\s|\()([\w./-]+\.(?:py|js|jsx|ts|tsx|java|go|cs|rb|php|kt|scala|cpp|c|h))(?::|\s+line\s+)(\d+)/i);
  const file = location?.[1] || source.source_path || '';
  const line = location?.[2] || '';
  const providerPath = /bitbucket\.org/i.test(repository) ? 'src' : 'blob';
  const url = file ? `${repository}/${providerPath}/${encodeURIComponent(ref)}/${file.split('/').map(encodeURIComponent).join('/')}${line ? `#L${line}` : ''}` : `${repository}/tree/${encodeURIComponent(ref)}`;
  return { repository, ref, file, line, url, exact: Boolean(location), origin: source.commit_sha ? 'configured' : imageCommit ? 'image' : 'branch' };
}

function incidentReplayEvents(pod, deployment, relatedPods, groups, urls, captures) {
  const relatedNames = new Set(relatedPods.map(item => item.name));
  const events = (observabilityData.events || []).filter(item => relatedNames.has(item.pod) || item.pod === deployment?.name || item.workload === deployment?.name).map(item => ({ timestamp: Number(item.timestamp) * 1000, kind: item.kind || 'event', severity: item.severity || 'healthy', title: item.title || 'Operational event', detail: item.detail || '', source: item.pod || deployment?.name || pod.name }));
  const deploymentEvents = (correlationIntelligence?.deployment_comparisons || []).filter(item => item.workload === deployment?.name).map(item => ({ timestamp: Number(item.changed_at) * 1000, kind: 'deployment', severity: item.status === 'regressed' ? 'critical' : 'healthy', title: item.status === 'regressed' ? 'Release regression detected' : 'Release observed', detail: `${item.previous_image || 'No baseline'} → ${item.current_image || 'Unknown image'}`, source: item.workload }));
  const errorEvents = groups.map(group => ({ timestamp: Date.parse(group.first || group.last || '') || Date.now(), kind: 'log', severity: group.levels.has('critical') || group.levels.has('error') ? 'critical' : 'warning', title: 'First matching error signature', detail: `${group.signature} · ${group.count} occurrence${group.count === 1 ? '' : 's'}`, source: [...group.pods][0] || pod.name }));
  const urlEvents = urls.filter(item => item.checked_at).map(item => ({ timestamp: Date.parse(item.checked_at), kind: 'url', severity: ['down', 'degraded'].includes(item.status) ? 'critical' : 'healthy', title: `URL check ${item.status}`, detail: `${item.url} · ${item.status_code ? `HTTP ${item.status_code}` : item.error || 'No response'}`, source: `${item.environment?.toUpperCase() || 'ENV'} · ${item.name}` }));
  const evidenceEvents = captures.map(item => ({ timestamp: Date.parse(item.created_at || item.captured_at || item.timestamp || '') || Date.now(), kind: 'evidence', severity: 'warning', title: 'Incident evidence captured', detail: item.reason || item.summary || 'Pre-incident log evidence preserved', source: item.pod || pod.name }));
  const current = { timestamp: Date.now(), kind: 'current', severity: pod.risk || 'healthy', title: pod.risk === 'healthy' ? 'Current state is healthy' : `Current state needs ${pod.risk} attention`, detail: `${pod.status} · ${pod.restarts || 0} restarts · image ${deployment?.image || pod.image || 'unavailable'}`, source: pod.name };
  const combined = [...events, ...deploymentEvents, ...errorEvents, ...urlEvents, ...evidenceEvents, current].filter(item => Number.isFinite(item.timestamp));
  const unique = new Map(combined.map(item => [`${item.timestamp}|${item.kind}|${item.title}|${item.source}`, item]));
  return [...unique.values()].sort((left, right) => left.timestamp - right.timestamp).slice(-40);
}

async function restoreSharedInvestigation() {
  const workspaceId = new URL(window.location.href).searchParams.get('investigation');
  if (!workspaceId || sharedInvestigationRestored) return;
  sharedInvestigationRestored = true;
  try {
    const response = await fetch(`/api/incident-workspaces/${encodeURIComponent(workspaceId)}`);
    if (!response.ok) return;
    const workspace = (await response.json()).workspace;
    if (workspace?.pod && data?.pods?.some(pod => pod.name === workspace.pod)) {
      developerInvestigationWorkspace = workspace;
      developerInvestigationPod = workspace.pod;
    }
  } catch { /* The landing page remains available if a shared record expired. */ }
}

async function openDeveloperInvestigation(podName) {
  if (!data?.pods?.some(pod => pod.name === podName)) return;
  if (developerInvestigationPod !== podName) incidentReplayIndex = -1;
  if (incidentReplayTimer) { clearInterval(incidentReplayTimer); incidentReplayTimer = null; }
  developerInvestigationPod = podName;
  try {
    const response = await fetch('/api/incident-workspaces');
    const payload = await response.json();
    const existing = (payload.workspaces || []).find(item => item.pod === podName && item.status !== 'resolved');
    if (existing) developerInvestigationWorkspace = existing;
    else {
      const pod = data.pods.find(item => item.name === podName);
      const created = await fetch('/api/incident-workspaces', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: `${podName} investigation`, note: '', pod: podName, severity: pod.risk === 'critical' ? 'critical' : 'warning' }) });
      if (created.ok) developerInvestigationWorkspace = (await created.json()).workspace;
    }
  } catch { developerInvestigationWorkspace = null; }
  closeInvestigationDrawer();
  const destination = developerInvestigationWorkspace?.id ? investigationShareUrl(developerInvestigationWorkspace.id) : '#developer-investigation';
  window.history.replaceState(null, '', destination);
  setWorkspacePage('investigation');
  renderDeveloperInvestigation();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function renderDeveloperInvestigation() {
  const target = document.querySelector('#developer-investigation');
  const pod = data?.pods?.find(item => item.name === developerInvestigationPod);
  if (!target) return;
  if (!pod) { renderDeveloperInvestigationLanding(); return; }
  const deployment = (data.deployments || []).find(item => (item.resources || []).some(resource => resource.pod?.name === pod.name));
  const relatedPods = deployment?.resources?.map(resource => resource.pod).filter(Boolean) || [pod];
  const relatedNames = new Set(relatedPods.map(item => item.name));
  const analysis = data.analysis?.[pod.name] || { severity: 'healthy', counts: { errors: 0, warnings: 0, oom_events: 0 }, findings: [] };
  const groups = groupedErrorSignatures().filter(group => [...group.pods].some(name => relatedNames.has(name))).slice(0, 6);
  const events = (observabilityData.events || []).filter(item => relatedNames.has(item.pod) || item.pod === deployment?.name).slice(0, 10);
  const comparison = (correlationIntelligence?.deployment_comparisons || []).find(item => item.workload === deployment?.name);
  const urls = urlMonitors.filter(item => { const text = `${item.name} ${item.url}`.toLowerCase(); return String(deployment?.name || pod.name).toLowerCase().split(/[-_.]/).filter(term => term.length > 3).some(term => text.includes(term)); });
  const captures = (data.incident_evidence || []).filter(item => relatedNames.has(item.pod));
  const workspace = developerInvestigationWorkspace;
  const status = workspace?.status || 'open';
  const image = deployment?.image || pod.image || '';
  const source = sourceCodeContext(image);
  const replay = incidentReplayEvents(pod, deployment, relatedPods, groups, urls, captures);
  if (incidentReplayIndex < 0 || incidentReplayIndex >= replay.length) incidentReplayIndex = Math.max(0, replay.length - 1);
  const replayActive = replay[incidentReplayIndex];
  target.innerHTML = `<header class="developer-investigation-hero"><div><p class="eyebrow">DEVELOPER INVESTIGATION WORKSPACE</p><h2>${escapeHtml(deployment?.name || pod.name)}</h2><p>${escapeHtml(pod.namespace || 'default')} · ${relatedPods.length} scoped pod${relatedPods.length === 1 ? '' : 's'} · opened ${workspace?.created_at ? new Date(workspace.created_at).toLocaleString() : 'for this session'}</p></div><div class="investigation-header-controls"><label class="investigation-pod-control">Investigating<select id="developer-investigation-pod-switch">${(data.pods || []).map(item => `<option value="${escapeHtml(item.name)}" ${item.name === pod.name ? 'selected' : ''}>${escapeHtml(item.name)}</option>`).join('')}</select></label><div class="investigation-control-group"><button type="button" class="all-pods-control" data-developer-all-pods><span>←</span> All pods</button><div class="investigation-health-control"><small>Health</small><span class="status ${pod.risk}">${escapeHtml(pod.risk)}</span></div><label>Investigation status<select id="developer-investigation-status"><option value="open" ${status === 'open' ? 'selected' : ''}>Open</option><option value="monitoring" ${status === 'monitoring' ? 'selected' : ''}>Monitoring</option><option value="resolved" ${status === 'resolved' ? 'selected' : ''}>Resolved</option></select></label></div></div></header>
  <section class="developer-investigation-summary"><article><span>Readiness</span><strong>${deployment ? `${deployment.available}/${deployment.desired}` : pod.status}</strong><small>${escapeHtml(deployment?.status || 'Runtime state')}</small></article><article><span>Restarts</span><strong>${relatedPods.reduce((sum,item)=>sum+Number(item.restarts||0),0)}</strong><small>Across scoped pods</small></article><article><span>Log signals</span><strong>${relatedPods.reduce((sum,item)=>sum+Number(data.analysis?.[item.name]?.counts?.errors||0),0)}</strong><small>${groups.length} grouped signatures</small></article><article><span>URL impact</span><strong>${urls.filter(item=>['down','degraded'].includes(item.status)).length}</strong><small>${urls.length} related endpoint${urls.length===1?'':'s'}</small></article></section>
  <div class="developer-investigation-grid"><section><div class="investigation-block-heading"><div><p class="eyebrow">PROBLEM & SCOPE</p><h3>Current operational assessment</h3></div></div><p class="investigation-assessment">${escapeHtml(analysis.findings?.[0] || 'No critical pattern is present in the latest sample.')}</p><dl class="investigation-metadata"><div><dt>Selected pod</dt><dd>${escapeHtml(pod.name)}</dd></div><div><dt>Image</dt><dd>${escapeHtml(deployment?.image || pod.image || 'Unavailable')}</dd></div><div><dt>Environment</dt><dd>${escapeHtml(urls[0]?.environment?.toUpperCase() || pod.namespace || 'Not mapped')}</dd></div><div><dt>Captured evidence</dt><dd>${captures.length}</dd></div></dl><div class="scoped-pods">${relatedPods.map(item=>`<button data-developer-pod="${escapeHtml(item.name)}"><span class="${severityClass(item.risk)}">${escapeHtml(item.status)}</span><b>${escapeHtml(item.name)}</b><small>${item.restarts} restart${item.restarts===1?'':'s'}</small></button>`).join('')}</div></section>
  <section><div class="investigation-block-heading"><div><p class="eyebrow">GROUPED ERRORS</p><h3>Repeated signatures</h3></div><button data-developer-open-logs>Open pod logs</button></div>${groups.length?`<div class="workspace-error-groups">${groups.map(group=>{const location=sourceCodeContext(image,group.signature);return `<article><b>${escapeHtml(group.signature)}</b><p>${group.count} occurrences · ${group.pods.size} pods</p><small>${escapeHtml([...group.pods].join(', '))}</small>${location?.exact?`<a class="error-source-link" href="${escapeHtml(location.url)}" target="_blank" rel="noopener noreferrer">Open ${escapeHtml(location.file)}:${escapeHtml(location.line)} ↗</a>`:''}</article>`;}).join('')}</div>`:'<p class="empty">No error or warning signature in the available scoped logs.</p>'}</section>
  <section><div class="investigation-block-heading"><div><p class="eyebrow">INCIDENT TIMELINE</p><h3>Changes and evidence</h3></div></div>${events.length?`<ol class="workspace-timeline">${events.map(item=>`<li><i></i><div><b>${escapeHtml(item.title)}</b><p>${escapeHtml(item.detail||'Operational event')}</p><small>${new Date(Number(item.timestamp)*1000).toLocaleString()}</small></div></li>`).join('')}</ol>`:'<p class="empty">No related transition in the selected history window.</p>'}</section>
  <section><div class="investigation-block-heading"><div><p class="eyebrow">RELEASE IMPACT</p><h3>Before / after deployment</h3></div></div>${comparison?`<div class="workspace-release ${comparison.status}"><span>${escapeHtml(comparison.status)}</span><code>${escapeHtml(comparison.previous_image||'No baseline')}</code><i>→</i><code>${escapeHtml(comparison.current_image||'Unavailable')}</code><p>${comparison.deltas?`Errors ${comparison.deltas.errors>=0?'+':''}${comparison.deltas.errors}; restarts ${comparison.deltas.restarts>=0?'+':''}${comparison.deltas.restarts}; readiness ${comparison.deltas.ready_percent>=0?'+':''}${comparison.deltas.ready_percent}%`:'Collecting enough baseline data for comparison.'}</p></div>`:'<p class="empty">No matching release comparison is available yet.</p>'}</section></div>
  <section class="incident-replay"><header><div><p class="eyebrow">INCIDENT REPLAY</p><h3>See the incident unfold</h3><p>Deployment, runtime, log, alert, URL, and recovery evidence in one ordered sequence.</p></div><div class="incident-replay-controls"><button type="button" data-replay-previous ${incidentReplayIndex === 0 ? 'disabled' : ''}>← Previous</button><button type="button" class="primary" data-replay-play ${replay.length < 2 ? 'disabled' : ''}>${incidentReplayTimer ? 'Pause replay' : '▶ Replay'}</button><button type="button" data-replay-next ${incidentReplayIndex >= replay.length - 1 ? 'disabled' : ''}>Next →</button></div></header>${replay.length ? `<div class="incident-replay-stage"><div class="replay-rail">${replay.map((item,index)=>`<button type="button" class="${index === incidentReplayIndex ? 'active' : ''} ${escapeHtml(item.severity)}" data-replay-step="${index}" title="${escapeHtml(item.title)}"><i></i><span>${new Date(item.timestamp).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'})}</span></button>`).join('')}</div><article class="replay-active ${escapeHtml(replayActive.severity)}"><div class="replay-kind"><span>${escapeHtml(replayActive.kind)}</span><time>${new Date(replayActive.timestamp).toLocaleString()}</time></div><h4>${escapeHtml(replayActive.title)}</h4><p>${escapeHtml(replayActive.detail)}</p><small>${escapeHtml(replayActive.source)}</small><b>Step ${incidentReplayIndex + 1} of ${replay.length}</b></article></div>` : '<p class="empty">No timestamped evidence is available for replay yet.</p>'}</section>
  <section class="investigation-links"><div><p class="eyebrow">COLLABORATION</p><h3>Share and continue in code</h3><p>Share this exact saved investigation or open the source version associated with the deployed image.</p></div><div class="investigation-link-actions">${workspace ? '<button type="button" data-developer-share>Copy investigation link</button>' : '<button type="button" disabled>Save to enable sharing</button>'}${source ? `<a href="${escapeHtml(source.url)}" target="_blank" rel="noopener noreferrer">Open source at ${escapeHtml(String(source.ref).slice(0, 12))} ↗</a><small>${source.origin === 'configured' ? 'Configured deployed commit' : source.origin === 'image' ? 'Commit inferred from image tag' : 'Default branch—deployed commit unavailable'}</small>` : '<span class="source-link-unavailable"><b>Source-code link not configured</b><small>Set SOURCE_REPOSITORY_URL and, preferably, SOURCE_COMMIT_SHA.</small></span>'}</div></section>
  <section class="investigation-notes"><div><p class="eyebrow">INVESTIGATION RECORD</p><h3>Developer notes and decision</h3></div><textarea id="developer-investigation-note" maxlength="1000" placeholder="Observation, impact, decision, owner, or next step">${escapeHtml(workspace?.note||'')}</textarea><div><button data-developer-save-note>Save investigation</button><button data-developer-export>Export evidence JSON</button></div></section>`;
  target.querySelectorAll('[data-developer-pod]').forEach(button=>button.addEventListener('click',()=>{developerInvestigationPod=button.dataset.developerPod;renderDeveloperInvestigation();}));
  target.querySelector('#developer-investigation-pod-switch').addEventListener('change', event => openDeveloperInvestigation(event.target.value));
  target.querySelector('[data-developer-all-pods]').addEventListener('click', () => { developerInvestigationPod = null; developerInvestigationWorkspace = null; incidentReplayIndex = -1; if (incidentReplayTimer) { clearInterval(incidentReplayTimer); incidentReplayTimer = null; } const url = new URL(window.location.href); url.searchParams.delete('investigation'); url.hash = 'developer-investigation'; window.history.replaceState(null, '', url); renderDeveloperInvestigationLanding(); });
  target.querySelector('[data-developer-share]')?.addEventListener('click', async event => { const link = investigationShareUrl(workspace.id); try { await navigator.clipboard.writeText(link); event.target.textContent = 'Link copied'; } catch { window.prompt('Copy investigation link', link); } });
  target.querySelectorAll('[data-replay-step]').forEach(button => button.addEventListener('click', () => { incidentReplayIndex = Number(button.dataset.replayStep); if (incidentReplayTimer) { clearInterval(incidentReplayTimer); incidentReplayTimer = null; } renderDeveloperInvestigation(); }));
  target.querySelector('[data-replay-previous]')?.addEventListener('click', () => { incidentReplayIndex = Math.max(0, incidentReplayIndex - 1); renderDeveloperInvestigation(); });
  target.querySelector('[data-replay-next]')?.addEventListener('click', () => { incidentReplayIndex = Math.min(replay.length - 1, incidentReplayIndex + 1); renderDeveloperInvestigation(); });
  target.querySelector('[data-replay-play]')?.addEventListener('click', () => { if (incidentReplayTimer) { clearInterval(incidentReplayTimer); incidentReplayTimer = null; renderDeveloperInvestigation(); return; } incidentReplayIndex = 0; incidentReplayTimer = setInterval(() => { if (incidentReplayIndex >= replay.length - 1) { clearInterval(incidentReplayTimer); incidentReplayTimer = null; renderDeveloperInvestigation(); return; } incidentReplayIndex += 1; renderDeveloperInvestigation(); }, 1400); renderDeveloperInvestigation(); });
  target.querySelector('[data-developer-open-logs]').addEventListener('click',()=>{logExplorerPodName=developerInvestigationPod;logExplorerSelectedIndex=undefined;window.history.replaceState(null,'','#log-explorer-panel');setWorkspacePage('logs');renderLogExplorer();window.scrollTo({top:0,behavior:'smooth'});} );
  target.querySelector('[data-developer-save-note]').addEventListener('click',async()=>{if(!workspace)return;const response=await fetch(`/api/incident-workspaces/${encodeURIComponent(workspace.id)}`,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({status:target.querySelector('#developer-investigation-status').value,note:target.querySelector('#developer-investigation-note').value})});if(response.ok){developerInvestigationWorkspace=(await response.json()).workspace;renderDeveloperInvestigation();}});
  target.querySelector('[data-developer-export]').addEventListener('click',()=>{const evidence={exported_at:new Date().toISOString(),workspace,pod,deployment,related_pods:relatedPods,analysis,error_groups:groups.map(group=>({...group,pods:[...group.pods],levels:[...group.levels]})),events,comparison,urls,captured_evidence:captures};const link=Object.assign(document.createElement('a'),{href:URL.createObjectURL(new Blob([JSON.stringify(evidence,null,2)],{type:'application/json'})),download:`${deployment?.name||pod.name}-investigation.json`});link.click();URL.revokeObjectURL(link.href);});
}

function renderIncidentWorkspaces() {
  const target = document.querySelector('#incident-workspace-list');
  const selected = selectedPodName || '';
  target.innerHTML = `<form id="incident-composer" class="incident-composer"><input id="incident-title" required maxlength="120" placeholder="Investigation title"><textarea id="incident-note" maxlength="1000" placeholder="Observation, impact, decision, or next step"></textarea><select id="incident-severity"><option value="warning">Warning</option><option value="critical">Critical</option><option value="healthy">Informational</option></select><button>Save investigation</button></form><div class="incident-workspaces">${incidentWorkspaces.length ? incidentWorkspaces.map(item => `<article class="incident-card ${escapeHtml(item.status)}"><div><span class="${severityClass(item.severity)}">${escapeHtml(item.severity)}</span> <strong>${escapeHtml(item.title)}</strong><small>${escapeHtml(item.pod || 'Cluster-wide')} · ${escapeHtml(item.status)} · ${new Date(item.updated_at).toLocaleString()}</small><p>${escapeHtml(item.note || 'No note added.')}</p></div><div class="incident-card-actions"><select data-workspace-status="${escapeHtml(item.id)}"><option value="open" ${item.status === 'open' ? 'selected' : ''}>Open</option><option value="monitoring" ${item.status === 'monitoring' ? 'selected' : ''}>Monitoring</option><option value="resolved" ${item.status === 'resolved' ? 'selected' : ''}>Resolved</option></select><button data-workspace-save="${escapeHtml(item.id)}">Update</button></div></article>`).join('') : '<p class="empty">No saved investigations. Save one to keep the operational context locally.</p>'}</div>`;
  target.querySelector('#incident-composer').addEventListener('submit', event => { event.preventDefault(); saveIncidentWorkspace({ title: target.querySelector('#incident-title').value.trim(), note: target.querySelector('#incident-note').value.trim(), severity: target.querySelector('#incident-severity').value, pod: selected || null }); });
  target.querySelectorAll('[data-workspace-save]').forEach(button => button.addEventListener('click', () => updateIncidentWorkspace(button.dataset.workspaceSave, { status: target.querySelector(`[data-workspace-status="${CSS.escape(button.dataset.workspaceSave)}"]`).value, note: incidentWorkspaces.find(item => item.id === button.dataset.workspaceSave)?.note || '' })));
}

async function loadIncidentWorkspaces() {
  try { const response = await fetch('/api/incident-workspaces'); const payload = await response.json(); if (response.ok) incidentWorkspaces = payload.workspaces || []; } catch { /* Local workspaces remain optional. */ }
  renderIncidentWorkspaces();
}

async function saveIncidentWorkspace(payload) {
  if (!payload.title) return;
  const response = await fetch('/api/incident-workspaces', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
  if (response.ok) await loadIncidentWorkspaces();
}

async function updateIncidentWorkspace(id, payload) {
  const response = await fetch(`/api/incident-workspaces/${encodeURIComponent(id)}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
  if (response.ok) await loadIncidentWorkspaces();
}

function exportDashboard() {
  const content = JSON.stringify({ exported_at: new Date().toISOString(), overview: data, observability: observabilityData }, null, 2);
  const url = URL.createObjectURL(new Blob([content], { type: 'application/json' }));
  const link = Object.assign(document.createElement('a'), { href: url, download: `pulseops-report-${new Date().toISOString().slice(0, 10)}.json` });
  link.click(); URL.revokeObjectURL(url);
}

function renderWorkloads(inventory) {
  const target = document.querySelector('#workloads');
  const workloads = inventory?.workloads || [];
  const ready = workloads.filter(item => item.status === 'Ready' || item.status === 'Completed').length;
  const attention = workloads.filter(item => item.status !== 'Ready' && item.status !== 'Completed').length;
  const exposed = workloads.filter(item => item.exposed).length;
  document.querySelector('#workload-health-content').innerHTML = workloads.length ? `<div class="workload-health-metric"><span>Deployments</span><strong>${workloads.length}</strong><small>monitored workloads</small></div><div class="workload-health-metric"><span>Healthy / completed</span><strong>${ready}</strong><small>ready workloads and finished jobs</small></div><div class="workload-health-metric"><span>Needs attention</span><strong>${attention}</strong><small>not ready workloads</small></div><div class="workload-health-metric"><span>Exposed services</span><strong>${exposed}</strong><small>externally reachable</small></div>` : '<p class="empty">Deployment health appears when workload inventory is connected.</p>';
  const query = deploymentSearch.trim().toLowerCase();
  const healthRank = item => item.status === 'Ready' || item.status === 'Completed' ? 0 : 1;
  const matching = workloads.filter(item => (!query || `${item.name} ${item.type} ${item.image}`.toLowerCase().includes(query)) && (deploymentFilter === 'all' || deploymentFilter === 'attention' && item.status !== 'Ready' && item.status !== 'Completed' || deploymentFilter === 'ready' && item.status === 'Ready' || deploymentFilter === 'exposed' && item.exposed || deploymentFilter === 'completed' && item.status === 'Completed')).sort((left, right) => deploymentSort === 'name' ? left.name.localeCompare(right.name) : healthRank(right) - healthRank(left) || left.name.localeCompare(right.name));
  const pages = Math.max(1, Math.ceil(matching.length / deploymentPageSize));
  deploymentPage = Math.min(deploymentPage, pages);
  const start = (deploymentPage - 1) * deploymentPageSize;
  const visible = matching.slice(start, start + deploymentPageSize);
  const views = savedWorkloadViews();
  document.querySelector('#deployment-list-controls').innerHTML = `<div class="inventory-filters"><label>Find deployment <input id="deployment-search" value="${escapeHtml(deploymentSearch)}" placeholder="Name, type, or image"></label><button type="button" data-deployment-search>Search</button><label>Show <select id="deployment-filter"><option value="all" ${deploymentFilter === 'all' ? 'selected' : ''}>All deployments</option><option value="attention" ${deploymentFilter === 'attention' ? 'selected' : ''}>Needs attention</option><option value="ready" ${deploymentFilter === 'ready' ? 'selected' : ''}>Ready</option><option value="exposed" ${deploymentFilter === 'exposed' ? 'selected' : ''}>Exposed</option><option value="completed" ${deploymentFilter === 'completed' ? 'selected' : ''}>Completed</option></select></label><label>Order <select id="deployment-sort"><option value="attention" ${deploymentSort === 'attention' ? 'selected' : ''}>Needs attention first</option><option value="name" ${deploymentSort === 'name' ? 'selected' : ''}>Name A–Z</option></select></label><label>Saved view <select id="deployment-view"><option value="">Choose a view</option>${views.map((view, index) => `<option value="${index}">${escapeHtml(view.name)}</option>`).join('')}</select></label><button type="button" data-deployment-view-save>Save view</button></div><div class="inventory-pagination"><span>${matching.length ? `Showing ${start + 1}–${Math.min(start + deploymentPageSize, matching.length)} of ${matching.length}` : 'No matching deployments'} · ${workloads.length} total</span><label>Rows <select id="deployment-page-size"><option value="25" ${deploymentPageSize === 25 ? 'selected' : ''}>25</option><option value="50" ${deploymentPageSize === 50 ? 'selected' : ''}>50</option><option value="100" ${deploymentPageSize === 100 ? 'selected' : ''}>100</option></select></label><button type="button" data-deployment-prev ${deploymentPage === 1 ? 'disabled' : ''}>Previous</button><span>Page ${deploymentPage} of ${pages}</span><button type="button" data-deployment-next ${deploymentPage === pages ? 'disabled' : ''}>Next</button></div>`;
  const changed = new Set((observabilityData.events || []).filter(event => event.kind === 'deployment').map(event => event.pod));
  target.innerHTML = visible.length ? visible.map(workload => `<tr><td><button class="deployment-link" data-deployment-open="${escapeHtml(workload.name)}">${escapeHtml(workload.name)}<small>${changed.has(workload.name) ? 'Changed recently · inspect →' : 'Inspect resources →'}</small></button></td><td>${escapeHtml(workload.type)}</td><td>${workload.status === 'Completed' ? 'Completed' : `${workload.available}/${workload.desired} available`}</td><td><small>${escapeHtml(workload.image || 'Not available')}</small></td><td>${workload.exposed ? 'Exposed' : 'Internal'}</td><td><span class="${severityClass(workload.status === 'Ready' || workload.status === 'Completed' ? 'healthy' : 'warning')}">${escapeHtml(workload.status)}</span></td></tr>`).join('') : '<tr><td colspan="6" class="empty">No deployments match the selected filter.</td></tr>';
  document.querySelectorAll('[data-deployment-open]').forEach(button => button.addEventListener('click', () => { selectedDeploymentName = button.dataset.deploymentOpen; selectedDeploymentResource = undefined; renderDeploymentInspector(data.deployments || []); document.querySelector('#deployment-inspector').scrollIntoView({ behavior: 'smooth', block: 'start' }); }));
  document.querySelector('[data-deployment-search]').addEventListener('click', () => { deploymentSearch = document.querySelector('#deployment-search').value; deploymentPage = 1; renderWorkloads(inventory); });
  // Keep the draft through the automatic telemetry refresh; filtering still
  // happens only when Search or Enter is used, so typing never redraws the field.
  document.querySelector('#deployment-search').addEventListener('input', event => { deploymentSearch = event.target.value; });
  document.querySelector('#deployment-search').addEventListener('keypress', event => { if (event.key === 'Enter') document.querySelector('[data-deployment-search]').click(); });
  document.querySelector('#deployment-filter').addEventListener('change', event => { deploymentFilter = event.target.value; deploymentPage = 1; renderWorkloads(inventory); });
  document.querySelector('#deployment-sort').addEventListener('change', event => { deploymentSort = event.target.value; deploymentPage = 1; renderWorkloads(inventory); });
  document.querySelector('#deployment-view').addEventListener('change', event => { const view = views[Number(event.target.value)]; if (!view) return; deploymentFilter = view.filter || 'all'; deploymentSort = view.sort || 'attention'; deploymentPageSize = Number(view.page_size) || 25; deploymentPage = 1; renderWorkloads(inventory); });
  document.querySelector('[data-deployment-view-save]').addEventListener('click', saveWorkloadView);
  document.querySelector('#deployment-page-size').addEventListener('change', event => { deploymentPageSize = Number(event.target.value); deploymentPage = 1; renderWorkloads(inventory); });
  document.querySelector('[data-deployment-prev]').addEventListener('click', () => { deploymentPage -= 1; renderWorkloads(inventory); });
  document.querySelector('[data-deployment-next]').addEventListener('click', () => { deploymentPage += 1; renderWorkloads(inventory); });
}

function deploymentMemoryChart(history) {
  if ((history || []).length < 2) return '<p class="chart-empty">Collecting Prometheus memory history for this deployment…</p>';
  const width = 640, height = 150, pad = 12;
  const values = history.map(item => item.memory_mib);
  const maximum = Math.max(...values, 1);
  const points = history.map((item, index) => `${pad + index / (history.length - 1) * (width - pad * 2)},${height - pad - item.memory_mib / maximum * (height - pad * 2)}`).join(' ');
  return `<div class="deployment-memory-chart"><div class="timeline-heading"><span>Aggregate memory history</span><small>All resources in this deployment</small></div><svg viewBox="0 0 ${width} ${height}" preserveAspectRatio="none"><line x1="${pad}" y1="${height - pad}" x2="${width - pad}" y2="${height - pad}" class="chart-axis"/><polyline points="${points}" fill="none" stroke="#6d62d9" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg><div class="chart-range"><span>${values[0].toFixed(1)} MiB</span><span>${values.at(-1).toFixed(1)} MiB now</span></div></div>`;
}

function renderDeploymentInspector(deployments) {
  const target = document.querySelector('#deployment-inspector-content');
  if (!deployments.length) { target.innerHTML = '<p class="empty">Deployment resource data is unavailable until live workload inventory is connected.</p>'; return; }
  const selected = deployments.find(item => item.name === selectedDeploymentName) || deployments.find(item => item.status !== 'Completed') || deployments[0];
  selectedDeploymentName = selected.name;
  const resources = selected.resources || [];
  const resource = resources.find(item => item.pod.name === selectedDeploymentResource) || resources[0];
  selectedDeploymentResource = resource?.pod.name;
  const summary = selected.summary || {};
  const changes = (observabilityData.deployment_changes || []).filter(event => event.pod === selected.name).slice(0, 5);
  const memoryPercent = summary.memory_limit_mib ? Math.min(100, summary.memory_mib / summary.memory_limit_mib * 100) : 0;
  const changeHtml = changes.length ? changes.map(event => `<li><strong>${escapeHtml(event.title)}</strong><small>${new Date(event.timestamp * 1000).toLocaleString()} · ${escapeHtml(event.detail || '')}</small></li>`).join('') : '<li><strong>No recent deployment change</strong><small>No image or readiness change was recorded in the selected observation window.</small></li>';
  target.innerHTML = `<div class="deployment-selector">${deployments.map(item => `<button class="${item.name === selected.name ? 'active' : ''}" data-deployment-select="${escapeHtml(item.name)}">${escapeHtml(item.name)}<small>${item.available}/${item.desired} ready</small></button>`).join('')}</div><div class="deployment-summary-grid"><div class="deployment-overview"><span class="${severityClass(selected.status === 'Ready' || selected.status === 'Completed' ? 'healthy' : 'warning')}">${escapeHtml(selected.status)}</span><h3>${escapeHtml(selected.name)}</h3><p>${escapeHtml(selected.type)} · ${escapeHtml(selected.image)}</p><div class="deployment-stat-grid"><span><b>${selected.available}/${selected.desired}</b> ready</span><span><b>${summary.resource_count}</b> resources</span><span><b>${summary.restarts}</b> restarts</span><span><b>${summary.cpu_percent}%</b> total CPU</span></div></div><div class="memory-donut-wrap"><div class="memory-donut" style="--memory:${memoryPercent}%"><strong>${memoryPercent.toFixed(0)}%</strong><small>memory used</small></div><p>${summary.memory_mib} MiB / ${summary.memory_limit_mib || '—'} MiB</p></div><div class="deployment-trend">${deploymentMemoryChart(selected.memory_history || [])}</div></div><section class="deployment-changes"><div class="timeline-heading"><span>Recent deployment changes</span><small>Image and readiness changes from the current observation window</small></div><ul>${changeHtml}</ul></section><div class="deployment-resource-grid"><section class="deployment-resource-list"><div class="timeline-heading"><span>Resources</span><small>Click one for details</small></div>${resources.length ? resources.map(item => `<button class="deployment-resource ${item.pod.name === selectedDeploymentResource ? 'active' : ''}" data-resource-select="${escapeHtml(item.pod.name)}"><span class="${severityClass(item.pod.risk)}">${escapeHtml(item.pod.status)}</span><strong>${escapeHtml(item.pod.name)}</strong><small>CPU ${percent(item.pod.cpu_percent)} · Memory ${percent(item.pod.memory_percent)} · Restarts ${item.pod.restarts}</small></button>`).join('') : '<p class="empty">No matching resource was found for this deployment.</p>'}</section><section class="deployment-resource-detail">${resource ? `<p class="eyebrow">SELECTED RESOURCE</p><h3>${escapeHtml(resource.pod.name)}</h3><div class="detail-grid"><div class="detail-metric"><span>CPU</span><strong>${percent(resource.pod.cpu_percent)}</strong><small>${resource.pod.cpu_millicores} millicores</small></div><div class="detail-metric"><span>Memory</span><strong>${resource.pod.memory_mib} MiB</strong><small>${percent(resource.pod.memory_percent)} of limit</small></div><div class="detail-metric"><span>Forecast</span><strong>${resource.forecast.forecast_percent ?? resource.pod.memory_percent}%</strong><small>15-minute projected memory</small></div><div class="detail-metric"><span>Signals</span><strong>${resource.analysis.counts?.errors || 0}</strong><small>Current log errors</small></div></div><p class="helper">${escapeHtml(resource.analysis.findings?.[0] || 'No critical signal in the current log sample.')}</p><button class="open-resource-detail" data-open-pod="${escapeHtml(resource.pod.name)}">Open full pod investigation</button>` : '<p class="empty">Select a resource to inspect it.</p>'}</section></div>`;
  const evidenceCount = (data?.incident_evidence || []).filter(item => resources.some(resourceItem => resourceItem.pod.name === item.pod)).length;
  target.querySelector('.deployment-changes')?.insertAdjacentHTML('beforebegin', `<section class="deployment-impact-map"><button class="impact-node"><small>WORKLOAD</small><strong>${escapeHtml(selected.name)}</strong><small>${escapeHtml(selected.type)}</small></button><button class="impact-node"><small>SERVICE</small><strong>${selected.exposed ? 'Exposed service' : 'Internal service'}</strong><small>${selected.exposed ? 'Reachable outside cluster' : 'Cluster-only access'}</small></button><button class="impact-node actionable" data-impact-resource><small>PODS / CONTAINERS</small><strong>${summary.resource_count || 0} monitored</strong><small>${selected.available}/${selected.desired} ready</small></button><button class="impact-node actionable" data-impact-logs><small>LIVE LOGS</small><strong>${resource?.analysis?.counts?.errors || 0} errors</strong><small>Open current pod context</small></button><button class="impact-node actionable" data-impact-evidence><small>INCIDENT EVIDENCE</small><strong>${evidenceCount} captures</strong><small>Restart and failure snapshots</small></button></section>`);
  const selector = target.querySelector('.deployment-selector');
  selector.innerHTML = `<label>Choose deployment <select id="deployment-select">${[...deployments].sort((left, right) => left.name.localeCompare(right.name)).map(item => `<option value="${escapeHtml(item.name)}" ${item.name === selected.name ? 'selected' : ''}>${escapeHtml(item.name)} · ${escapeHtml(item.status)}</option>`).join('')}</select></label><span>${deployments.length} deployments available</span>`;
  selector.querySelector('#deployment-select').addEventListener('change', event => { selectedDeploymentName = event.target.value; selectedDeploymentResource = undefined; renderDeploymentInspector(deployments); });
  target.querySelectorAll('[data-deployment-select]').forEach(button => button.addEventListener('click', () => { selectedDeploymentName = button.dataset.deploymentSelect; selectedDeploymentResource = undefined; renderDeploymentInspector(deployments); }));
  target.querySelectorAll('[data-resource-select]').forEach(button => button.addEventListener('click', () => { selectedDeploymentResource = button.dataset.resourceSelect; renderDeploymentInspector(deployments); openPodInvestigation(button.dataset.resourceSelect); }));
  target.querySelector('[data-open-pod]')?.addEventListener('click', () => openPodInvestigation(target.querySelector('[data-open-pod]').dataset.openPod));
  target.querySelector('[data-impact-resource]')?.addEventListener('click', () => { if (resource?.pod?.name) openPodInvestigation(resource.pod.name); });
  target.querySelector('[data-impact-logs]')?.addEventListener('click', () => {
    if (!resource?.pod?.name) return;
    logExplorerPodName = resource.pod.name;
    logExplorerSelectedIndex = undefined;
    window.history.replaceState(null, '', '#log-explorer-panel');
    setWorkspacePage('logs');
    renderLogExplorer();
    document.querySelector('#log-explorer-panel').scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
  target.querySelector('[data-impact-evidence]')?.addEventListener('click', () => {
    window.history.replaceState(null, '', '#alert-center');
    setWorkspacePage('alerts');
    document.querySelector('.incident-evidence-panel')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
}

function savedLogQueries() {
  try { return JSON.parse(localStorage.getItem('pulseops-log-queries') || '[]'); } catch { return []; }
}

function storeLogQuery(query) {
  const queries = savedLogQueries().filter(item => item.name !== query.name).slice(-7);
  queries.push(query);
  localStorage.setItem('pulseops-log-queries', JSON.stringify(queries));
}

function downloadLogRecords(records, format) {
  const content = format === 'json'
    ? JSON.stringify(records, null, 2)
    : ['timestamp,level,message,raw', ...records.map(record => [record.timestamp || '', record.level, record.message, record.raw].map(value => `"${String(value).replaceAll('"', '""')}"`).join(','))].join('\n');
  const url = URL.createObjectURL(new Blob([content], { type: format === 'json' ? 'application/json' : 'text/csv' }));
  const link = Object.assign(document.createElement('a'), { href: url, download: `${logExplorerPodName}-logs.${format}` });
  link.click();
  URL.revokeObjectURL(url);
}

function explainLogEvent(record, records, podName) {
  if (!record) return '';
  const text = String(record.message || record.raw || '');
  const normalized = text.toLowerCase();
  const rules = [
    { test: /oomkilled|out of memory|memory pressure/, title: 'The application ran out of available memory', impact: 'The container may be terminated or become unavailable while it restarts.', cause: 'Observed memory-exhaustion wording in the selected log.', next: 'Review memory usage, container limits, restart history, and recent traffic or release changes.' },
    { test: /connection refused|could not connect|connection reset/, title: 'A required service connection failed', impact: 'Requests depending on the downstream service may fail.', cause: 'The destination rejected or reset the application connection.', next: 'Check the downstream service health, address, port, network policy, and recent configuration changes.' },
    { test: /timeout|timed out|deadline exceeded/, title: 'An operation exceeded its allowed time', impact: 'Users may experience slow or failed requests.', cause: 'A timeout is directly observed; the slow component is not confirmed by this log alone.', next: 'Use the request ID and nearby logs to identify the slow dependency, then compare latency and capacity.' },
    { test: /\b5\d\d\b|internal server error|bad gateway|service unavailable/, title: 'The application returned a server-side failure', impact: 'One or more application requests may have failed.', cause: 'A server-error response is present in the selected event.', next: 'Follow the request ID through nearby logs and check pod health, dependencies, and the latest deployment.' },
    { test: /unauthorized|forbidden|authentication failed|access denied/, title: 'A request was rejected by access controls', impact: 'The affected user or service may not be able to complete the operation.', cause: 'Authentication or authorization failure wording is present.', next: 'Verify identity, role assignment, token validity, and recent access-policy changes without exposing credentials.' },
    { test: /not found|\b404\b/, title: 'A requested resource could not be found', impact: 'The specific request cannot complete until the path or resource is corrected.', cause: 'A missing-resource response is present in the selected event.', next: 'Check the requested path or identifier and compare it with the deployed application routes.' },
  ];
  const matched = rules.find(rule => rule.test.test(normalized));
  const isProblem = ['critical', 'error', 'warn'].includes(record.level);
  const explanation = matched || (isProblem ? { title: 'The application reported an operational error', impact: 'Impact cannot be confirmed from this single event.', cause: 'The selected log is classified as an error or warning.', next: 'Review nearby log context, request identifiers, pod health, and recent deployment changes.' } : { title: 'Informational application event', impact: 'No user impact is indicated by this event.', cause: 'The event is informational.', next: 'No action is required unless it correlates with another active signal.' });
  const signature = normalized.replace(/\b\d+\b/g, '#').replace(/[a-f0-9]{8,}/g, '#');
  const occurrences = records.filter(item => String(item.message || '').toLowerCase().replace(/\b\d+\b/g, '#').replace(/[a-f0-9]{8,}/g, '#') === signature).length;
  const deployment = (data?.deployments || []).find(item => (item.resources || []).some(resource => resource.pod?.name === podName));
  const technical = isDeveloperOrAdministrator() ? `<details><summary>Technical details</summary><dl><div><dt>Pod</dt><dd>${escapeHtml(podName)}</dd></div><div><dt>Timestamp</dt><dd>${escapeHtml(record.timestamp || 'Not provided')}</dd></div><div><dt>Image</dt><dd>${escapeHtml(deployment?.image || data?.pods?.find(pod => pod.name === podName)?.image || 'Not available')}</dd></div>${Object.entries(record.fields || {}).slice(0, 8).map(([key,value]) => `<div><dt>${escapeHtml(key)}</dt><dd>${escapeHtml(value)}</dd></div>`).join('')}</dl><pre>${escapeHtml(record.raw || record.message || '')}</pre></details>` : '';
  return `<section class="log-explanation ${isProblem ? 'attention' : 'informational'}"><header><div><span>${isProblem ? 'UNDERSTAND THIS ERROR' : 'EVENT EXPLANATION'}</span><h3>${escapeHtml(explanation.title)}</h3></div><b>${occurrences} occurrence${occurrences === 1 ? '' : 's'}</b></header><div class="log-explanation-grid"><div><span>What it may affect</span><p>${escapeHtml(explanation.impact)}</p></div><div><span>Evidence-based interpretation</span><p>${escapeHtml(explanation.cause)}</p></div><div><span>Recommended check</span><p>${escapeHtml(explanation.next)}</p></div></div><p class="log-fact-note"><b>Observed fact:</b> ${escapeHtml(text.slice(0, 280))}</p>${technical}</section>`;
}

function logSignature(message) {
  return String(message || '').toLowerCase().replace(/[0-9a-f]{8}-[0-9a-f-]{20,}/gi, '[uuid]').replace(/\b[0-9a-f]{8,}\b/gi, '[id]').replace(/\b\d+(?:\.\d+){1,3}\b/g, '[number]').replace(/\b\d+\b/g, '#').replace(/\s+/g, ' ').trim().slice(0, 220);
}

function correlationIds(record) {
  const ids = new Set();
  const accepted = /^(request|request_id|requestid|x-request-id|trace|trace_id|traceid|correlation|correlation_id|correlationid)$/i;
  Object.entries(record?.fields || {}).forEach(([key, value]) => { if (accepted.test(key.replaceAll('.', '_')) && String(value).length >= 4) ids.add(String(value)); });
  const raw = String(record?.raw || record?.message || '');
  for (const match of raw.matchAll(/\b(?:request[_-]?id|trace[_-]?id|correlation[_-]?id|x-request-id)[=:"'\s]+([a-zA-Z0-9_.:-]{4,128})/gi)) ids.add(match[1]);
  return [...ids];
}

function groupedErrorSignatures(recordFilter = () => true) {
  const groups = new Map();
  Object.entries(data?.structured_logs || {}).forEach(([pod, records]) => records.filter(record => ['critical', 'error', 'warn'].includes(record.level) && recordFilter(record, pod)).forEach(record => {
    const signature = logSignature(record.message);
    const group = groups.get(signature) || { signature, count: 0, pods: new Set(), first: record.timestamp, last: record.timestamp, example: record, examplePod: pod, levels: new Set() };
    group.count += 1; group.pods.add(pod); group.levels.add(record.level);
    if (record.timestamp && (!group.first || Date.parse(record.timestamp) < Date.parse(group.first))) group.first = record.timestamp;
    if (record.timestamp && (!group.last || Date.parse(record.timestamp) > Date.parse(group.last))) group.last = record.timestamp;
    groups.set(signature, group);
  }));
  return [...groups.values()].sort((left, right) => right.count - left.count).slice(0, 12);
}

function requestTraceHtml(selected) {
  const ids = correlationIds(selected);
  if (!ids.length) return '<section class="request-trace empty-trace"><div><p class="eyebrow">REQUEST TRACE</p><h3>No request or trace ID in this event</h3></div><p>Add a structured request_id, trace_id, or correlation_id field to application logs to enable cross-pod request tracing.</p></section>';
  const id = ids[0];
  const events = [];
  Object.entries(data?.structured_logs || {}).forEach(([pod, records]) => records.forEach(record => { if (correlationIds(record).includes(id) || String(record.raw || '').includes(id)) events.push({ pod, record }); }));
  events.sort((left, right) => Date.parse(left.record.timestamp || 0) - Date.parse(right.record.timestamp || 0));
  return `<section class="request-trace"><header><div><p class="eyebrow">REQUEST TRACE</p><h3>${escapeHtml(id)}</h3></div><span>${events.length} event${events.length === 1 ? '' : 's'} · ${new Set(events.map(item => item.pod)).size} pod${new Set(events.map(item => item.pod)).size === 1 ? '' : 's'}</span></header><div>${events.slice(0, 50).map((item, index) => `<article><i>${index + 1}</i><div><b>${escapeHtml(item.pod)}</b><small>${escapeHtml(item.record.timestamp || `Entry ${item.record.index + 1}`)} · ${escapeHtml(item.record.level)}</small><p>${escapeHtml(item.record.message)}</p></div></article>`).join('')}</div></section>`;
}

function renderLogExplorer() {
  const target = document.querySelector('#log-explorer');
  if (!data?.pods?.length) {
    target.innerHTML = '<p class="empty">No pod logs are available.</p>';
    return;
  }
  if (!data.pods.some(pod => pod.name === logExplorerPodName)) logExplorerPodName = data.pods[0].name;
  const records = data.structured_logs?.[logExplorerPodName] || [];
  if (!Number.isInteger(logExplorerSelectedIndex) || !records.some(record => record.index === logExplorerSelectedIndex)) logExplorerSelectedIndex = records.at(-1)?.index;
  const rangeMs = { '5m': 5 * 60_000, '15m': 15 * 60_000, '1h': 60 * 60_000, '6h': 6 * 60 * 60_000, '12h': 12 * 60 * 60_000, '24h': 24 * 60 * 60_000 }[logExplorerRange];
  const cutoff = rangeMs ? Date.now() - rangeMs : 0;
  const search = logExplorerSearch.trim().toLocaleLowerCase();
  const fieldSearch = logExplorerFieldSearch.trim().toLocaleLowerCase();
  const filteredRecords = records.filter(record => (!rangeMs || (record.timestamp && Date.parse(record.timestamp) >= cutoff)) && (logExplorerLevel === 'all' || record.level === logExplorerLevel) && (!search || `${record.level} ${record.message} ${record.raw}`.toLocaleLowerCase().includes(search)) && (!fieldSearch || JSON.stringify(record.fields || {}).toLocaleLowerCase().includes(fieldSearch)));
  if (!filteredRecords.some(record => record.index === logExplorerSelectedIndex)) logExplorerSelectedIndex = filteredRecords.at(-1)?.index;
  const selected = records.find(record => record.index === logExplorerSelectedIndex);
  const context = selected ? records.slice(Math.max(0, selected.index - logExplorerBefore), Math.min(records.length, selected.index + logExplorerAfter + 1)) : [];
  const selectedExplanation = selected ? explainLogEvent(selected, records, logExplorerPodName) : '';
  const selectedTrace = selected ? requestTraceHtml(selected) : '';
  const recent = filteredRecords.slice(-30).reverse();
  const severity = record => record.level === 'warn' ? 'warning' : record.level === 'error' || record.level === 'critical' ? 'critical' : 'healthy';
  const patternMap = new Map();
  filteredRecords.filter(record => ['error', 'critical'].includes(record.level)).forEach(record => {
    const pattern = record.message.replace(/\b[0-9a-f]{8,}\b/gi, '[id]').replace(/\b\d+(?:\.\d+){0,3}\b/g, '#').replace(/\b\d+\b/g, '#').slice(0, 160);
    const existing = patternMap.get(pattern) || { pattern, count: 0, latest: record.timestamp };
    existing.count += 1; existing.latest = record.timestamp || existing.latest; patternMap.set(pattern, existing);
  });
  const patterns = [...patternMap.values()].filter(item => item.count > 1).sort((a, b) => b.count - a.count).slice(0, 4);
  const queryOptions = savedLogQueries();
  const errorCount = filteredRecords.filter(record => ['error', 'critical'].includes(record.level)).length;
  const warningCount = filteredRecords.filter(record => record.level === 'warn').length;
  const latestError = filteredRecords.filter(record => ['error', 'critical'].includes(record.level)).at(-1)?.timestamp || 'None';
  const dated = records.map(record => Date.parse(record.timestamp || '')).filter(Number.isFinite);
  const availableWindow = dated.length > 1 ? `${Math.max(0, Math.round((Math.max(...dated) - Math.min(...dated)) / 60000))} minute sampled window` : 'recent sampled log window';
  const sourceNote = data.mode === 'splunk' ? 'Splunk returns the configured lookback window.' : `This source currently provides a ${availableWindow}; longer selections only filter records available in this sample.`;
  const errorGroups = groupedErrorSignatures(record => !rangeMs || (record.timestamp && Date.parse(record.timestamp) >= cutoff));
  target.innerHTML = `<section class="log-summary"><article><span>Errors</span><strong>${errorCount}</strong><small>Latest: ${escapeHtml(latestError)}</small></article><article><span>Warnings</span><strong>${warningCount}</strong><small>Current sampled window</small></article><article><span>Recurring patterns</span><strong>${patterns.length}</strong><small>Repeated error signatures</small></article><article><span>Available data</span><strong>${records.length}</strong><small>${escapeHtml(sourceNote)}</small></article></section><div class="log-control-bar"><label>Pod<select id="log-explorer-pod">${data.pods.map(pod => `<option value="${escapeHtml(pod.name)}" ${pod.name === logExplorerPodName ? 'selected' : ''}>${escapeHtml(pod.name)} · ${escapeHtml(pod.status)}</option>`).join('')}</select></label><label>Time range<select id="log-explorer-range"><option value="all" ${logExplorerRange === 'all' ? 'selected' : ''}>Available sample</option><option value="5m" ${logExplorerRange === '5m' ? 'selected' : ''}>Last 5 minutes</option><option value="15m" ${logExplorerRange === '15m' ? 'selected' : ''}>Last 15 minutes</option><option value="1h" ${logExplorerRange === '1h' ? 'selected' : ''}>Last hour</option><option value="6h" ${logExplorerRange === '6h' ? 'selected' : ''}>Last 6 hours</option></select></label><label>Severity<select id="log-explorer-level"><option value="all" ${logExplorerLevel === 'all' ? 'selected' : ''}>All events</option><option value="critical" ${logExplorerLevel === 'critical' ? 'selected' : ''}>Critical</option><option value="error" ${logExplorerLevel === 'error' ? 'selected' : ''}>Errors</option><option value="warn" ${logExplorerLevel === 'warn' ? 'selected' : ''}>Warnings</option><option value="info" ${logExplorerLevel === 'info' ? 'selected' : ''}>Information</option></select></label><label class="log-search">Search<input id="log-explorer-search" value="${escapeHtml(logExplorerSearch)}" placeholder="Error text, request ID, message…"></label><button data-log-apply-search>Search</button><button class="live-tail ${logExplorerLiveTail ? 'active' : ''}" data-log-live-tail>${logExplorerLiveTail ? '● Live tail on' : '○ Live tail paused'}</button></div><details class="advanced-log-filters"><summary>Advanced filter</summary><label>Structured field value<input id="log-explorer-field-search" value="${escapeHtml(logExplorerFieldSearch)}" placeholder="e.g. request_id, 500, timeout"></label><button type="button" data-log-apply-field>Apply filter</button></details><div class="log-action-bar"><label>Saved query<select id="log-saved-query"><option value="">Choose a saved query</option>${queryOptions.map((query, index) => `<option value="${index}">${escapeHtml(query.name)}</option>`).join('')}</select></label><button data-log-save-query>Save current query</button><label>Context<select id="log-context-before"><option value="5" ${logExplorerBefore === 5 ? 'selected' : ''}>5 before</option><option value="20" ${logExplorerBefore === 20 ? 'selected' : ''}>20 before</option><option value="100" ${logExplorerBefore === 100 ? 'selected' : ''}>100 before</option></select></label><label>Following<select id="log-context-after"><option value="0" ${logExplorerAfter === 0 ? 'selected' : ''}>None</option><option value="5" ${logExplorerAfter === 5 ? 'selected' : ''}>5 after</option><option value="20" ${logExplorerAfter === 20 ? 'selected' : ''}>20 after</option></select></label><span>${recent.length}/${records.length} records shown</span><button data-log-export="json">Export JSON</button><button data-log-export="csv">Export CSV</button></div><div class="log-explorer-grid"><div class="log-event-list"><div class="log-list-heading"><strong>${escapeHtml(logExplorerPodName)}</strong><small>${records.length} recent records</small></div>${recent.length ? recent.map(record => `<button class="log-event ${record.index === logExplorerSelectedIndex ? 'active' : ''}" data-log-explorer-index="${record.index}"><span class="${severityClass(severity(record))}">${escapeHtml(record.level)}</span><strong>${escapeHtml(record.timestamp || `Entry ${record.index + 1}`)}</strong><small>${escapeHtml(record.message)}</small></button>`).join('') : '<p class="empty">No matching logs for this filter.</p>'}</div><div class="log-json-view">${selected ? `<div class="log-list-heading"><strong>${logExplorerJsonOpen ? 'JSON context' : 'Selected log event'}</strong><small>${logExplorerJsonOpen ? `${Math.max(0, context.length - 1)} nearby events included` : 'Open as JSON for full details'}</small></div>${logExplorerJsonOpen ? `<pre class="large-log">${escapeHtml(JSON.stringify(context, null, 2))}</pre><button class="log-json-action" data-log-json-close>Show selected event</button>` : `<div class="log-preview"><span class="${severityClass(severity(selected))}">${escapeHtml(selected.level)}</span><p>${escapeHtml(selected.message)}</p><button class="log-json-action" data-log-json-open>Open JSON context</button></div>`}` : '<p class="empty">Choose a log event to inspect it.</p>'}</div></div><section class="pattern-panel"><div><p class="eyebrow">RECURRING ERROR PATTERNS</p><h3>Potential incident signals</h3></div>${patterns.length ? patterns.map(item => `<article><strong>${item.count} occurrences</strong><p>${escapeHtml(item.pattern)}</p><button data-pattern-filter="${escapeHtml(item.pattern)}">Filter</button><button data-pattern-alert="${escapeHtml(item.pattern)}">Create alert</button></article>`).join('') : '<p class="empty">No repeated error or critical pattern in the current sample.</p>'}</section>`;
  const rangeSelector = target.querySelector('#log-explorer-range');
  [['12h', 'Last 12 hours'], ['24h', 'Last 24 hours']].forEach(([value, label]) => {
    const option = document.createElement('option'); option.value = value; option.textContent = label; option.selected = logExplorerRange === value; rangeSelector.append(option);
  });
  if (selectedExplanation) target.querySelector('.log-json-view')?.insertAdjacentHTML('afterbegin', `${selectedExplanation}${selectedTrace}`);
  target.querySelector('.pattern-panel')?.insertAdjacentHTML('beforebegin', `<section class="error-signature-panel"><header><div><p class="eyebrow">GROUPED ERROR SIGNATURES</p><h3>Repeated failures across available pods</h3></div><small>${errorGroups.length} normalized group${errorGroups.length === 1 ? '' : 's'} · current available samples</small></header>${errorGroups.length ? `<div>${errorGroups.map((group, index) => `<article><span class="signature-rank">${index + 1}</span><div><b>${escapeHtml(group.signature)}</b><p>${group.count} occurrence${group.count === 1 ? '' : 's'} across ${group.pods.size} pod${group.pods.size === 1 ? '' : 's'} · ${escapeHtml([...group.levels].join(', '))}</p><small>${escapeHtml([...group.pods].slice(0, 5).join(', '))}${group.pods.size > 5 ? ` +${group.pods.size - 5} more` : ''}</small></div><div><small>${escapeHtml(group.first || 'Time unavailable')} → ${escapeHtml(group.last || 'Time unavailable')}</small><button type="button" data-error-group-pod="${escapeHtml(group.examplePod)}" data-error-group-index="${group.example.index}">Open example</button></div></article>`).join('')}</div>` : '<p class="empty">No warning, error, or critical signatures in the available samples.</p>'}</section>`);
  target.querySelectorAll('.error-signature-panel article').forEach((article, index) => {
    if (!isDeveloperOrAdministrator() || !errorGroups[index]) return;
    const button = document.createElement('button');
    button.type = 'button'; button.textContent = 'Developer workspace'; button.dataset.errorGroupWorkspace = errorGroups[index].examplePod;
    article.lastElementChild?.append(button);
  });
  target.querySelectorAll('[data-error-group-workspace]').forEach(button => button.addEventListener('click', () => openDeveloperInvestigation(button.dataset.errorGroupWorkspace)));
  target.querySelectorAll('[data-error-group-pod]').forEach(button => button.addEventListener('click', () => {
    logExplorerPodName = button.dataset.errorGroupPod;
    logExplorerSelectedIndex = Number(button.dataset.errorGroupIndex);
    logExplorerJsonOpen = false;
    renderLogExplorer();
  }));
  document.querySelector('#log-explorer-pod').addEventListener('change', event => {
    logExplorerPodName = event.target.value;
    logExplorerSelectedIndex = undefined;
    logExplorerJsonOpen = false;
    renderLogExplorer();
  });
  document.querySelector('#log-explorer-level').addEventListener('change', event => {
    logExplorerLevel = event.target.value;
    logExplorerSelectedIndex = undefined;
    logExplorerJsonOpen = false;
    renderLogExplorer();
  });
  document.querySelector('#log-explorer-range').addEventListener('change', event => { logExplorerRange = event.target.value; logExplorerSelectedIndex = undefined; renderLogExplorer(); });
  document.querySelector('[data-log-apply-search]').addEventListener('click', () => { logExplorerSearch = document.querySelector('#log-explorer-search').value; logExplorerSelectedIndex = undefined; renderLogExplorer(); });
  document.querySelector('#log-explorer-search').addEventListener('keypress', event => { if (event.key === 'Enter') document.querySelector('[data-log-apply-search]').click(); });
  document.querySelector('[data-log-apply-field]').addEventListener('click', () => { logExplorerFieldSearch = document.querySelector('#log-explorer-field-search').value; logExplorerSelectedIndex = undefined; renderLogExplorer(); });
  document.querySelector('#log-context-before').addEventListener('change', event => { logExplorerBefore = Number(event.target.value); renderLogExplorer(); });
  document.querySelector('#log-context-after').addEventListener('change', event => { logExplorerAfter = Number(event.target.value); renderLogExplorer(); });
  document.querySelector('[data-log-live-tail]').addEventListener('click', () => { logExplorerLiveTail = !logExplorerLiveTail; renderLogExplorer(); });
  document.querySelector('#log-saved-query').addEventListener('change', event => {
    const query = savedLogQueries()[Number(event.target.value)];
    if (!query) return;
    ({ pod: logExplorerPodName, level: logExplorerLevel, range: logExplorerRange, search: logExplorerSearch } = query);
    logExplorerSelectedIndex = undefined; renderLogExplorer();
  });
  document.querySelector('[data-log-save-query]').addEventListener('click', () => {
    const name = window.prompt('Name this log query');
    if (!name?.trim()) return;
    storeLogQuery({ name: name.trim(), pod: logExplorerPodName, level: logExplorerLevel, range: logExplorerRange, search: logExplorerSearch });
    renderLogExplorer();
  });
  document.querySelectorAll('[data-log-export]').forEach(button => button.addEventListener('click', () => downloadLogRecords(filteredRecords, button.dataset.logExport)));
  document.querySelectorAll('[data-log-explorer-index]').forEach(button => button.addEventListener('click', () => {
    logExplorerSelectedIndex = Number(button.dataset.logExplorerIndex);
    logExplorerJsonOpen = true;
    renderLogExplorer();
  }));
  document.querySelector('[data-log-json-open]')?.addEventListener('click', () => { logExplorerJsonOpen = true; renderLogExplorer(); });
  document.querySelector('[data-log-json-close]')?.addEventListener('click', () => { logExplorerJsonOpen = false; renderLogExplorer(); });
  document.querySelectorAll('[data-pattern-filter]').forEach(button => button.addEventListener('click', () => { logExplorerSearch = button.dataset.patternFilter; logExplorerSelectedIndex = undefined; renderLogExplorer(); }));
  document.querySelectorAll('[data-pattern-alert]').forEach(button => button.addEventListener('click', async () => {
    const pattern = button.dataset.patternAlert;
    const threshold = Number(window.prompt('Create an alert when this pattern occurs this many times in the current log sample:', '3'));
    if (!Number.isFinite(threshold) || threshold < 1) return;
    button.textContent = 'Creating…';
    try {
      const response = await fetch('/api/alert-rules/log-pattern', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: `Repeated log pattern: ${pattern.slice(0, 48)}`, pattern, threshold }) });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.detail || 'Unable to create the alert rule.');
      button.textContent = 'Alert created';
      setTimeout(load, 500);
    } catch (error) { button.textContent = 'Create alert'; window.alert(error.message); }
  }));
}

function memoryTimeline(forecast) {
  const history = forecast.history || [];
  if (history.length < 2) return '<p class="chart-empty">Collecting Prometheus history…</p>';
  const width = 640, height = 150, pad = 12;
  const values = history.map(item => item.memory_mib);
  const minimum = Math.min(...values), maximum = Math.max(...values);
  const spread = Math.max(maximum - minimum, Math.max(maximum * 0.04, 0.5));
  const points = history.map((item, index) => {
    const x = pad + index / (history.length - 1) * (width - pad * 2);
    const y = height - pad - ((item.memory_mib - minimum + spread * 0.15) / (spread * 1.3)) * (height - pad * 2);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');
  const area = `${pad},${height - pad} ${points} ${width - pad},${height - pad}`;
  return `<div class="timeline"><div class="timeline-heading"><span>Memory history</span><small>Last 15 minutes · ${history.length} readings</small></div><svg viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" role="img" aria-label="Memory usage history"><defs><linearGradient id="memory-fill" x1="0" x2="0" y1="0" y2="1"><stop offset="0%" stop-color="#8b5cf6" stop-opacity=".42"/><stop offset="100%" stop-color="#8b5cf6" stop-opacity="0"/></linearGradient></defs><line x1="${pad}" y1="${height - pad}" x2="${width - pad}" y2="${height - pad}" class="chart-axis"/><polygon points="${area}" fill="url(#memory-fill)"/><polyline points="${points}" fill="none" stroke="#9b7aff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg><div class="chart-range"><span>${minimum.toFixed(1)} MiB</span><span>${maximum.toFixed(1)} MiB</span></div></div>`;
}

function renderPods(pods) {
  const search = podSearch.trim().toLowerCase();
  const filtered = [...pods].filter(pod => {
    const matchesSearch = !search || `${pod.name} ${pod.namespace} ${pod.node}`.toLowerCase().includes(search);
    const needsAttention = pod.risk !== 'healthy' || String(pod.status).toLowerCase() !== 'running';
    const matchesFilter = podFilter === 'all' || podFilter === 'attention' && needsAttention || podFilter === 'running' && String(pod.status).toLowerCase() === 'running';
    return matchesSearch && matchesFilter;
  }).sort((left, right) => podSort === 'name' ? left.name.localeCompare(right.name) : podSort === 'memory' ? Number(right.memory_percent) - Number(left.memory_percent) : podSort === 'restarts' ? Number(right.restarts) - Number(left.restarts) : severityRank[right.risk] - severityRank[left.risk] || left.name.localeCompare(right.name));
  const pages = Math.max(1, Math.ceil(filtered.length / podPageSize));
  podPage = Math.min(podPage, pages);
  const start = (podPage - 1) * podPageSize;
  const visible = filtered.slice(start, start + podPageSize);
  document.querySelector('#pod-inventory-controls').innerHTML = `<div class="inventory-filters"><label>Find pod <input id="pod-search" value="${escapeHtml(podSearch)}" placeholder="Name, namespace, or node"></label><button type="button" data-pod-search>Search</button><label>Show <select id="pod-filter"><option value="all" ${podFilter === 'all' ? 'selected' : ''}>All pods</option><option value="attention" ${podFilter === 'attention' ? 'selected' : ''}>Needs attention</option><option value="running" ${podFilter === 'running' ? 'selected' : ''}>Running only</option></select></label><label>Order <select id="pod-sort"><option value="attention" ${podSort === 'attention' ? 'selected' : ''}>Attention first</option><option value="memory" ${podSort === 'memory' ? 'selected' : ''}>Memory high to low</option><option value="restarts" ${podSort === 'restarts' ? 'selected' : ''}>Restarts high to low</option><option value="name" ${podSort === 'name' ? 'selected' : ''}>Name A–Z</option></select></label></div><div class="inventory-pagination"><span>${filtered.length ? `Showing ${start + 1}–${Math.min(start + podPageSize, filtered.length)} of ${filtered.length}` : 'No matching pods'} · ${pods.length} total</span><label>Rows <select id="pod-page-size"><option value="25" ${podPageSize === 25 ? 'selected' : ''}>25</option><option value="50" ${podPageSize === 50 ? 'selected' : ''}>50</option><option value="100" ${podPageSize === 100 ? 'selected' : ''}>100</option></select></label><button type="button" data-pod-prev ${podPage === 1 ? 'disabled' : ''}>Previous</button><span>Page ${podPage} of ${pages}</span><button type="button" data-pod-next ${podPage === pages ? 'disabled' : ''}>Next</button></div>`;
  document.querySelector('#pods').innerHTML = visible.length ? visible.map(pod => `<tr class="${selectedPodName === pod.name ? 'selected' : ''}">
    <td><button class="pod-link" data-pod="${escapeHtml(pod.name)}">${escapeHtml(pod.name)}</button><small>${escapeHtml(pod.namespace)}</small></td>
    <td><span class="${severityClass(pod.risk)}">${pod.status}</span></td>
    <td>${pod.cpu_millicores}m <div class="bar"><i style="width:${Math.min(100, pod.cpu_percent)}%"></i></div><small>${percent(pod.cpu_percent)} of limit</small></td>
    <td>${pod.memory_mib} MiB <div class="bar memory"><i style="width:${Math.min(100, pod.memory_percent)}%"></i></div><small>${percent(pod.memory_percent)} of limit</small></td>
    <td>${pod.restarts}</td><td>${escapeHtml(pod.node)}</td><td><button class="forecast-button" data-pod="${escapeHtml(pod.name)}">Inspect</button></td></tr>`).join('') : '<tr><td colspan="7" class="empty">No pods match the selected filter.</td></tr>';
  document.querySelectorAll('[data-pod]').forEach(button => button.addEventListener('click', () => openPodInvestigation(button.dataset.pod)));
  document.querySelector('[data-pod-search]').addEventListener('click', () => { podSearch = document.querySelector('#pod-search').value; podPage = 1; renderPods(pods); });
  document.querySelector('#pod-search').addEventListener('input', event => { podSearch = event.target.value; });
  document.querySelector('#pod-search').addEventListener('keypress', event => { if (event.key === 'Enter') document.querySelector('[data-pod-search]').click(); });
  document.querySelector('#pod-filter').addEventListener('change', event => { podFilter = event.target.value; podPage = 1; renderPods(pods); });
  document.querySelector('#pod-sort').addEventListener('change', event => { podSort = event.target.value; podPage = 1; renderPods(pods); });
  document.querySelector('#pod-page-size').addEventListener('change', event => { podPageSize = Number(event.target.value); podPage = 1; renderPods(pods); });
  document.querySelector('[data-pod-prev]').addEventListener('click', () => { podPage -= 1; renderPods(pods); });
  document.querySelector('[data-pod-next]').addEventListener('click', () => { podPage += 1; renderPods(pods); });
}

function alertKey(alert) { return alert.id || `${alert.source || 'system'}:${alert.pod || 'cluster'}:${alert.message || ''}`; }

function investigateAlert(alert) {
  logExplorerPodName = alert.pod;
  logExplorerLevel = alert.severity === 'critical' ? 'critical' : alert.severity === 'warning' ? 'error' : 'all';
  logExplorerSearch = '';
  logExplorerSelectedIndex = undefined;
  logExplorerJsonOpen = false;
  setWorkspacePage('logs');
  renderLogExplorer();
  document.querySelector('#log-explorer-panel').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function openAlertEvidencePath(alert) {
  const deployment = (data?.deployments || []).find(item => (item.resources || []).some(resource => resource.pod?.name === alert.pod));
  if (!deployment) { investigateAlert(alert); return; }
  selectedDeploymentName = deployment.name;
  selectedDeploymentResource = alert.pod;
  window.history.replaceState(null, '', '#deployment-inspector');
  setWorkspacePage('workloads');
  renderDeploymentInspector(data.deployments || []);
  document.querySelector('#deployment-inspector').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

async function updateAlertLifecycle(key, status, button) {
  button.disabled = true; button.textContent = 'Saving…';
  try {
    const response = await fetch('/api/alert-acknowledgements', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key, status }) });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.detail || 'Unable to update this alert.');
    acknowledgedAlerts[key] = payload.acknowledgement;
    renderAlerts(data.alerts || []);
  } catch (error) { button.disabled = false; button.textContent = status === 'investigating' ? 'Investigate' : 'Acknowledge'; window.alert(error.message); }
}

function renderAlerts(alerts) {
  const target = document.querySelector('#alerts');
  const action = document.querySelector('[data-alert-act]');
  if (action) { action.disabled = !alerts.length; action.textContent = alerts.length ? 'Investigate top alert' : 'No action needed'; }
  const delivery = '<p class="muted">Notification delivery is not connected. Alerts are evaluated and retained locally; connect an approved Teams or email destination before relying on external notifications.</p>';
  const groups = new Map();
  alerts.sort((a, b) => severityRank[b.severity] - severityRank[a.severity]).forEach(alert => { const list = groups.get(alert.pod) || []; list.push(alert); groups.set(alert.pod, list); });
  target.innerHTML = `${groups.size ? [...groups.entries()].map(([pod, podAlerts]) => `<section class="alert-group"><div class="alert-group-heading"><div><strong>${escapeHtml(pod)}</strong><small>${podAlerts.length} active signal${podAlerts.length === 1 ? '' : 's'}</small></div><button type="button" data-alert-investigate-pod="${escapeHtml(pod)}">Open evidence path</button></div>${podAlerts.map(alert => { const key = alertKey(alert); const record = acknowledgedAlerts[key]; const state = record?.status || 'active'; const lifecycle = record ? `<small>${escapeHtml(state)} by ${escapeHtml(record.acknowledged_by)} · ${new Date(record.acknowledged_at).toLocaleString()}${record.note ? ` · ${escapeHtml(record.note)}` : ''}</small>` : '<small>Active and not yet acknowledged</small>'; const controls = isDeveloperOrAdministrator() ? `<div class="alert-actions"><button type="button" data-alert-investigate="${escapeHtml(key)}">Open logs</button>${state === 'investigating' ? '<span class="alert-acknowledged">Investigating</span>' : `<button type="button" data-alert-lifecycle="${escapeHtml(key)}" data-alert-status="investigating">Investigate</button>`}${state === 'acknowledged' ? '<span class="alert-acknowledged">Acknowledged</span>' : `<button type="button" data-alert-lifecycle="${escapeHtml(key)}" data-alert-status="acknowledged">Acknowledge</button>`}</div>` : '<span class="alert-acknowledged">View only</span>'; return `<div class="alert ${alert.severity} ${record ? 'acknowledged' : ''}"><span class="${severityClass(alert.severity)}">${escapeHtml(alert.severity)}</span><div><p>${escapeHtml(alert.message)}</p>${lifecycle}</div>${controls}</div>`; }).join('')}</section>`).join('') : '<p class="empty">No active alerts.</p>'}${delivery}`;
  target.querySelectorAll('[data-alert-investigate-pod]').forEach(button => button.addEventListener('click', () => openAlertEvidencePath({ pod: button.dataset.alertInvestigatePod, severity: 'warning' })));
  target.querySelectorAll('[data-alert-investigate]').forEach(button => button.addEventListener('click', () => { const alert = alerts.find(item => alertKey(item) === button.dataset.alertInvestigate); if (alert) investigateAlert(alert); }));
  target.querySelectorAll('[data-alert-lifecycle]').forEach(button => button.addEventListener('click', () => updateAlertLifecycle(button.dataset.alertLifecycle, button.dataset.alertStatus, button)));
}

function renderAlertHistory(events) {
  const target = document.querySelector('#alert-history');
  if (!target) return;
  const visible = [...events].sort((a, b) => new Date(b.last_seen || b.first_seen) - new Date(a.last_seen || a.first_seen)).slice(0, 50);
  target.innerHTML = visible.length ? `<div class="table-wrap"><table class="alert-history-table"><thead><tr><th>Signal</th><th>Pod</th><th>State</th><th>First seen</th><th>Last seen</th><th>Occurrences</th><th></th></tr></thead><tbody>${visible.map(event => `<tr><td>${escapeHtml(event.message || event.rule_id || 'Alert')}</td><td>${escapeHtml(event.pod || 'Cluster')}</td><td><span class="${severityClass(event.state === 'active' ? event.severity : 'healthy')}">${escapeHtml(event.state || 'active')}</span></td><td>${event.first_seen ? new Date(event.first_seen).toLocaleString() : '—'}</td><td>${event.last_seen ? new Date(event.last_seen).toLocaleString() : '—'}</td><td>${Number(event.occurrences || 1)}</td><td><button type="button" data-alert-history-investigate="${escapeHtml(event.pod || '')}">Investigate</button></td></tr>`).join('')}</tbody></table></div>` : '<p class="empty">No alert history yet. Active and resolved alerts will appear here automatically.</p>';
  target.querySelectorAll('[data-alert-history-investigate]').forEach(button => button.addEventListener('click', () => investigateAlert({ pod: button.dataset.alertHistoryInvestigate, severity: 'warning' })));
}

function renderIncidentEvidence(incidents) {
  const target = document.querySelector('#incident-evidence');
  if (!target) return;
  if (!isDeveloperOrAdministrator()) {
    target.innerHTML = '<p class="empty">Captured log evidence is available to Developer / Operator and Administrator accounts.</p>';
    return;
  }
  if (!incidents.length) {
    target.innerHTML = '<p class="empty">No incident snapshot has been captured yet. L1ControlScope keeps a rolling 15-minute log window and saves it automatically when a pod restarts, fails, or is evicted.</p>';
    return;
  }
  target.innerHTML = `<div class="incident-evidence-list">${incidents.map(item => `<article class="incident-evidence-card ${escapeHtml(item.kind)}"><div><span class="${severityClass(item.kind === 'restart' ? 'warning' : 'critical')}">${escapeHtml(item.kind.replace('_', ' '))}</span><strong>${escapeHtml(item.pod)}</strong><small>${new Date(item.detected_at).toLocaleString()} · ${item.log_count} captured log records</small><p>${escapeHtml(item.detail)}</p></div><button type="button" data-incident-evidence-open="${escapeHtml(item.id)}">Open captured logs</button></article>`).join('')}</div><div id="incident-evidence-detail"></div>`;
  target.querySelectorAll('[data-incident-evidence-open]').forEach(button => button.addEventListener('click', async () => {
    button.disabled = true; button.textContent = 'Loading…';
    try {
      const response = await fetch(`/api/incident-evidence/${encodeURIComponent(button.dataset.incidentEvidenceOpen)}`);
      const incident = await response.json();
      if (!response.ok) throw new Error(incident.detail || 'Captured evidence is unavailable.');
      const detail = target.querySelector('#incident-evidence-detail');
      const exportId = `incident-${incident.id}`;
      detail.innerHTML = `<section class="incident-evidence-detail"><div><p class="eyebrow">${escapeHtml(incident.pod)} · ${escapeHtml(incident.kind.replace('_', ' '))}</p><h3>Captured pre-incident logs</h3><p>${escapeHtml(incident.detail)} This snapshot contains ${incident.log_window.length} masked records collected before detection.</p></div><button type="button" data-incident-evidence-export="${escapeHtml(exportId)}">Export JSON</button><pre>${escapeHtml(JSON.stringify(incident, null, 2))}</pre></section>`;
      detail.querySelector('[data-incident-evidence-export]').addEventListener('click', () => {
        const link = Object.assign(document.createElement('a'), { href: URL.createObjectURL(new Blob([JSON.stringify(incident, null, 2)], { type: 'application/json' })), download: `${incident.pod}-${incident.kind}-evidence.json` });
        link.click(); URL.revokeObjectURL(link.href);
      });
      detail.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    } catch (error) { window.alert(error.message); } finally { button.disabled = false; button.textContent = 'Open captured logs'; }
  }));
}

function renderAlertRules(rules) {
  const target = document.querySelector('#alert-rules');
  const createTarget = document.querySelector('#alert-rule-create');
  const pods = (data?.pods || []).map(pod => pod.name).sort();
  const usesPercentageThreshold = metric => ['memory_percent', 'cpu_percent'].includes(metric);
  const conditionLabel = (metric, threshold) => metric === 'memory_percent' ? `Memory usage reaches ${Number(threshold)}%` : metric === 'cpu_percent' ? `CPU usage reaches ${Number(threshold)}%` : metric === 'restarts' ? 'A restart is detected in the last 10 minutes' : 'An error is found in the current log sample';
  // The dashboard refreshes continuously. Create the editor once, then leave it
  // untouched so a refresh can never erase text or selections being entered.
  const editorInitialized = createTarget?.dataset.initialized === 'true';
  if (createTarget && !editorInitialized) {
    createTarget.innerHTML = isAdministrator() ? `<details><summary>Add alert rule</summary><form id="create-alert-rule" class="rule-create-form"><label>Rule name<input id="new-rule-name" required maxlength="120" placeholder="e.g. Backend memory warning"></label><label>Signal<select id="new-rule-metric"><option value="memory_percent">Memory usage</option><option value="cpu_percent">CPU usage</option><option value="restarts">Pod restart</option><option value="errors">Log error</option></select></label><label id="new-rule-threshold-label">Alert when memory usage reaches (%)<input id="new-rule-threshold" type="number" required min="0" step="0.1" value="85"></label><label id="new-rule-sustain-label">Sustain breach for<select id="new-rule-sustain"><option value="0">Immediately</option><option value="5">5 minutes</option><option value="10">10 minutes</option><option value="15">15 minutes</option></select></label><p id="new-rule-event-condition" class="rule-event-condition" hidden></p><label>Severity<select id="new-rule-severity"><option value="warning">Warning</option><option value="critical">Critical</option></select></label><label>Apply to<select id="new-rule-scope"><option value="all">All monitored pods</option><option value="pod">One specific pod</option><option value="name_contains">Pod name contains</option></select></label><label id="new-rule-scope-value" hidden>Pod / match<input id="new-rule-scope-input" list="new-rule-pods" placeholder="Choose or enter pod"><datalist id="new-rule-pods">${pods.map(name => `<option value="${escapeHtml(name)}">`).join('')}</datalist></label><button type="submit">Add rule</button></form></details>` : '<p class="rule-view-only">Only an administrator can add or change alert rules.</p>';
    createTarget.dataset.initialized = 'true';
  }
  if (!editorInitialized) {
    const updateNewRuleMetric = () => { const metric = createTarget.querySelector('#new-rule-metric').value; const threshold = createTarget.querySelector('#new-rule-threshold-label'); const sustain = createTarget.querySelector('#new-rule-sustain-label'); const eventCondition = createTarget.querySelector('#new-rule-event-condition'); threshold.hidden = !usesPercentageThreshold(metric); sustain.hidden = !usesPercentageThreshold(metric); eventCondition.hidden = usesPercentageThreshold(metric); eventCondition.textContent = conditionLabel(metric, 1); threshold.firstChild.textContent = metric === 'cpu_percent' ? 'Alert when CPU usage reaches (%)' : 'Alert when memory usage reaches (%)'; };
    createTarget?.querySelector('#new-rule-metric')?.addEventListener('change', updateNewRuleMetric);
    updateNewRuleMetric();
    createTarget?.querySelector('#new-rule-scope')?.addEventListener('change', event => { const field = createTarget.querySelector('#new-rule-scope-value'); field.hidden = event.target.value === 'all'; createTarget.querySelector('#new-rule-scope-input').placeholder = event.target.value === 'name_contains' ? 'e.g. backend' : 'Choose or enter pod'; });
  }
  if (!editorInitialized) createTarget?.querySelector('#create-alert-rule')?.addEventListener('submit', async event => {
    event.preventDefault();
    const button = createTarget.querySelector('button[type="submit"]');
    const metric = createTarget.querySelector('#new-rule-metric').value;
    const payload = { name: createTarget.querySelector('#new-rule-name').value.trim(), metric, threshold: usesPercentageThreshold(metric) ? Number(createTarget.querySelector('#new-rule-threshold').value) : 1, sustain_minutes: usesPercentageThreshold(metric) ? Number(createTarget.querySelector('#new-rule-sustain').value) : 0, severity: createTarget.querySelector('#new-rule-severity').value, scope_type: createTarget.querySelector('#new-rule-scope').value, scope_value: createTarget.querySelector('#new-rule-scope-input').value.trim() };
    button.disabled = true; button.textContent = 'Adding…';
    try { const response = await fetch('/api/alert-rules', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }); const result = await response.json(); if (!response.ok) throw new Error(result.detail || 'Unable to add the alert rule.'); createTarget.innerHTML = ''; delete createTarget.dataset.initialized; await load(); } catch (error) { button.disabled = false; button.textContent = 'Add rule'; window.alert(error.message); }
  });
  if (!rules.length) {
    target.innerHTML = '<p class="empty">Alert rules are unavailable until live telemetry connects.</p>';
    return;
  }
  const scopeLabel = rule => rule.scope_type === 'pod' ? `Only ${rule.scope_value}` : rule.scope_type === 'name_contains' ? `Names containing “${rule.scope_value}”` : 'All monitored pods';
  target.innerHTML = rules.map(rule => `<article class="rule-card ${rule.enabled ? '' : 'disabled'}" data-rule-id="${escapeHtml(rule.id)}" data-rule-metric="${escapeHtml(rule.metric)}">
    <div class="rule-card-heading"><div><span class="${severityClass(rule.severity)}">${escapeHtml(rule.severity)}</span><h3>${escapeHtml(rule.name)}</h3><p>${escapeHtml(rule.description)}</p></div>${isAdministrator() ? `<label class="rule-toggle"><input type="checkbox" data-rule-enabled="${escapeHtml(rule.id)}" ${rule.enabled ? 'checked' : ''}><span>Enabled</span></label>` : ''}</div>
    ${isAdministrator() ? `<div class="rule-controls"><p class="rule-edit-help">Edit the settings below, then save. You can disable any rule; only custom rules can be deleted.</p>${usesPercentageThreshold(rule.metric) ? `<label class="rule-threshold">${rule.metric === 'cpu_percent' ? 'CPU usage reaches' : 'Memory usage reaches'} <input type="number" min="0" step="0.1" data-rule-threshold="${escapeHtml(rule.id)}" value="${Number(rule.threshold)}"><span>%</span></label><label class="rule-sustain">Sustain breach for<select data-rule-sustain="${escapeHtml(rule.id)}"><option value="0" ${Number(rule.sustain_minutes || 0) === 0 ? 'selected' : ''}>Immediately</option><option value="5" ${Number(rule.sustain_minutes || 0) === 5 ? 'selected' : ''}>5 minutes</option><option value="10" ${Number(rule.sustain_minutes || 0) === 10 ? 'selected' : ''}>10 minutes</option><option value="15" ${Number(rule.sustain_minutes || 0) === 15 ? 'selected' : ''}>15 minutes</option></select></label>` : `<p class="rule-event-condition">${escapeHtml(conditionLabel(rule.metric, rule.threshold))}</p>`}<label class="rule-scope">Apply to<select data-rule-scope="${escapeHtml(rule.id)}"><option value="all" ${(!rule.scope_type || rule.scope_type === 'all') ? 'selected' : ''}>All monitored pods</option><option value="pod" ${rule.scope_type === 'pod' ? 'selected' : ''}>One specific pod</option><option value="name_contains" ${rule.scope_type === 'name_contains' ? 'selected' : ''}>Pod name contains</option></select></label><label class="rule-scope-value" ${(!rule.scope_type || rule.scope_type === 'all') ? 'hidden' : ''}>Pod / match<input list="rule-pods-${escapeHtml(rule.id)}" data-rule-scope-value="${escapeHtml(rule.id)}" value="${escapeHtml(rule.scope_value || '')}" placeholder="${rule.scope_type === 'name_contains' ? 'e.g. backend' : 'Choose or enter pod'}"><datalist id="rule-pods-${escapeHtml(rule.id)}">${pods.map(name => `<option value="${escapeHtml(name)}">`).join('')}</datalist></label><div class="rule-actions"><button class="save-rule" data-rule-save="${escapeHtml(rule.id)}">Save changes</button><button type="button" data-rule-toggle="${escapeHtml(rule.id)}" data-rule-enable="${rule.enabled ? 'false' : 'true'}">${rule.enabled ? 'Disable rule' : 'Enable rule'}</button>${rule.id.startsWith('custom-') || rule.id.startsWith('log-pattern-') ? `<button type="button" class="danger-action" data-rule-delete="${escapeHtml(rule.id)}">Delete rule</button>` : ''}</div></div>` : `<p class="rule-view-only">${rule.enabled ? 'Enabled' : 'Disabled'} · ${escapeHtml(conditionLabel(rule.metric, rule.threshold))}${usesPercentageThreshold(rule.metric) && Number(rule.sustain_minutes || 0) ? ` sustained for ${Number(rule.sustain_minutes)} minutes` : ''} · ${escapeHtml(scopeLabel(rule))} · Administrator managed</p>`}
  </article>`).join('');
  document.querySelectorAll('[data-rule-scope]').forEach(select => select.addEventListener('change', () => {
    const input = document.querySelector(`[data-rule-scope-value="${CSS.escape(select.dataset.ruleScope)}"]`);
    if (input?.parentElement) input.parentElement.hidden = select.value === 'all';
    if (input) input.placeholder = select.value === 'name_contains' ? 'e.g. backend' : 'Choose or enter pod';
  }));
  document.querySelectorAll('[data-rule-toggle]').forEach(button => button.addEventListener('click', () => {
    const checkbox = document.querySelector(`[data-rule-enabled="${CSS.escape(button.dataset.ruleToggle)}"]`);
    if (checkbox) checkbox.checked = button.dataset.ruleEnable === 'true';
    document.querySelector(`[data-rule-save="${CSS.escape(button.dataset.ruleToggle)}"]`)?.click();
  }));
  document.querySelectorAll('[data-rule-delete]').forEach(button => button.addEventListener('click', async () => {
    if (!window.confirm('Delete this custom alert rule? This cannot be undone.')) return;
    button.disabled = true; button.textContent = 'Deleting…';
    try {
      const response = await fetch(`/api/alert-rules/${encodeURIComponent(button.dataset.ruleDelete)}`, { method: 'DELETE' });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.detail || 'Unable to delete the alert rule.');
      await load();
    } catch (error) { button.disabled = false; button.textContent = 'Delete rule'; window.alert(error.message); }
  }));
  document.querySelectorAll('[data-rule-save]').forEach(button => button.addEventListener('click', async () => {
    const id = button.dataset.ruleSave;
    const enabled = document.querySelector(`[data-rule-enabled="${CSS.escape(id)}"]`).checked;
    const metric = document.querySelector(`[data-rule-id="${CSS.escape(id)}"]`)?.dataset.ruleMetric || 'errors';
    const threshold = usesPercentageThreshold(metric) ? Number(document.querySelector(`[data-rule-threshold="${CSS.escape(id)}"]`).value) : 1;
    const sustain_minutes = usesPercentageThreshold(metric) ? Number(document.querySelector(`[data-rule-sustain="${CSS.escape(id)}"]`).value) : 0;
    const scope_type = document.querySelector(`[data-rule-scope="${CSS.escape(id)}"]`).value;
    const scope_value = document.querySelector(`[data-rule-scope-value="${CSS.escape(id)}"]`).value.trim();
    button.textContent = 'Saving…';
    try {
      const response = await fetch(`/api/alert-rules/${encodeURIComponent(id)}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ enabled, threshold, sustain_minutes, scope_type, scope_value }) });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.detail || 'Unable to save alert rule.');
      button.textContent = 'Saved';
      setTimeout(load, 450);
    } catch (error) {
      button.textContent = 'Save changes';
      window.alert(error.message);
    }
  }));
}

function renderAccessUsers(users) {
  const target = document.querySelector('#access-users');
  if (!target) return;
  const role = target.querySelector('#user-role-filter')?.value || 'all';
  const filtered = users.filter(user => role === 'all' || user.role === role).sort((left, right) => String(left.name || '').localeCompare(String(right.name || '')));
  const rows = filtered.map(user => `<tr class="${user.enabled === false ? 'user-disabled' : ''}"><td><input type="checkbox" data-user-select="${escapeHtml(user.email)}" ${selectedAccessUserEmail === user.email ? 'checked' : ''} aria-label="Select ${escapeHtml(user.name)}"></td><td>${escapeHtml(user.name)}</td><td>${escapeHtml(user.email)}</td><td>${escapeHtml(roleLabel(user.role))}</td><td><span class="${severityClass(user.enabled === false ? 'critical' : 'healthy')}">${user.enabled === false ? 'Disabled' : 'Active'}</span></td><td>${user.created_at ? new Date(user.created_at).toLocaleDateString() : '—'}</td></tr>`).join('');
  target.innerHTML = `<div class="inventory-controls"><label>Role <select id="user-role-filter"><option value="all" ${role === 'all' ? 'selected' : ''}>All roles</option><option value="administrator" ${role === 'administrator' ? 'selected' : ''}>Administrators</option><option value="developer" ${role === 'developer' ? 'selected' : ''}>Developers / Operators</option><option value="readonly" ${role === 'readonly' ? 'selected' : ''}>Read-only</option></select></label><button id="open-selected-user" ${selectedAccessUserEmail ? '' : 'disabled'}>Open selected profile</button><button id="export-users">Export CSV</button></div><div class="table-wrap"><table><thead><tr><th>Select</th><th>Name</th><th>Login</th><th>Role</th><th>Access</th><th>Created</th></tr></thead><tbody>${rows || '<tr><td colspan="6">No matching users.</td></tr>'}</tbody></table></div>`;
  target.querySelector('#user-role-filter').addEventListener('change', () => renderAccessUsers(users));
  target.querySelector('#export-users').addEventListener('click', () => {
    const csv = ['Name,Login,Role,Access,Source,Created', ...filtered.map(user => [user.name, user.email, user.role, user.enabled === false ? 'Disabled' : 'Active', user.source, user.created_at].map(value => `"${String(value || '').replaceAll('"', '""')}"`).join(','))].join('\n');
    const link = Object.assign(document.createElement('a'), { href: URL.createObjectURL(new Blob([csv], { type: 'text/csv' })), download: `l1controlscope-users-${new Date().toISOString().slice(0, 10)}.csv` });
    link.click();
    URL.revokeObjectURL(link.href);
  });
  target.querySelectorAll('[data-user-select]').forEach(select => select.addEventListener('change', () => { selectedAccessUserEmail = select.checked ? select.dataset.userSelect : ''; renderAccessUsers(users); }));
  target.querySelector('#open-selected-user').addEventListener('click', () => showUserProfile(selectedAccessUserEmail));
}

function renderUserProfile(user) {
  const target = document.querySelector('#access-user-profile');
  if (!target) return;
  target.hidden = false;
  const locked = user.locked_until && new Date(user.locked_until).getTime() > Date.now();
  target.innerHTML = `<div class="profile-card"><div><p class="eyebrow">USER PROFILE</p><h3>${escapeHtml(user.name)}</h3><p>${escapeHtml(user.email)}</p></div><button class="profile-close" type="button" aria-label="Close profile">×</button><dl><div><dt>Role</dt><dd>${escapeHtml(roleLabel(user.role))}</dd></div><div><dt>Access</dt><dd>${user.enabled === false ? 'Disabled' : 'Active'}</dd></div><div><dt>Sign-in protection</dt><dd>${locked ? `Locked until ${new Date(user.locked_until).toLocaleString()}` : 'No active lock'}</dd></div><div><dt>Source</dt><dd>${escapeHtml(user.source || 'local')}</dd></div><div><dt>Created</dt><dd>${user.created_at ? new Date(user.created_at).toLocaleString() : '—'}</dd></div></dl><div class="profile-actions"><label>Change role<select id="profile-user-role"><option value="administrator" ${user.role === 'administrator' ? 'selected' : ''}>Administrator</option><option value="developer" ${user.role === 'developer' ? 'selected' : ''}>Developer / Operator</option><option value="readonly" ${user.role === 'readonly' ? 'selected' : ''}>Read-only</option></select></label><button id="profile-save-role">Save role</button><button id="profile-toggle-user">${user.enabled === false ? 'Enable user' : 'Disable user'}</button>${locked ? '<button id="profile-unlock-user">Unlock account</button>' : ''}<button id="profile-delete-user" class="danger-action">Delete user</button></div></div>`;
  target.querySelector('.profile-close').addEventListener('click', () => { target.hidden = true; target.innerHTML = ''; });
  target.querySelector('#profile-save-role').addEventListener('click', () => updateUserRole(user.email, target.querySelector('#profile-user-role').value));
  target.querySelector('#profile-toggle-user').addEventListener('click', () => updateUserStatus(user.email, user.enabled === false));
  if (locked) target.querySelector('#profile-unlock-user').addEventListener('click', () => unlockUser(user.email));
  target.querySelector('#profile-delete-user').addEventListener('click', () => deleteUser(user.email));
  target.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

async function unlockUser(email) {
  try {
    const response = await fetch(`/api/admin/users/${encodeURIComponent(email)}/unlock`, { method: 'PUT' });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.detail || 'Unable to unlock this account.');
    renderUserProfile(payload.user);
    await loadAccessUsers();
    await loadAuditEvents();
  } catch (error) { window.alert(error.message); }
}

function renderAuditEvents(events) {
  const target = document.querySelector('#access-audit-events');
  if (!target) return;
  target.innerHTML = events.length ? `<div class="table-wrap"><table><thead><tr><th>Time</th><th>Administrator</th><th>Change</th><th>Target</th></tr></thead><tbody>${events.map(event => `<tr><td>${new Date(event.timestamp).toLocaleString()}</td><td>${escapeHtml(event.actor)}</td><td>${escapeHtml(String(event.action || '').replaceAll('_', ' '))}</td><td>${escapeHtml(event.target || '—')}</td></tr>`).join('')}</tbody></table></div>` : '<p class="empty">No administrator changes have been recorded yet.</p>';
}

async function loadAuditEvents() {
  if (!isAdministrator()) return;
  try {
    const response = await fetch('/api/admin/audit-events?limit=30');
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.detail || 'Unable to load audit history.');
    renderAuditEvents(payload.events || []);
  } catch (error) {
    const target = document.querySelector('#access-audit-events');
    if (target) target.textContent = error.message;
  }
}

async function showUserProfile(email) {
  try {
    const response = await fetch(`/api/admin/users/${encodeURIComponent(email)}`);
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.detail || 'Unable to load the user profile.');
    renderUserProfile(payload.user);
  } catch (error) { window.alert(error.message); }
}

async function updateUserStatus(email, enabled) {
  const action = enabled ? 'enable' : 'disable';
  if (!window.confirm(`Do you want to ${action} ${email}?`)) return;
  try {
    const response = await fetch(`/api/admin/users/${encodeURIComponent(email)}/status`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ enabled }) });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.detail || `Unable to ${action} the account.`);
    const profile = document.querySelector('#access-user-profile');
    if (profile) { profile.hidden = true; profile.innerHTML = ''; }
    await loadAccessUsers();
    await loadAuditEvents();
  } catch (error) { window.alert(error.message); }
}

async function updateUserRole(email, role) {
  if (!window.confirm(`Change ${email} to ${roleLabel(role)}? The user will need to sign in again.`)) { await loadAccessUsers(); return; }
  try {
    const response = await fetch(`/api/admin/users/${encodeURIComponent(email)}/role`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ role }) });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.detail || 'Unable to change the user role.');
    await loadAccessUsers();
    await loadAuditEvents();
  } catch (error) { window.alert(error.message); await loadAccessUsers(); }
}

async function deleteUser(email) {
  if (!window.confirm(`Delete ${email} permanently? This cannot be undone.`)) return;
  try {
    const response = await fetch(`/api/admin/users/${encodeURIComponent(email)}`, { method: 'DELETE' });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.detail || 'Unable to delete the account.');
    if (selectedAccessUserEmail === email) selectedAccessUserEmail = '';
    const profile = document.querySelector('#access-user-profile');
    if (profile) { profile.hidden = true; profile.innerHTML = ''; }
    await loadAccessUsers();
    await loadAuditEvents();
  } catch (error) { window.alert(error.message); }
}

async function loadAccessUsers() {
  const target = document.querySelector('#access-users');
  try {
    const response = await fetch('/api/admin/users');
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.detail || 'Unable to load users.');
    renderAccessUsers(payload.users || []);
    loadAuditEvents();
  } catch (error) {
    target.textContent = error.message;
  }
}

function jsonLogExplorer(records) {
  if (!records.length) return '<p class="empty">No logs returned.</p>';
  const selected = Number.isInteger(selectedLogIndex) && selectedLogIndex >= 0 && selectedLogIndex < records.length ? selectedLogIndex : records.length - 1;
  const context = records.slice(Math.max(0, selected - 5), selected + 1);
  const recent = records.slice(Math.max(0, records.length - 25)).reverse();
  return `<div class="log-json-layout"><div class="log-event-list"><div class="log-list-heading"><strong>Recent events</strong><small>Choose an event for context</small></div>${recent.map(record => `<button class="log-event ${record.index === selected ? 'active' : ''}" data-log-index="${record.index}"><span class="${severityClass(record.level === 'warn' ? 'warning' : record.level === 'error' || record.level === 'critical' ? 'critical' : 'healthy')}">${escapeHtml(record.level)}</span><strong>${escapeHtml(record.timestamp || `Entry ${record.index + 1}`)}</strong><small>${escapeHtml(record.message)}</small></button>`).join('')}</div><div class="json-context"><div class="log-list-heading"><strong>Structured JSON</strong><small>Selected event + ${context.length - 1} preceding log entr${context.length - 1 === 1 ? 'y' : 'ies'}</small></div><pre class="large-log">${escapeHtml(JSON.stringify(context, null, 2))}</pre></div></div>`;
}

function renderDetails(pod, logs, records) {
  const commands = {
    terminal: `docker exec -it ${pod.name} /bin/sh`,
    inspect: `docker inspect ${pod.name}`,
    restart: `docker restart ${pod.name}`,
  };
  const analysis = data.analysis[pod.name] || { severity: 'healthy', counts: { errors: 0, warnings: 0, oom_events: 0 }, findings: ['No health findings are available yet.'] };
  const healthStatus = pod.risk === 'critical' ? 'critical' : analysis.severity === 'warning' || pod.risk === 'warning' ? 'warning' : 'healthy';
  const content = {
    overview: `<div class="detail-grid"><div class="detail-metric"><span>Memory</span><strong>${pod.memory_mib} MiB</strong><small>${pod.memory_percent}% of available container memory</small></div><div class="detail-metric"><span>CPU</span><strong>${pod.cpu_percent}%</strong><small>${pod.cpu_millicores} millicores</small></div><div class="detail-metric"><span>Restarts</span><strong>${pod.restarts}</strong><small>Since container start</small></div><div class="detail-metric"><span>Ports</span><strong>${escapeHtml(pod.ports || 'None')}</strong><small>Published local ports</small></div></div><div class="metadata"><span>Container ID <b>${escapeHtml(pod.container_id || 'Not available')}</b></span><span>Image <b>${escapeHtml(pod.image || 'Not available')}</b></span><span>Created <b>${escapeHtml(pod.created_at || 'Not available')}</b></span></div>`,
    health: `<div class="detail-grid health-grid"><div class="detail-metric"><span>Runtime status</span><strong><span class="${severityClass(healthStatus)}">${escapeHtml(pod.status)}</span></strong><small>Current pod/container state</small></div><div class="detail-metric"><span>Health rating</span><strong><span class="${severityClass(healthStatus)}">${escapeHtml(healthStatus)}</span></strong><small>From runtime and recent signals</small></div><div class="detail-metric"><span>Error signals</span><strong>${analysis.counts.errors}</strong><small>In the latest log sample</small></div><div class="detail-metric"><span>Warning signals</span><strong>${analysis.counts.warnings}</strong><small>In the latest log sample</small></div></div><div class="health-findings"><strong>Operational findings</strong><ul>${analysis.findings.map(item => `<li>${escapeHtml(item)}</li>`).join('')}</ul><small>Raw events and JSON context are available in the separate Pod Logs explorer.</small></div>`,
    correlation: `<div class="detail-grid"><div class="detail-metric"><span>Active alerts</span><strong>${data.alerts.filter(item => item.pod === pod.name).length}</strong><small>Current alert queue entries</small></div><div class="detail-metric"><span>Recent events</span><strong>${(observabilityData.events || []).filter(item => item.pod === pod.name).length}</strong><small>Within the selected time range</small></div><div class="detail-metric"><span>Log errors</span><strong>${analysis.counts.errors}</strong><small>Current masked log sample</small></div><div class="detail-metric"><span>Memory forecast</span><strong>${data.forecasts.find(item => item.pod === pod.name)?.forecast_percent ?? pod.memory_percent}%</strong><small>Projected or current usage</small></div></div><div class="health-findings"><strong>Correlated evidence</strong><ul>${(observabilityData.events || []).filter(item => item.pod === pod.name).slice(0, 4).map(item => `<li>${escapeHtml(item.title)} — ${escapeHtml(item.detail || 'Live monitoring event')}</li>`).join('') || '<li>No correlated status, restart, deployment, or alert event in this selected range.</li>'}</ul><small>Use the Pod Logs explorer to open safe JSON context for matching log signals.</small></div>`,
    terminal: `<div class="terminal-note"><strong>Terminal access is intentionally not embedded in the dashboard.</strong><p>Copy the command below and run it on your own computer. This keeps the monitoring app read-only and protects your local machine.</p></div>${command('Open shell inside this container', commands.terminal, 'Use Ctrl+D or type exit when finished')}`,
    inspect: `${command('Show full Docker configuration', commands.inspect, 'Includes environment, image, networking, mounts, and state')}<div class="inspect-summary"><span>Image: <b>${escapeHtml(pod.image || 'Not available')}</b></span><span>Ports: <b>${escapeHtml(pod.ports || 'None')}</b></span><span>Node: <b>${escapeHtml(pod.node)}</b></span></div>`,
    actions: `<div class="terminal-note warning-note"><strong>Container actions are manual by design.</strong><p>The dashboard will not restart containers itself. Copy the command only when you intend to restart this local service.</p></div>${command('Restart this container', commands.restart, 'This briefly interrupts this service')}`,
  };
  if (['logs', 'terminal', 'inspect'].includes(activeTab)) activeTab = 'health';
  document.querySelector('#details').innerHTML = `<nav class="detail-tabs">${[['overview', 'Overview'], ['health', 'Health'], ['correlation', 'Correlate'], ['actions', 'Actions']].map(([key, label]) => `<button class="detail-tab ${activeTab === key ? 'active' : ''}" data-tab="${key}">${label}</button>`).join('')}</nav><div class="tab-content">${content[activeTab]}</div>`;
  document.querySelectorAll('.detail-tab').forEach(button => button.addEventListener('click', () => { activeTab = button.dataset.tab; renderDetails(pod, logs, records); }));
  document.querySelectorAll('[data-log-index]').forEach(button => button.addEventListener('click', () => {
    selectedLogIndex = Number(button.dataset.logIndex);
    renderDetails(pod, logs, records);
  }));
  document.querySelectorAll('.copy-command').forEach(button => button.addEventListener('click', async () => {
    await navigator.clipboard.writeText(button.dataset.command);
    button.textContent = 'Copied';
    setTimeout(() => { button.textContent = 'Copy'; }, 1600);
  }));
}

function selectPod(name, resetTab = true) {
  const previousPod = selectedPodName;
  selectedPodName = name;
  if (resetTab) activeTab = 'overview';
  const pod = data.pods.find(item => item.name === name);
  const forecast = data.forecasts.find(item => item.pod === name);
  const analysis = data.analysis[name];
  const logs = data.logs[name] || [];
  const records = data.structured_logs?.[name] || [];
  if (previousPod !== name || !Number.isInteger(selectedLogIndex)) selectedLogIndex = records.length - 1;
  renderPods(data.pods);
  document.querySelector('#details-title').textContent = pod.name;
  document.querySelector('#details-status').innerHTML = `<span class="${severityClass(pod.risk)}">${pod.status}</span>`;
  const forecastHeadline = forecast.available ? `${forecast.forecast_percent}%` : `${forecast.current_percent}%`;
  const forecastLabel = forecast.available ? 'projected memory usage in 15 minutes' : 'live memory usage';
  const forecastDetail = forecast.available ? `${forecast.forecast_memory_mib} MiB projected from ${forecast.samples} Prometheus readings` : `${forecast.current_memory_mib} MiB of ${forecast.limit_mib} MiB`;
  document.querySelector('#forecast').innerHTML = `<p class="selected-data-scope">Selected pod: <b>${escapeHtml(pod.name)}</b></p><div class="forecast ${forecast.available ? forecast.forecast_risk : forecast.risk}"><div><strong>${forecastHeadline}</strong><span>${forecastLabel}</span></div><p>${forecastDetail} · ${escapeHtml(forecast.message)}</p></div>${memoryTimeline(forecast)}`;
  document.querySelector('#analysis').innerHTML = `<p class="selected-data-scope">Selected pod: <b>${escapeHtml(pod.name)}</b></p><span class="${severityClass(analysis.severity)}">${analysis.severity}</span><ul>${analysis.findings.map(item => `<li>${escapeHtml(item)}</li>`).join('')}</ul><p class="muted">Errors ${analysis.counts.errors} · Warnings ${analysis.counts.warnings} · OOM ${analysis.counts.oom_events}</p><p class="muted">Use Centralised Log Explorer for searchable, masked JSON log records and context.</p>`;
  renderDetails(pod, logs, records);
}

async function load(preservePausedLogs = false) {
  try {
    const [response, historyResponse, alertHistoryResponse, readinessResponse] = await Promise.all([fetch('/api/overview'), fetch(`/api/observability/history?minutes=${observabilityMinutes}`), fetch('/api/alert-history'), fetch('/ready')]);
    const payload = await response.json();
    const historyPayload = historyResponse.ok ? await historyResponse.json() : observabilityData;
    const alertHistoryPayload = alertHistoryResponse.ok ? await alertHistoryResponse.json() : { events: [] };
    sourceHealth = await readinessResponse.json().catch(() => ({ status: 'checking', collector: {} }));
    if (!response.ok) throw new Error(payload.detail || 'Live telemetry is unavailable.');
    data = payload;
    await restoreSharedInvestigation();
    acknowledgedAlerts = data.alert_acknowledgements || {};
    alertHistory = alertHistoryPayload.events || [];
    renderSummary(data.summary); renderPlatformHealth(data.summary, data.alerts); if (!document.querySelector('#assistant-form')) renderAssistant(); renderObservability(historyPayload); renderOverviewFocus(data, historyPayload); renderWorkloads(data.inventory); renderDeploymentInspector(data.deployments || []); if (!preservePausedLogs || logExplorerLiveTail) renderLogExplorer(); renderAlerts(data.alerts); renderAlertHistory(alertHistory); renderIncidentEvidence(data.incident_evidence || []); renderAlertRules(data.alert_rules || []);
    document.querySelector('#mode').textContent = data.mode === 'docker' ? 'Local Docker connected' : data.mode === 'splunk' ? 'Splunk external source' : 'Kubernetes connected';
    document.querySelector('#connection').textContent = 'Live';
    document.querySelector('#connection').classList.remove('disconnected');
    const collectedAt = data.collector?.last_collected || data.generated_at;
    const ageSeconds = Math.max(0, Math.round((Date.now() - new Date(collectedAt).getTime()) / 1000));
    const freshness = ageSeconds < 15 ? `Collected ${ageSeconds}s ago` : `Last collected ${Math.round(ageSeconds / 60)}m ago`;
    document.querySelector('#updated').textContent = `${freshness} · auto-refreshes every 30 seconds`;
    document.querySelector('#header-updated').textContent = `${freshness} · auto-refresh 30s`;
    document.body.classList.remove('data-refreshed'); requestAnimationFrame(() => document.body.classList.add('data-refreshed')); setTimeout(() => document.body.classList.remove('data-refreshed'), 900);
    if (!data.pods.length) throw new Error('No containers match the configured MindSpark prefix.');
    selectPod(data.pods.some(pod => pod.name === selectedPodName) ? selectedPodName : data.pods[0].name, false);
    renderDeveloperInvestigation();
  } catch (error) {
    document.querySelector('#summary').innerHTML = `<article class="metric"><strong>Live containers not connected</strong><span>${escapeHtml(error.message)}</span></article>`;
    document.querySelector('#workloads').innerHTML = '';
    document.querySelector('#log-explorer').innerHTML = '';
    if (!document.querySelector('#assistant-form')) renderAssistant();
    document.querySelector('#pods').innerHTML = '';
    document.querySelector('#alerts').innerHTML = '<p class="empty">No live data is displayed until Docker access is available.</p>';
    renderAlertRules([]);
    document.querySelector('#forecast').textContent = 'No live container selected.';
    document.querySelector('#analysis').textContent = 'No live logs available.';
    document.querySelector('#mode').textContent = 'Connection required';
    document.querySelector('#connection').textContent = 'Unavailable';
    document.querySelector('#connection').classList.add('disconnected');
    document.querySelector('#operations-trends').innerHTML = '<p class="empty">Operational trends are unavailable until live monitoring is connected.</p>';
    document.querySelector('#slo-health').textContent = 'No telemetry health calculation is available.';
    document.querySelector('#capacity-ranking').textContent = 'No capacity data is available.';
    document.querySelector('#service-map').textContent = 'No live service map is available.';
    document.querySelector('#dependencies').textContent = 'No dependency data is available.';
    document.querySelector('#event-timeline').textContent = 'No event history is available.';
    document.querySelector('#deployment-inspector-content').textContent = 'No deployment resource data is available.';
  }
}

function startPulseOps() {
ensureDeveloperInvestigationPage();
const navigationHelp = { '#overview': 'Platform summary and what needs attention', '#observability-center': 'Trends, availability, capacity, dependencies, and events', '#deployment-readiness': 'Deployments, services, pods, images, and readiness', '#log-explorer-panel': 'Search and inspect retained pod logs', '#alert-center': 'Active alerts, history, evidence, and rules', '#developer-investigation': 'Correlated developer investigation workspace', '#intelligence-center': 'Evidence-led automated investigation and optional AI', '#url-monitoring': 'Environment URL availability monitoring', '#data-sources': 'Administrator monitoring-source configuration', '#access-center': 'Administrator users, roles, and audit history' };
document.querySelectorAll('.workspace-nav a').forEach(link => { link.title = navigationHelp[link.getAttribute('href')] || link.textContent.trim(); });
document.querySelector('#refresh').addEventListener('click', load);
function applyTheme(theme) {
  const dark = theme === 'dark';
  document.body.dataset.theme = dark ? 'dark' : 'light';
  const themeToggle = document.querySelector('#theme-toggle');
  themeToggle.textContent = dark ? '☀' : '◐';
  themeToggle.title = dark ? 'Use light theme' : 'Use dark theme';
  themeToggle.setAttribute('aria-label', themeToggle.title);
  localStorage.setItem('pulseops-theme', dark ? 'dark' : 'light');
}

applyTheme(localStorage.getItem('pulseops-theme') === 'dark' ? 'dark' : 'light');
document.querySelector('#theme-toggle').addEventListener('click', () => applyTheme(document.body.dataset.theme === 'dark' ? 'light' : 'dark'));
function applyDensity(density) {
  const compact = density === 'compact';
  document.body.dataset.density = compact ? 'compact' : 'comfortable';
  const button = document.querySelector('#density-toggle');
  button.textContent = compact ? 'Compact' : 'Comfortable';
  button.title = compact ? 'Use comfortable density' : 'Use compact density';
  button.setAttribute('aria-label', button.title);
  localStorage.setItem('l1controlscope-density', compact ? 'compact' : 'comfortable');
}
applyDensity(localStorage.getItem('l1controlscope-density') === 'compact' ? 'compact' : 'comfortable');
document.querySelector('#density-toggle').addEventListener('click', () => applyDensity(document.body.dataset.density === 'compact' ? 'comfortable' : 'compact'));
document.querySelector('#assistant-launcher').addEventListener('click', () => setAssistantOpen(true));
document.querySelector('#investigation-close').addEventListener('click', closeInvestigationDrawer);
document.querySelector('#investigation-backdrop').addEventListener('click', closeInvestigationDrawer);
document.addEventListener('keydown', event => { if (event.key === 'Escape' && investigationPodName) closeInvestigationDrawer(); });
document.querySelector('#assistant-runtime-open').addEventListener('click', () => {
  assistantRuntimeOpen = !assistantRuntimeOpen;
  renderAssistant();
  if (assistantRuntimeOpen) loadAssistantRuntime().then(() => renderAssistant());
});
if (!isAdministrator()) document.querySelector('#assistant-runtime-open').hidden = true;
if (!isAdministrator()) document.querySelector('#access-nav').hidden = true;
if (!isAdministrator()) document.querySelector('a[href="#data-sources"]').hidden = true;
if (!isAdministrator()) document.querySelector('.header-more').hidden = true;
if (!isDeveloperOrAdministrator()) {
  document.querySelector('a[href="#log-explorer-panel"]').hidden = true;
  document.querySelector('a[href="#observability-center"]').hidden = true;
  document.querySelector('a[href="#url-monitoring"]').hidden = true;
}
document.querySelector('#url-monitor-refresh').addEventListener('click', loadUrlMonitors);
document.querySelector('#url-monitor-search').addEventListener('input', event => { urlMonitorSearch = event.target.value; renderUrlMonitors(); });
document.querySelector('#url-monitor-status').addEventListener('change', event => { urlMonitorStatus = event.target.value; renderUrlMonitors(); });
if (isAdministrator()) {
  loadAccessUsers();
  loadAuditEvents();
} else {
  const accessPanel = document.querySelector('#access-center');
  if (accessPanel) accessPanel.innerHTML = '<div class="panel-title"><div><p class="eyebrow">ACCESS MANAGEMENT</p><h2>Administrator access required</h2></div></div><p class="panel-description">Your account does not have permission to review user accounts or roles. Contact an L1ControlScope administrator if you need access.</p>';
}
document.querySelector('#export-json').addEventListener('click', exportDashboard);
document.querySelector('#print-report').addEventListener('click', () => window.print());
document.querySelector('[data-slo-review]').addEventListener('click', () => {
  const target = document.querySelector('.event-panel');
  target.scrollIntoView({ behavior: 'smooth', block: 'center' });
  target.classList.remove('panel-focus');
  requestAnimationFrame(() => target.classList.add('panel-focus'));
  setTimeout(() => target.classList.remove('panel-focus'), 1600);
});
function openPanel(target, focusSelector) {
  const panel = document.querySelector(target);
  panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
  panel.classList.remove('panel-focus');
  requestAnimationFrame(() => panel.classList.add('panel-focus'));
  setTimeout(() => panel.classList.remove('panel-focus'), 1600);
  if (focusSelector) setTimeout(() => document.querySelector(focusSelector)?.focus(), 450);
}
document.querySelector('[data-log-evidence]').addEventListener('click', () => openPanel('#log-explorer-panel', '#log-explorer-search'));
document.querySelector('[data-alert-act]').addEventListener('click', () => {
  const alert = [...(data?.alerts || [])].sort((left, right) => severityRank[right.severity] - severityRank[left.severity])[0];
  const button = document.querySelector('[data-alert-act]');
  if (alert?.pod && data?.pods?.some(pod => pod.name === alert.pod)) { openPodInvestigation(alert.pod); return; }
  button.textContent = 'No active alerts';
  setTimeout(() => { button.textContent = 'Act'; }, 1800);
});
document.body.dataset.audience = 'operator';

function pageFromTarget(targetId) {
  const page = targetId === 'observability-center' ? 'operations' : targetId === 'deployment-readiness' || targetId === 'deployment-inspector' || targetId === 'container-monitoring' ? 'workloads' : targetId === 'log-explorer-panel' ? 'logs' : targetId === 'developer-investigation' ? 'investigation' : targetId === 'url-monitoring' ? 'url-monitoring' : targetId === 'data-sources' ? 'data-sources' : targetId === 'access-center' ? 'access' : targetId === 'intelligence-center' ? 'intelligence' : targetId === 'alert-center' ? 'alerts' : 'overview';
  if ((page === 'access' || page === 'data-sources') && !isAdministrator()) return 'overview';
  if ((page === 'logs' || page === 'operations') && !isDeveloperOrAdministrator()) return 'overview';
  return page;
}

function setWorkspacePage(page) {
  document.body.dataset.page = page;
  document.querySelectorAll('[data-workspace-tab], .workspace-nav a').forEach(tab => {
    const targetId = (tab.getAttribute('href') || '#overview').slice(1);
    const selected = pageFromTarget(targetId) === page && !(page === 'overview' && targetId !== 'overview');
    tab.classList.toggle('active', selected);
    if (selected) tab.setAttribute('aria-current', 'page'); else tab.removeAttribute('aria-current');
  });
}

function syncWorkspacePage() { setWorkspacePage(pageFromTarget((window.location.hash || '#overview').slice(1))); }

document.querySelectorAll('[data-workspace-tab], .workspace-nav a').forEach(tab => tab.addEventListener('click', event => {
  event.preventDefault();
  const hash = tab.getAttribute('href') || '#overview';
  window.history.replaceState(null, '', hash);
  setWorkspacePage(pageFromTarget(hash.slice(1)));
  window.scrollTo({ top: 0, behavior: 'smooth' });
}));
window.addEventListener('hashchange', syncWorkspacePage);
syncWorkspacePage();
Promise.all([loadSplunkSettings(), loadPrometheusSettings()]).then(renderDataSources);
loadUrlMonitors();
loadCorrelationIntelligence();
// Keep the navigation sequence operational: workloads, pods, then centralised logs.
const dashboardLayout = document.querySelector('.layout');
dashboardLayout.insertBefore(document.querySelector('#log-explorer-panel'), document.querySelector('#container-monitoring').nextElementSibling);
const deploymentInspectorPanel = document.querySelector('#deployment-inspector');
const serviceMapPanel = document.querySelector('.service-map-panel');
const dependencyPanel = document.querySelector('.dependency-panel');
dashboardLayout.insertBefore(serviceMapPanel, deploymentInspectorPanel.nextElementSibling);
dashboardLayout.insertBefore(dependencyPanel, serviceMapPanel.nextElementSibling);
load();
// Dashboard health refreshes independently. When Live tail is paused, the selected
// log view stays still while alerts, capacity, and workload status continue updating.
setInterval(() => load(true), 30000);
setInterval(loadCorrelationIntelligence, 30000);
}

async function checkAuthentication() {
  const loginScreen = document.querySelector('#login-screen');
  const response = await fetch('/api/auth/me');
  const result = await response.json();
  breakGlassSetupAvailable = Boolean(result.break_glass_setup_available);
  breakGlassEnabled = Boolean(result.break_glass_enabled);
  breakGlassUsername = result.break_glass_username || 'admin';
  document.querySelector('#admin-login-toggle').hidden = !breakGlassEnabled;
  document.querySelector('#oidc-login').hidden = !result.oidc_available;
  if (!result.user) return;
  currentUser = result.user;
  loginScreen.classList.add('hidden');
  document.querySelector('#current-user').textContent = `Signed in: ${result.user.email} · ${roleLabel(result.user.role)}`;
  startPulseOps();
}

function setAdministratorLoginMode(enabled) {
  administratorLoginMode = enabled;
  const identity = document.querySelector('#login-email');
  const message = document.querySelector('#login-message');
  document.querySelector('#login-identity-label').innerHTML = enabled ? `Administrator username <input id="login-email" type="text" required value="${escapeHtml(breakGlassUsername)}" readonly>` : 'Company email <input id="login-email" type="text" required placeholder="name@db.com">';
  document.querySelector('#login-password-label').innerHTML = enabled ? 'Administrator password <input id="login-password" type="password" required minlength="12" placeholder="Enter or set a strong password">' : 'Password <input id="login-password" type="password" required minlength="10" placeholder="At least 10 characters">';
  document.querySelector('#admin-login-toggle').textContent = enabled ? 'Use company-user sign in' : 'Administrator sign in';
  message.textContent = enabled ? (breakGlassSetupAvailable ? 'First administrator setup: choose a strong password with at least 12 characters.' : 'Use the administrator password configured by your system administrator.') : 'First time here? Enter your company email and choose a password to create your account.';
  message.classList.remove('error');
}

document.querySelector('#admin-login-toggle').addEventListener('click', () => setAdministratorLoginMode(!administratorLoginMode));
document.querySelector('#oidc-login').addEventListener('click', () => { window.location.assign('/api/auth/oidc/login'); });
document.querySelector('#login-email').addEventListener('input', event => {
  if (breakGlassEnabled && !administratorLoginMode && event.target.value.trim().toLowerCase() === breakGlassUsername.toLowerCase()) setAdministratorLoginMode(true);
});

document.querySelector('#login-form').addEventListener('submit', async event => {
  event.preventDefault();
  const email = document.querySelector('#login-email').value.trim();
  const password = document.querySelector('#login-password').value;
  const name = '';
  const message = document.querySelector('#login-message');
  const payload = { email, password, name };
  let response = await fetch('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
  if (administratorLoginMode && response.status === 401 && breakGlassSetupAvailable) response = await fetch('/api/auth/bootstrap-admin', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }) });
  if (!administratorLoginMode && response.status === 401) response = await fetch('/api/auth/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
  const result = await response.json();
  if (!response.ok) {
    message.textContent = result.detail || 'Unable to sign in.';
    message.classList.add('error');
    return;
  }
  message.classList.remove('error');
  currentUser = result.user;
  document.querySelector('#login-screen').classList.add('hidden');
  document.querySelector('#current-user').textContent = `Signed in: ${result.user.email} · ${roleLabel(result.user.role)}`;
  startPulseOps();
});

document.querySelector('#logout').addEventListener('click', async () => {
  await fetch('/api/auth/logout', { method: 'POST' });
  window.location.reload();
});

checkAuthentication().catch(() => {
  const message = document.querySelector('#login-message');
  message.textContent = 'PulseOps login is unavailable. Check the application service.';
  message.classList.add('error');
});
