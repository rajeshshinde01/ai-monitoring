const severityRank = { healthy: 0, warning: 1, critical: 2 };
let data;
let currentUser = null;
const isAdministrator = () => currentUser?.role === 'administrator';
const isDeveloperOrAdministrator = () => ['administrator', 'developer'].includes(currentUser?.role);
const isReadOnly = () => currentUser?.role === 'readonly';
const roleLabel = role => role === 'administrator' ? 'Administrator' : role === 'readonly' ? 'Read-only' : 'Developer / Operator';
function renderCurrentUser(user) {
  const badge = document.querySelector('#current-user');
  if (!badge || !user) return;
  const identity = String(user.name || user.email || 'Signed in').split('@')[0];
  badge.textContent = `${identity} · ${roleLabel(user.role)}`;
  badge.title = user.email || identity;
}
function renderWelcomeBanner(summary) {
  const name = String(currentUser?.name || currentUser?.email || 'there').split('@')[0].replace(/[._-]+/g, ' ').replace(/\b\w/g, letter => letter.toUpperCase());
  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
  const alerts = Number(summary?.alerts || 0);
  const eyebrow = document.querySelector('#welcome-eyebrow');
  const title = document.querySelector('#welcome-title');
  const copy = document.querySelector('#welcome-copy');
  if (!eyebrow || !title || !copy) return;
  eyebrow.textContent = `${greeting.toUpperCase()} · YOUR OPERATIONS WORKSPACE`;
  title.textContent = `${greeting}, ${name}.`;
  copy.textContent = alerts ? `${alerts} item${alerts === 1 ? '' : 's'} need${alerts === 1 ? 's' : ''} attention. Start with the highlighted operational findings below.` : 'Everything currently monitored is stable. Review recent changes or investigate a workload whenever you need more detail.';
}
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
let logExplorerBefore = 20;
let logExplorerAfter = 5;
let logExplorerLiveTail = true;
let logExplorerStreamScope = 'all';
let errorSignatureScope = 'all';
let directTailSource = null;
let directTailPod = '';
let directTailStatus = 'Stopped';
let directTailRecords = [];
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
let accessUserSearch = '';
let acknowledgedAlerts = {};
let alertHistory = [];
let alertHistoryReport = { windows: { '7d': {}, '30d': {} }, retained_events: 0, collecting: true };
let alertFilter = 'all';
let sourceHealth = { status: 'checking', collector: {} };
let urlMonitorEnvironment = 'dev';
let urlMonitors = [];
let urlMonitorSearch = '';
let urlMonitorStatus = 'all';
let urlMonitorActionMenu = '';
let urlMonitorEditingId = '';
let urlMonitorHistory = {};
let urlMonitorHistoryHours = 24;
let serviceHealthReport = null;
let favouriteApplications = new Set();
let correlationIntelligence = null;
let developerInvestigationPod = '';
let developerInvestigationWorkspace = null;
let sharedInvestigationRestored = false;
let incidentReplayIndex = -1;
let incidentReplayTimer = null;
let notificationSettings = null;
let investigationAdvancedOpen = true;

function renderCorrelationIntelligence() {
  const target = document.querySelector('#correlation-intelligence');
  if (!target) return;
  if (!correlationIntelligence) { target.className = 'correlation-intelligence empty'; target.textContent = 'Reviewing current operational signals…'; return; }
  const summary = correlationIntelligence.summary || {};
  const incidents = correlationIntelligence.incidents || [];
  const needsAction = incidents.length > 0;
  const assessment = needsAction
    ? { label: 'Review recommended', detail: `${summary.total || incidents.length} operational finding${(summary.total || incidents.length) === 1 ? '' : 's'} currently need${(summary.total || incidents.length) === 1 ? 's' : ''} review.` }
    : { label: 'No action needed', detail: 'No current signal combination requires an investigation.' };
  const timeline = correlationIntelligence.operational_timeline || [];
  const timelineLabels = { deployment: 'Deployment', runtime: 'Runtime', restart: 'Restart', health: 'Health', alert: 'Alert', log: 'Log signal' };
  const timelineHtml = `<section class="intelligence-timeline"><header><div><span>CHANGE DETECTION</span><h3>What changed recently</h3><p>Deployment, runtime, restart, health, alert, and log changes from the retained 24-hour evidence window.</p></div><small>${timeline.length ? `${timeline.length} recent event${timeline.length === 1 ? '' : 's'}` : 'No recent changes'}</small></header>${timeline.length ? `<div>${timeline.map(item => `<article class="${escapeHtml(item.severity || 'healthy')}"><time>${new Date(Number(item.timestamp) * 1000).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</time><span>${escapeHtml(timelineLabels[item.kind] || 'Change')}</span><div><b>${escapeHtml(item.title)}</b><p>${escapeHtml(item.detail || 'No additional context was recorded.')}</p></div>${item.pod ? `<button type="button" data-correlation-pod="${escapeHtml(item.pod)}">Review</button>` : '<i aria-hidden="true"></i>'}</article>`).join('')}</div>` : '<p class="intelligence-timeline-empty">No deployment, runtime, restart, health, alert, or log change has been recorded in the current evidence window.</p>'}</section>`;
  const verdicts = correlationIntelligence.deployment_verdicts || [];
  const recoveries = correlationIntelligence.recoveries || [];
  const durationLabel = seconds => seconds < 60 ? `${seconds}s` : seconds < 3600 ? `${Math.round(seconds / 60)}m` : `${Math.round(seconds / 3600)}h`;
  const outcomesHtml = `<section class="intelligence-outcomes"><article><header><span>RELEASE IMPACT</span><h3>Deployment verdicts</h3></header>${verdicts.length ? `<div class="deployment-verdict-list">${verdicts.map(item => `<div class="${escapeHtml(item.status)}"><b>${escapeHtml(item.workload)}</b><strong>${escapeHtml(item.verdict)}</strong><p>${escapeHtml(item.detail)}</p></div>`).join('')}</div>` : '<p>No deployment change has been observed yet. A verdict will appear automatically after the next release.</p>'}</article><article><header><span>RECOVERY DETECTION</span><h3>Recovered automatically</h3></header>${recoveries.length ? `<div class="recovery-list">${recoveries.map(item => `<button type="button" data-correlation-pod="${escapeHtml(item.pod)}"><span>✓</span><div><b>${escapeHtml(item.pod)}</b><p>${escapeHtml(item.issue)} → ${escapeHtml(item.recovery)}</p><small>Recovered after ${durationLabel(Number(item.duration_seconds || 0))}</small></div></button>`).join('')}</div>` : '<p>No recovery transition has been recorded in the current evidence window.</p>'}</article></section>`;
  target.className = 'correlation-intelligence';
  target.innerHTML = `<section class="correlation-overview"><div class="correlation-assessment ${needsAction ? 'attention' : 'clear'}"><span>Current assessment</span><strong>${assessment.label}</strong><small>${assessment.detail}</small></div><div><span>Open investigations</span><strong>${summary.total || 0}</strong><small>Ranked by operational impact</small></div><div><span>Critical findings</span><strong>${summary.critical || 0}</strong><small>Need immediate review</small></div><div class="correlation-trust"><b>Based on current evidence</b><small>Automated rules · AI is not required</small></div></section>${outcomesHtml}${timelineHtml}${incidents.length ? `<div class="correlation-list">${incidents.map((item, index) => `<article class="correlation-card ${escapeHtml(item.severity)}"><header><div><span class="correlation-rank">${String(index + 1).padStart(2, '0')}</span><div><small>${escapeHtml(item.environment?.toUpperCase() || 'PLATFORM')} · IMPACT ${item.score}/100</small><h3>${escapeHtml(item.title)}</h3><p>${escapeHtml(item.summary)}</p></div></div><span class="status ${item.severity}">${escapeHtml(item.severity)}</span></header><div class="correlation-body"><section><span>LIKELY CAUSE</span><p>${escapeHtml(item.probable_cause)}</p><span>OBSERVED EVIDENCE</span><ul>${item.evidence.map(value => `<li>${escapeHtml(value)}</li>`).join('')}</ul></section><aside><div class="confidence"><span style="width:${item.confidence}%"></span></div><small>${item.confidence}% evidence strength</small><b>Recommended next action</b><p>${escapeHtml(item.recommendation)}</p>${item.pod ? `<button type="button" data-correlation-pod="${escapeHtml(item.pod)}">Review this pod</button>` : `<button type="button" data-correlation-urls>Review URL monitoring</button>`}</aside></div></article>`).join('')}</div>` : '<div class="correlation-clear"><span>✓</span><div><strong>No findings need review right now</strong><p>Current URL, deployment, pod, capacity, and log signals do not require action.</p></div></div>'}`;
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
  const page = targetId === 'operations' || targetId === 'observability-center' ? 'overview' : targetId === 'workloads' || targetId === 'deployment-readiness' || targetId === 'deployment-inspector' || targetId === 'container-monitoring' ? 'workloads' : targetId === 'pod-logs' || targetId === 'log-explorer-panel' ? 'logs' : targetId === 'developer-investigation' ? 'investigation' : targetId === 'url-monitoring' ? 'url-monitoring' : targetId === 'service-health' ? 'service-health' : targetId === 'data-sources' ? 'data-sources' : targetId === 'access' || targetId === 'access-center' ? 'access' : targetId === 'intelligence' || targetId === 'intelligence-center' ? 'intelligence' : targetId === 'alerts' || targetId === 'alert-center' ? 'alerts' : 'overview';
  if ((page === 'access' || page === 'data-sources') && !isAdministrator()) return 'overview';
  if ((page === 'logs' || page === 'operations' || page === 'service-health') && !isDeveloperOrAdministrator()) return 'overview';
  return page;
}

function serviceHealthValue(value, suffix = '') {
  return value == null ? '—' : `${Number(value).toFixed(2).replace(/\.00$/, '')}${suffix}`;
}

function renderServiceHealth(report) {
  const target = document.querySelector('#service-health-content');
  const updated = document.querySelector('#service-health-updated');
  if (!target) return;
  if (!report) {
    target.className = 'service-health-content empty';
    target.textContent = 'Service health is not available yet.';
    return;
  }
  const coverage = report.coverage || {};
  const availability = report.availability || {};
  const incidents = report.incidents || {};
  const releases = report.releases || {};
  const targetPercent = Number(report.availability_target_percent || 99.5);
  const availabilityState = availability.percent == null ? 'collecting' : availability.meets_target ? 'healthy' : 'warning';
  const coverageText = coverage.collecting
    ? `${serviceHealthValue(coverage.observed_hours, 'h')} collected of ${coverage.requested_hours || 720}h requested`
    : `Full ${report.period_days || 30}-day evidence window collected`;
  if (updated) updated.textContent = coverageText;
  const endpointRows = (report.endpoints || []).map(item => {
    const state = !item.enabled ? 'disabled' : item.current_status === 'down' ? 'critical' : item.current_status === 'degraded' || item.availability_percent == null || !item.meets_target ? 'warning' : 'healthy';
    const availabilityText = item.availability_percent == null ? 'Collecting' : `${serviceHealthValue(item.availability_percent, '%')}`;
    const latest = item.last_checked ? new Date(item.last_checked).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }) : 'No completed check yet';
    return `<tr><td><strong>${escapeHtml(item.name)}</strong><small>${escapeHtml(String(item.environment || '').toUpperCase())}</small></td><td><span class="status ${state}"><i></i>${escapeHtml(item.enabled ? (item.current_status || 'collecting') : 'disabled')}</span></td><td><strong>${availabilityText}</strong><small>${item.checks || 0} retained checks</small></td><td><small>${escapeHtml(latest)}</small></td></tr>`;
  }).join('') || '<tr><td colspan="4" class="service-health-empty-row">No URL endpoints are configured. Add an approved URL in URL Monitoring to begin availability reporting.</td></tr>';
  const attention = (report.attention || []).filter(item => item.enabled).slice(0, 3);
  const environmentRows = (report.environments || []).map(item => {
    const state = item.availability_percent == null ? 'warning' : item.attention ? 'warning' : 'healthy';
    const availabilityText = item.availability_percent == null ? 'Collecting' : serviceHealthValue(item.availability_percent, '%');
    return `<article><div><strong>${escapeHtml(String(item.environment).toUpperCase())}</strong><small>${item.endpoints} endpoint${item.endpoints === 1 ? '' : 's'} · ${item.checks} checks</small></div><div><span class="status ${state}"><i></i>${availabilityText}</span><small>${item.attention ? `${item.attention} endpoint${item.attention === 1 ? '' : 's'} need review` : 'All monitored endpoints on target'}</small></div></article>`;
  }).join('') || '<p>No environment URLs are configured yet. Add URLs in URL Monitoring to compare Dev, QA, UAT, and other environments here.</p>';
  target.className = 'service-health-content';
  target.innerHTML = `<div class="service-health-summary">
    <article><span>Observed availability</span><strong>${serviceHealthValue(availability.percent, '%')}</strong><small>${availability.percent == null ? 'Waiting for completed checks' : `${availability.meets_target ? 'Meeting' : 'Below'} the ${targetPercent}% service target`}</small></article>
    <article><span>Evidence coverage</span><strong>${coverage.checks || 0}</strong><small>${coverageText}</small></article>
    <article><span>Release activity</span><strong>${releases.observed_last_24h || 0}</strong><small>${escapeHtml(releases.note || 'Current operational window')}</small></article>
    <article><span>Incident outcomes</span><strong>${incidents.open || 0} open</strong><small>${incidents.collecting ? 'Incident history is still collecting' : `${incidents.recovered_30d || 0} recovered in 30 days`}</small></article>
  </div>
  <section class="service-health-explainer"><span class="status ${availabilityState}"><i></i>${availability.percent == null ? 'Collecting evidence' : availability.meets_target ? 'On target' : 'Needs review'}</span><p><strong>How to read this view:</strong> availability is calculated from retained URL checks only. It is an internal service target, not a contractual SLA.</p></section>
  <section class="service-health-table"><div class="panel-title"><div><p class="eyebrow">APPLICATION AVAILABILITY</p><h3>Endpoints in the current reporting period</h3></div><span class="muted">Target ${targetPercent}%</span></div><div class="table-wrap"><table><thead><tr><th>Application</th><th>Current state</th><th>Availability</th><th>Latest check</th></tr></thead><tbody>${endpointRows}</tbody></table></div></section>
  <section class="service-health-environments"><div><p class="eyebrow">ENVIRONMENT COMPARISON</p><h3>How each delivery environment is performing</h3><p>Compare retained URL-check evidence across the environments that have been configured.</p></div><div class="service-health-environment-list">${environmentRows}</div></section>
  <section class="service-health-attention"><div><p class="eyebrow">MANAGEMENT ATTENTION</p><h3>${attention.length ? 'Items worth reviewing' : 'No service exceptions in the current view'}</h3></div><div>${attention.length ? attention.map(item => `<article><span class="status ${item.current_status === 'down' ? 'critical' : 'warning'}"><i></i>${escapeHtml(item.name)}</span><p>${item.availability_percent == null ? 'Checks are still being collected for this endpoint.' : `${serviceHealthValue(item.availability_percent, '%')} availability against the ${targetPercent}% target.`}</p></article>`).join('') : '<p>Continue normal monitoring. New endpoint, release, and incident evidence will appear here only when it needs attention.</p>'}</div></section>`;
}

async function loadServiceHealth() {
  const target = document.querySelector('#service-health-content');
  if (!target || !isDeveloperOrAdministrator()) return;
  try {
    const response = await fetch('/api/service-health?days=30');
    if (!response.ok) throw new Error('Service health is unavailable.');
    serviceHealthReport = await response.json();
    renderServiceHealth(serviceHealthReport);
  } catch (error) {
    target.className = 'service-health-content empty';
    target.textContent = escapeHtml(error.message);
  }
}

function renderUrlMonitors() {
  const environments = ['dev', 'qa', 'uat', 'prod'];
  const visible = urlMonitors.filter(item => item.environment === urlMonitorEnvironment && (`${item.name} ${item.url}`).toLowerCase().includes(urlMonitorSearch.toLowerCase()) && (urlMonitorStatus === 'all' || (urlMonitorStatus === 'attention' ? ['degraded', 'down'].includes(item.status) : item.status === urlMonitorStatus)));
  const operational = urlMonitors.filter(item => item.status === 'operational').length;
  const attention = urlMonitors.filter(item => ['degraded', 'down'].includes(item.status)).length;
  const averageLatency = Math.round(urlMonitors.filter(item => item.latency_ms != null).reduce((total, item) => total + item.latency_ms, 0) / Math.max(1, urlMonitors.filter(item => item.latency_ms != null).length));
  document.querySelector('#url-monitor-banner').innerHTML = `<div class="url-banner-icon ${attention ? 'attention' : ''}">${attention ? '!' : '✓'}</div><div><strong>${attention ? `${attention} endpoint${attention === 1 ? '' : 's'} need attention` : urlMonitors.length ? 'All monitored endpoints are operational' : 'Ready to monitor your applications'}</strong><p>${attention ? 'Review degraded or unreachable applications below.' : urlMonitors.length ? 'Every enabled health check returned its expected response.' : 'Add your first environment URL to begin availability checks.'}</p></div><span>${operational}/${urlMonitors.filter(item => item.status !== 'disabled').length || 0} healthy</span>`;
  document.querySelector('#url-monitor-summary').innerHTML = `<article><div class="metric-icon configured">◎</div><div><span>Configured URLs</span><strong>${urlMonitors.length}</strong><small>${new Set(urlMonitors.map(item => item.environment)).size} active environments</small></div></article><article><div class="metric-icon healthy">✓</div><div><span>Operational</span><strong>${operational}</strong><small>Expected response received</small></div></article><article><div class="metric-icon warning">!</div><div><span>Needs attention</span><strong>${attention}</strong><small>Degraded or unreachable</small></div></article><article><div class="metric-icon latency">⌁</div><div><span>Average latency</span><strong>${averageLatency || '—'}${averageLatency ? ' ms' : ''}</strong><small>Across latest checks</small></div></article>`;
  renderUrlMonitorHistory();
  document.querySelector('#url-monitor-tabs').innerHTML = environments.map(environment => { const items = urlMonitors.filter(item => item.environment === environment); const issues = items.filter(item => ['degraded','down'].includes(item.status)).length; return `<button type="button" class="${environment === urlMonitorEnvironment ? 'active' : ''}" data-url-environment="${environment}"><i class="env-dot ${issues ? 'attention' : ''}"></i><b>${environment.toUpperCase()}</b><small>${items.length} URL${items.length === 1 ? '' : 's'}</small>${issues ? `<em>${issues}</em>` : ''}</button>`; }).join('');
  document.querySelectorAll('[data-url-environment]').forEach(button => button.addEventListener('click', () => { urlMonitorEnvironment = button.dataset.urlEnvironment; renderUrlMonitors(); }));
  document.querySelector('#url-monitor-list').className = 'url-monitor-list';
  document.querySelector('#url-monitor-list').innerHTML = `<div class="url-monitor-list-head"><span>APPLICATION & ENDPOINT</span><span>HEALTH</span><span>RESPONSE</span><span>EXPECTED</span><span>LAST CHECK</span><span></span></div>${visible.length ? visible.map(item => { const monitoredUrl = `${String(item.url || '').replace(/\/$/, '')}${item.health_path || ''}` || item.url; return `<article class="url-monitor-card"><div class="url-app"><span class="url-app-icon">${escapeHtml(item.name.slice(0,2).toUpperCase())}</span><div><strong>${escapeHtml(item.name)}</strong><a href="${escapeHtml(monitoredUrl)}" target="_blank" rel="noopener noreferrer">${escapeHtml(monitoredUrl)} ↗</a><small>${escapeHtml(item.environment.toUpperCase())} · monitored endpoint</small></div></div><span class="status ${item.status === 'operational' ? 'healthy' : item.status === 'degraded' ? 'warning' : item.status === 'disabled' ? '' : 'critical'}"><i></i>${escapeHtml(item.status)}</span><div class="url-response"><strong>${item.latency_ms == null ? '—' : `${item.latency_ms} ms`}</strong><small>${item.status_code ? `HTTP ${item.status_code}` : item.error || 'Not checked'}</small></div><div class="url-expected"><strong>HTTP ${item.expected_status}</strong><small>${item.enabled ? 'Monitoring enabled' : 'Monitoring disabled'}</small></div><div class="url-checked"><strong>${item.checked_at ? new Date(item.checked_at).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit',second:'2-digit'}) : '—'}</strong><small>Latest run</small></div>${isAdministrator() ? `<div class="url-row-actions">${urlMonitorActionMenu === item.id ? `<button type="button" data-url-edit="${escapeHtml(item.id)}">Edit</button><button type="button" class="danger" data-url-delete="${escapeHtml(item.id)}">Delete</button>` : `<button type="button" class="url-row-menu" data-url-menu="${escapeHtml(item.id)}" aria-label="Actions for ${escapeHtml(item.name)}">•••</button>`}</div>` : '<span></span>'}</article>`; }).join('') : `<div class="url-monitor-empty"><span>◎</span><strong>No matching ${urlMonitorEnvironment.toUpperCase()} URLs</strong><p>Add an environment URL or adjust the current search and status filters.</p></div>`}`;
  document.querySelectorAll('[data-url-menu]').forEach(button => button.addEventListener('click', () => { urlMonitorActionMenu = button.dataset.urlMenu; renderUrlMonitors(); }));
  document.querySelectorAll('[data-url-edit]').forEach(button => button.addEventListener('click', () => { urlMonitorEditingId = button.dataset.urlEdit; urlMonitorActionMenu = ''; renderUrlMonitors(); document.querySelector('.url-monitor-add')?.scrollIntoView({ behavior: 'smooth', block: 'center' }); }));
  document.querySelectorAll('[data-url-delete]').forEach(button => button.addEventListener('click', async () => { if (!window.confirm('Delete this URL monitor?')) return; await fetch(`/api/url-monitors/${encodeURIComponent(button.dataset.urlDelete)}`, { method: 'DELETE' }); await loadUrlMonitors(); }));
  const admin = document.querySelector('#url-monitor-admin');
  const editing = urlMonitors.find(item => item.id === urlMonitorEditingId);
  admin.innerHTML = isAdministrator() ? `<details class="url-monitor-add" ${editing ? 'open' : ''}><summary><span>${editing ? '✎' : '＋'}</span><div><strong>${editing ? 'Edit application endpoint' : 'Add an application endpoint'}</strong><small>${editing ? 'Update the URL, monitored path, expected response, or monitoring state' : 'Configure an approved URL for continuous environment monitoring'}</small></div><b>${editing ? 'Editing' : 'Open form'}</b></summary><form id="url-monitor-form"><label>Application name<input name="name" required maxlength="120" placeholder="Customer portal" value="${escapeHtml(editing?.name || '')}"></label><label>Environment<select name="environment">${environments.map(environment => `<option value="${environment}" ${editing?.environment === environment ? 'selected' : ''}>${environment.toUpperCase()}</option>`).join('')}</select></label><label class="wide-field">Base application URL<input name="url" type="url" required placeholder="https://app-dev.example.com" value="${escapeHtml(editing?.url || '')}"></label><label>Monitored path<input name="health_path" placeholder="/navigator-frame or /health" value="${escapeHtml(editing?.health_path || '')}"></label><label>Expected response<input name="expected_status" type="number" min="100" max="599" value="${Number(editing?.expected_status || 200)}"></label><label class="url-monitor-enabled"><input name="enabled" type="checkbox" ${editing?.enabled === false ? '' : 'checked'}><span>Enable continuous checks</span></label><button type="submit" class="primary">${editing ? 'Save changes' : 'Add endpoint'}</button>${editing ? '<button type="button" class="url-edit-cancel" data-url-edit-cancel>Cancel</button>' : ''}<p class="form-message"></p></form></details>` : '<p class="rule-view-only">Administrators manage URLs. You can review and refresh their current status.</p>';
  admin.querySelector('#url-monitor-form')?.addEventListener('submit', saveUrlMonitor);
  admin.querySelector('[data-url-edit-cancel]')?.addEventListener('click', () => { urlMonitorEditingId = ''; renderUrlMonitors(); });
}

function renderOperatingContext(snapshot) {
  const target = document.querySelector('#operating-context');
  if (!target || !snapshot) return;
  const namespaces = [...new Set((snapshot.pods || []).map(pod => pod.namespace).filter(Boolean))];
  const source = snapshot.mode === 'docker' ? 'Local Docker' : snapshot.mode === 'splunk' ? 'Splunk' : 'Kubernetes / OpenShift';
  const ranges = [[60, 'Last hour'], [360, 'Last 6 hours'], [1440, 'Last 24 hours']];
  target.innerHTML = `<div><span>Monitoring scope</span><strong>${escapeHtml(namespaces.length ? namespaces.join(', ') : 'Waiting for namespace')}</strong></div><div><span>Evidence window</span><label><select data-context-range>${ranges.map(([minutes, label]) => `<option value="${minutes}" ${observabilityMinutes === minutes ? 'selected' : ''}>${label}</option>`).join('')}</select></label></div><div><span>Data source</span><strong>${escapeHtml(source)}</strong></div><small>Live values update automatically; retained trends use the selected evidence window.</small>`;
  target.querySelector('[data-context-range]')?.addEventListener('change', event => {
    observabilityMinutes = Number(event.target.value);
    load();
  });
}

function urlHistorySamples(monitor) {
  return (urlMonitorHistory[monitor.id] || []).slice().sort((left, right) => new Date(left.checked_at) - new Date(right.checked_at));
}

function compactHistorySamples(samples, limit = 42) {
  if (samples.length <= limit) return samples;
  return Array.from({ length: limit }, (_, index) => samples[Math.round(index * (samples.length - 1) / (limit - 1))]);
}

function responseTimeChart(samples) {
  const measured = samples.filter(item => Number.isFinite(Number(item.latency_ms)));
  if (measured.length < 2) return '<div class="url-history-chart-empty">A response-time line will appear after at least two retained checks.</div>';
  const values = measured.map(item => Number(item.latency_ms));
  const maximum = Math.max(...values, 1);
  const minimum = Math.min(...values);
  const span = Math.max(maximum - minimum, 1);
  const points = measured.map((item, index) => `${(index / (measured.length - 1)) * 100},${40 - ((Number(item.latency_ms) - minimum) / span) * 32}`).join(' ');
  return `<div class="url-history-chart" aria-label="Response time trend"><div class="url-history-scale"><span>${maximum} ms</span><span>${minimum} ms</span></div><svg viewBox="0 0 100 48" preserveAspectRatio="none" role="img" aria-label="Response time trend from ${minimum} to ${maximum} milliseconds"><defs><linearGradient id="urlLatencyFill" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="#4d7fc4" stop-opacity=".22"/><stop offset="1" stop-color="#4d7fc4" stop-opacity="0"/></linearGradient></defs><polygon points="0,48 ${points} 100,48" fill="url(#urlLatencyFill)"></polygon><polyline points="${points}" fill="none" stroke="#3f73ba" stroke-width="2" vector-effect="non-scaling-stroke" stroke-linecap="round" stroke-linejoin="round"></polyline></svg><div><span>${new Date(measured[0].checked_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span><span>Latest</span></div></div>`;
}

function renderUrlMonitorHistory() {
  const target = document.querySelector('#url-monitor-history');
  if (!target) return;
  const scoped = urlMonitors.filter(item => item.environment === urlMonitorEnvironment && item.enabled !== false);
  const entries = scoped.map(monitor => ({ monitor, samples: urlHistorySamples(monitor) }));
  const samples = entries.flatMap(item => item.samples);
  const measured = samples.filter(item => Number.isFinite(Number(item.latency_ms)));
  const successful = samples.filter(item => item.status === 'operational').length;
  const uptime = samples.length ? (successful / samples.length) * 100 : null;
  const average = measured.length ? Math.round(measured.reduce((total, item) => total + Number(item.latency_ms), 0) / measured.length) : null;
  const incidents = [];
  entries.forEach(({ monitor, samples: monitorSamples }) => monitorSamples.forEach((sample, index) => {
    const previous = monitorSamples[index - 1];
    const needsAttention = ['down', 'degraded'].includes(sample.status);
    const wasAttention = previous && ['down', 'degraded'].includes(previous.status);
    if (needsAttention && !wasAttention) incidents.push({ type: 'opened', monitor, sample });
    if (sample.status === 'operational' && wasAttention) incidents.push({ type: 'recovered', monitor, sample, previous });
  }));
  const chart = responseTimeChart(samples);
  const historyRows = entries.length ? entries.map(({ monitor, samples: monitorSamples }) => {
    const dots = compactHistorySamples(monitorSamples).map(sample => `<i class="${escapeHtml(sample.status)}" title="${escapeHtml(`${new Date(sample.checked_at).toLocaleString()} · ${sample.status}${sample.latency_ms == null ? '' : ` · ${sample.latency_ms} ms`}`)}"></i>`).join('');
    return `<article><div><strong>${escapeHtml(monitor.name)}</strong><small>${monitorSamples.length ? `${monitorSamples.length} retained check${monitorSamples.length === 1 ? '' : 's'}` : 'Collecting first check'}</small></div><div class="url-history-dots" aria-label="Availability history for ${escapeHtml(monitor.name)}">${dots || '<span>—</span>'}</div></article>`;
  }).join('') : '<p class="url-history-empty">No enabled URLs are configured for this environment yet.</p>';
  const timeline = incidents.slice(-4).reverse().map(item => `<article class="${item.type}"><i>${item.type === 'recovered' ? '✓' : '!'}</i><div><strong>${escapeHtml(item.monitor.name)} ${item.type === 'recovered' ? 'recovered' : 'needed attention'}</strong><small>${item.type === 'recovered' ? `Recovered from ${item.previous.status}` : `${item.sample.status}${item.sample.status_code ? ` · HTTP ${item.sample.status_code}` : ''}`} · ${new Date(item.sample.checked_at).toLocaleString()}</small></div></article>`).join('') || `<p class="url-history-empty">${samples.length > 1 ? `No availability change was recorded in the last ${urlMonitorHistoryHours} hours.` : 'Collecting history. Incident changes appear after subsequent checks.'}</p>`;
  target.innerHTML = `<div class="url-history-heading"><div><p class="eyebrow">RECENT AVAILABILITY</p><h3>${urlMonitorEnvironment.toUpperCase()} health history</h3><p>Real checks retained by this application during the last ${urlMonitorHistoryHours} hours.</p></div><div class="url-history-stats"><span><b>${uptime == null ? '—' : `${uptime.toFixed(1)}%`}</b> availability</span><span><b>${average == null ? '—' : `${average} ms`}</b> average response</span><span><b>${samples.length}</b> checks</span></div></div><div class="url-history-grid"><section class="url-response-trend"><header><div><strong>Response time trend</strong><small>Only successful response timings are charted.</small></div></header>${chart}</section><section class="url-availability-history"><header><div><strong>Availability by endpoint</strong><small>Each mark is one retained check.</small></div><span class="url-history-key"><i class="operational"></i>Up <i class="degraded"></i>Degraded <i class="down"></i>Down</span></header><div>${historyRows}</div></section><section class="url-incident-timeline"><header><div><strong>Incident timeline</strong><small>Only status changes are listed.</small></div></header><div>${timeline}</div></section></div>`;
}

async function loadUrlMonitors() {
  const button = document.querySelector('#url-monitor-refresh');
  button?.classList.add('loading'); if (button) button.querySelector('span').textContent = 'Checking endpoints…';
  const response = await fetch('/api/url-monitors');
  if (!response.ok) { document.querySelector('#url-monitor-list').innerHTML = '<p class="empty">URL monitoring is unavailable for this account.</p>'; button?.classList.remove('loading'); return; }
  const result = await response.json();
  urlMonitors = result.monitors || [];
  urlMonitorHistory = result.history || {};
  urlMonitorHistoryHours = Number(result.history_window_hours || 24);
  document.querySelector('#url-monitor-updated').textContent = `Last checked ${new Date().toLocaleTimeString([], {hour:'2-digit',minute:'2-digit',second:'2-digit'})}`;
  button?.classList.remove('loading'); if (button) button.querySelector('span').textContent = 'Run health check';
  renderUrlMonitors();
  renderApplicationHealth();
}

function applicationForDeployment(deployment) {
  const name = String(deployment?.name || 'Application');
  const tokens = name.toLowerCase().split(/[-_.]/).filter(token => token.length > 3);
  const relatedUrls = urlMonitors.filter(item => tokens.some(token => `${item.name} ${item.url}`.toLowerCase().includes(token)));
  const pods = (deployment?.resources || []).map(item => item.pod).filter(Boolean);
  const errors = pods.reduce((total, pod) => total + Number(data?.analysis?.[pod.name]?.counts?.errors || 0), 0);
  const attention = deployment?.status !== 'Ready' && deployment?.status !== 'Completed' || errors > 0 || relatedUrls.some(item => ['down', 'degraded'].includes(item.status));
  return { name, deployment, relatedUrls, pods, errors, attention };
}

function loadFavouriteApplications() {
  try { favouriteApplications = new Set(JSON.parse(window.localStorage.getItem('pulseops.favouriteApplications') || '[]')); } catch { favouriteApplications = new Set(); }
}

function toggleFavouriteApplication(name) {
  favouriteApplications.has(name) ? favouriteApplications.delete(name) : favouriteApplications.add(name);
  window.localStorage.setItem('pulseops.favouriteApplications', JSON.stringify([...favouriteApplications]));
  renderApplicationHealth();
}

function renderApplicationHealth() {
  const target = document.querySelector('#application-health-content');
  if (!target || !data) return;
  if (!favouriteApplications.size) loadFavouriteApplications();
  const applications = (data.deployments || []).map(applicationForDeployment).sort((left, right) => Number(favouriteApplications.has(right.name)) - Number(favouriteApplications.has(left.name)) || Number(right.attention) - Number(left.attention) || left.name.localeCompare(right.name));
  target.innerHTML = applications.length ? applications.map(app => {
    const ready = app.deployment.status === 'Completed' ? 'Completed' : `${app.deployment.available || 0}/${app.deployment.desired || 0} ready`;
    const availability = app.relatedUrls.length ? `${app.relatedUrls.filter(item => item.status === 'operational').length}/${app.relatedUrls.length} URLs up` : 'No URL monitor mapped';
    const risk = app.attention ? 'warning' : 'healthy';
    return `<article class="application-health-card ${risk}"><div class="application-health-heading"><div><span class="${severityClass(risk)}">${app.attention ? 'needs review' : 'healthy'}</span><h3>${escapeHtml(app.name)}</h3></div><div class="application-card-actions"><button type="button" class="favourite-app" data-application-favourite="${escapeHtml(app.name)}" aria-label="${favouriteApplications.has(app.name) ? 'Remove from' : 'Add to'} favourites">${favouriteApplications.has(app.name) ? '★' : '☆'}</button><button type="button" data-application-open="${escapeHtml(app.name)}">Open</button></div></div><dl><div><dt>Deployment</dt><dd>${escapeHtml(ready)}</dd></div><div><dt>Availability</dt><dd>${escapeHtml(availability)}</dd></div><div><dt>Log errors</dt><dd>${app.errors}</dd></div><div><dt>Latest image</dt><dd>${escapeHtml(app.deployment.image || 'Not reported')}</dd></div></dl><small>Open the investigation workspace for evidence, release context, and a Jira-ready incident summary.</small></article>`;
  }).join('') : '<p class="empty">Application health appears when the connected source reports deployments.</p>';
  target.querySelectorAll('[data-application-open]').forEach(button => button.addEventListener('click', () => {
    const app = applications.find(item => item.name === button.dataset.applicationOpen);
    const pod = app?.pods[0];
    if (pod) openDeveloperInvestigation(pod.name);
    else { selectedDeploymentName = button.dataset.applicationOpen; setWorkspacePage('workloads'); renderDeploymentInspector(data.deployments || []); document.querySelector('#deployment-inspector')?.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
  }));
  target.querySelectorAll('[data-application-favourite]').forEach(button => button.addEventListener('click', () => toggleFavouriteApplication(button.dataset.applicationFavourite)));
}

function renderManagementSummary() {
  const target = document.querySelector('#management-summary-content');
  if (!target || !data) return;
  const apps = (data.deployments || []).map(applicationForDeployment);
  const atRisk = apps.filter(app => app.attention);
  const recentChanges = (observabilityData.deployment_changes || []).length;
  const unmappedUrls = apps.filter(app => !app.relatedUrls.length).length;
  const unresolved = alertHistory.filter(event => event.state === 'active').length;
  const cards = [
    { label: 'Service health', value: `${apps.length - atRisk.length}/${apps.length || 0} stable`, detail: atRisk.length ? `${atRisk.length} application${atRisk.length === 1 ? '' : 's'} need review.` : 'No application currently needs review.', hash: '#service-health', page: 'service-health', action: 'Open service health →' },
    { label: 'Release watch', value: `${recentChanges} recent change${recentChanges === 1 ? '' : 's'}`, detail: recentChanges ? 'Compare readiness and evidence after the release.' : 'No retained deployment change in the selected evidence window.', hash: '#workloads', page: 'workloads', action: 'Open workload activity →' },
    { label: 'Alert lifecycle', value: `${unresolved} open`, detail: `${Number(alertHistoryReport?.windows?.['7d']?.recovered || 0)} recovered in the last 7 days.`, hash: '#alerts', page: 'alerts', action: 'Open alerts →' },
    { label: 'Coverage', value: `${apps.length - unmappedUrls}/${apps.length || 0} URL mapped`, detail: unmappedUrls ? `${unmappedUrls} application${unmappedUrls === 1 ? '' : 's'} still need a URL monitor.` : 'Every reported application has a mapped URL monitor.', hash: '#url-monitoring', page: 'url-monitoring', action: 'Open URL monitoring →' },
  ];
  target.innerHTML = cards.map(card => `<button type="button" class="management-summary-card" data-management-summary-page="${card.page}" data-management-summary-hash="${card.hash}"><span>${escapeHtml(card.label)}</span><strong>${escapeHtml(card.value)}</strong><small>${escapeHtml(card.detail)}</small><em>${escapeHtml(card.action)}</em></button>`).join('');
  target.querySelectorAll('[data-management-summary-page]').forEach(button => button.addEventListener('click', () => {
    window.history.pushState(null, '', button.dataset.managementSummaryHash);
    setWorkspacePage(button.dataset.managementSummaryPage);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }));
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
  // Command Center contains the Service Map and Dependency Health panels.
  // Keep that whole workspace out of focused pages even if a theme rule is overridden.
  const commandCenter = document.querySelector('#observability-center');
  if (commandCenter) commandCenter.hidden = page !== 'overview';
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
  const cards = [['▣', 'Deployments ready', `${summary.running_deployments}/${summary.deployments}`, 'deployment-readiness'], ['◈', 'Pods running', `${summary.running_pods}/${summary.pods}`, 'container-monitoring'], ['✓', 'Healthy pods', `${summary.healthy_pods}/${summary.pods}`, 'container-monitoring'], ['⌁', 'Average CPU', percent(summary.average_cpu_percent), 'intelligence-center'], ['◒', 'Memory', percent(summary.average_memory_percent), 'intelligence-center'], ['↻', 'Restarts', summary.total_restarts, 'container-monitoring'], ['⇄', 'Exposed services', `${summary.exposed_services}/${summary.services}`, 'deployment-readiness'], ['!', 'Alerts', summary.alerts, 'alert-center']];
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
  target.innerHTML = `<div class="platform-health-copy"><span class="${severityClass(status)}">${status === 'healthy' ? 'Healthy' : status === 'warning' ? 'Attention' : 'Critical'}</span><div><strong>${headline}</strong><small>${detail}</small></div></div><button type="button" data-platform-health-action>${status === 'healthy' ? 'Open Command Center' : 'Review attention'}</button>`;
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
    { label: 'Resource watch', value: highest ? `${percent(highest.forecast_percent)} expected use` : 'No forecast yet', detail: highest ? highest.pod : 'Collecting resource history.', page: 'intelligence', hash: '#intelligence', action: 'Open capacity analysis →', status: highest?.risk || 'healthy' },
    { label: 'Latest activity', value: event?.title || 'No recent changes', detail: event?.detail || 'No workload or alert changes in the current window.', page: 'workloads', hash: '#workloads', action: 'Open workload activity →', status: event?.severity || 'healthy' },
  ];
  document.querySelector('#overview-focus-content').innerHTML = cards.map(card => `<button class="overview-focus-card" data-overview-page="${card.page}" data-overview-hash="${card.hash}"><span class="${severityClass(card.status)}">${escapeHtml(card.label)}</span><strong>${escapeHtml(card.value)}</strong><small>${escapeHtml(card.detail)}</small><em>${escapeHtml(card.action || 'Open details →')}</em></button>`).join('');
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
  const modeControls = `<div class="trend-mode-controls" aria-label="Trend metric group"><button type="button" data-trend-mode="capacity" class="${trendMode === 'capacity' ? 'active' : ''}">Capacity</button><button type="button" data-trend-mode="reliability" class="${trendMode === 'reliability' ? 'active' : ''}">Operational risk signals</button></div>`;
  const capacityView = trendMode === 'capacity';
  const eventMaximum = Math.max(...samples.flatMap(item => [Number(item.summary?.errors) || 0, Number(item.summary?.warnings) || 0, Number(item.summary?.restarts) || 0]), 1);
  const capacityMaximum = Math.max(5, Math.ceil(Math.max(...samples.flatMap(item => [Number(item.summary?.cpu) || 0, Number(item.summary?.memory) || 0])) / 5) * 5);
  const chartMaximum = capacityView ? capacityMaximum : eventMaximum;
  const trendLegend = capacityView ? `<div class="trend-legend"><span class="cpu">CPU usage</span><span class="memory">Memory usage</span><small>Autoscaled to the observed range · peak ${capacityMaximum}%</small></div>` : `<div class="trend-legend"><span class="errors">Errors</span><span class="warnings">Warnings</span><span class="restarts">Restarts</span><small>Current totals per observation · peak ${eventMaximum}</small></div>`;
  const chartWidth = 920;
  const chartHeight = 250;
  const trendLines = capacityView
    ? `${svgSeries(samples, item => item.summary.cpu, '#416ce4', chartWidth, chartHeight, chartMaximum, 'CPU', '%')}${svgSeries(samples, item => item.summary.memory, '#845bd4', chartWidth, chartHeight, chartMaximum, 'Memory', '%')}`
    : `${svgSeries(samples, item => item.summary.errors, '#d26751', chartWidth, chartHeight, eventMaximum, 'Errors', ' events')}${svgSeries(samples, item => item.summary.warnings, '#d8912b', chartWidth, chartHeight, eventMaximum, 'Warnings', ' events')}${svgSeries(samples, item => item.summary.restarts, '#7565c8', chartWidth, chartHeight, eventMaximum, 'Restarts', ' total')}`;
  const riskSignalsPresent = samples.some(item => [item.summary?.errors, item.summary?.warnings, item.summary?.restarts].some(value => Number(value) > 0));
  const trendSummary = capacityView ? 'The scale adapts to the live range so small workload changes remain visible. Values are still percentages of configured container limits.' : 'Observed log errors, warnings, and container restarts. This does not represent customer-facing availability or request-level error rate.';
  const trendKpis = capacityView
    ? `<div class="trend-kpis">${trendInsight(samples, item => item.summary.cpu, 'CPU now')}${trendInsight(samples, item => item.summary.memory, 'Memory now')}</div>`
    : `<div class="trend-kpis">${trendInsight(samples, item => item.summary.errors, 'Errors now', 'events')}${trendInsight(samples, item => item.summary.warnings, 'Warnings now', 'events')}${trendInsight(samples, item => item.summary.restarts, 'Restarts total', 'total')}</div>`;
  document.querySelector('#operations-trends').innerHTML = samples.length > 1
    ? `<div class="trend-toolbar"><div><strong class="trend-view-title">${capacityView ? 'Capacity over time' : 'Operational risk signals'}</strong><span class="trend-reading-count">${samples.length} readings</span></div>${modeControls}${rangeControls}</div>${trendLegend}${!capacityView && !riskSignalsPresent ? '<div class="trend-quiet-state"><b>✓ No operational risk signals in this window</b><span>No log errors, warnings, or container restarts were observed.</span></div>' : `${trendKpis}<div class="trend-plot"><div class="trend-y-axis" aria-hidden="true"><span>${capacityView ? `${chartMaximum}%` : chartMaximum}</span><span>${capacityView ? `${Math.round(chartMaximum / 2)}%` : Math.ceil(chartMaximum / 2)}</span><span>0</span></div><div class="trend-canvas"><svg viewBox="0 0 ${chartWidth} ${chartHeight}" preserveAspectRatio="none" role="img" aria-label="${capacityView ? 'CPU and memory usage trend' : 'Error, warning, and restart trend'}"><line class="trend-grid" x1="14" x2="906" y1="18" y2="18"/><line class="trend-grid" x1="14" x2="906" y1="125" y2="125"/><line class="trend-grid" x1="14" x2="906" y1="232" y2="232"/>${trendLines}</svg></div></div><div class="trend-axis"><span>${new Date(samples[0].timestamp * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span><span>${capacityView ? `Live scale: 0–${chartMaximum}%` : `Live scale: 0–${eventMaximum} observed signals`}</span><span>${new Date(samples[samples.length - 1].timestamp * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span></div>`}<p class="trend-summary">${trendSummary}</p>`
    : `${modeControls}${rangeControls}<p class="empty">Collecting at least two live readings to draw operational trends.</p>`;
  document.querySelectorAll('[data-trend-range]').forEach(button => button.addEventListener('click', () => { observabilityMinutes = Number(button.dataset.trendRange); load(); }));
  document.querySelectorAll('[data-trend-mode]').forEach(button => button.addEventListener('click', () => { trendMode = button.dataset.trendMode; renderObservability(observabilityData); }));
  const slo = report?.slo || {};
  document.querySelector('#slo-health').innerHTML = `<div class="slo-score"><span class="${severityClass(slo.status || 'healthy')}">${escapeHtml(slo.status || 'healthy')}</span><strong>${Number(slo.availability_percent || 0).toFixed(1)}%</strong><p>Availability target: ${slo.target_percent || 99.5}%</p><div class="slo-meta"><span>${slo.error_pods || 0} error workloads</span><span>${slo.restart_events || 0} restart events</span></div><p>${escapeHtml(slo.note || '')}</p></div>`;
  const capacity = report?.capacity || [];
  const observedWorkloads = capacity.length;
  const errorWorkloads = Number(slo.error_pods || 0);
  const restartEvents = Number(slo.restart_events || 0);
  document.querySelector('#slo-signals').innerHTML = `<article><span>Workloads tracked</span><strong>${observedWorkloads}</strong><small>Live container observations</small></article><article><span>Error workloads</span><strong>${errorWorkloads}</strong><small>${errorWorkloads ? 'Need a log review' : 'No current error signal'}</small></article><article><span>Restart events</span><strong>${restartEvents}</strong><small>In the observation window</small></article><article><span>Observation window</span><strong>${report?.range_minutes || 0}m</strong><small>Continuously refreshed</small></article>`;
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
  document.querySelector('#service-map').innerHTML = orderedNodes.length ? orderedNodes.map(node => { const edge = map.edges.find(item => item.to === node.id); return `${edge ? `<span class="service-edge">→ ${escapeHtml(edge.label)}</span>` : ''}<button class="service-node" data-service-workload="${escapeHtml(node.id)}" title="Open deployment details"><strong>${escapeHtml(node.label)}</strong><small>${escapeHtml(node.kind)} · ${escapeHtml(node.status)} · deployment details</small></button>`; }).join('') : '<p class="empty">Service relationships appear after matching workloads are observed.</p>';
  document.querySelectorAll('[data-service-workload]').forEach(button => button.addEventListener('click', () => openServiceDeployment(button.dataset.serviceWorkload)));
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

function openServiceDeployment(serviceId) {
  const deployments = data?.deployments || [];
  const selected = deployments.find(item => item.name === serviceId)
    || deployments.find(item => (item.resources || []).some(resource => resource.pod?.name === serviceId))
    || deployments.find(item => (item.resources || []).some(resource => resource.pod?.name?.includes(serviceId)));
  if (!selected) {
    openPodInvestigation(serviceId);
    return;
  }
  selectedDeploymentName = selected.name;
  selectedDeploymentResource = undefined;
  window.history.replaceState(null, '', '#deployment-inspector');
  setWorkspacePage('workloads');
  renderDeploymentInspector(deployments);
  document.querySelector('#deployment-inspector')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function ensureDeveloperInvestigationPage() {
  if (!document.querySelector('a[href="#developer-investigation"]')) {
    const link = document.createElement('a');
    link.href = '#developer-investigation'; link.innerHTML = '<span>⌕</span> Investigation';
    link.hidden = !isDeveloperOrAdministrator();
    document.querySelector('.workspace-nav a[href="#intelligence"]')?.before(link);
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
  target.querySelector('.investigation-landing-hero')?.insertAdjacentHTML('beforeend', pods.length ? `<label class="investigation-quick-select">Choose a pod<select id="investigation-quick-pod"><option value="">Select a pod to investigate</option>${pods.map(pod => `<option value="${escapeHtml(pod.name)}">${escapeHtml(pod.name)} · ${escapeHtml(pod.status)}</option>`).join('')}</select></label>` : '');
  target.querySelector('#investigation-quick-pod')?.addEventListener('change', event => { if (event.target.value) openDeveloperInvestigation(event.target.value); });
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
  const errorCount = relatedPods.reduce((sum, item) => sum + Number(data.analysis?.[item.name]?.counts?.errors || 0), 0);
  const restartCount = relatedPods.reduce((sum, item) => sum + Number(item.restarts || 0), 0);
  const affectedUrlCount = urls.filter(item => ['down', 'degraded'].includes(item.status)).length;
  const releaseRegressed = comparison?.status === 'regressed';
  const verdictSeverity = pod.risk === 'critical' || affectedUrlCount || releaseRegressed ? 'critical' : pod.risk === 'warning' || errorCount || restartCount ? 'warning' : 'healthy';
  const verdictTitle = verdictSeverity === 'critical' ? 'Attention needed now' : verdictSeverity === 'warning' ? 'Review this workload' : 'No current issue detected';
  const verdictDetail = verdictSeverity === 'critical' ? `${affectedUrlCount ? `${affectedUrlCount} related URL${affectedUrlCount === 1 ? ' is' : 's are'} affected` : releaseRegressed ? 'Operational signals worsened after the observed release' : 'A critical runtime signal is present'}${errorCount ? ` · ${errorCount} log error${errorCount === 1 ? '' : 's'} in the current sample` : ''}.` : verdictSeverity === 'warning' ? `${errorCount ? `${errorCount} log error${errorCount === 1 ? '' : 's'}` : restartCount ? `${restartCount} restart${restartCount === 1 ? '' : 's'}` : 'A runtime warning'} requires review. No rollback or corrective action has been performed by L1ControlScope.` : 'Current runtime, logs, deployment signals, and related URL checks do not show an active failure.';
  const verdictAction = verdictSeverity === 'healthy' ? 'Continue normal monitoring' : errorCount ? 'Review the current pod logs' : releaseRegressed ? 'Review the release comparison' : 'Review the captured evidence';
  target.innerHTML = `<header class="developer-investigation-hero"><div><p class="eyebrow">DEVELOPER INVESTIGATION WORKSPACE</p><h2>${escapeHtml(deployment?.name || pod.name)}</h2><p>${escapeHtml(pod.namespace || 'default')} · ${relatedPods.length} scoped pod${relatedPods.length === 1 ? '' : 's'} · opened ${workspace?.created_at ? new Date(workspace.created_at).toLocaleString() : 'for this session'}</p></div><div class="investigation-header-controls"><label class="investigation-pod-control">Investigating<select id="developer-investigation-pod-switch">${(data.pods || []).map(item => `<option value="${escapeHtml(item.name)}" ${item.name === pod.name ? 'selected' : ''}>${escapeHtml(item.name)}</option>`).join('')}</select></label><div class="investigation-control-group"><button type="button" class="all-pods-control" data-developer-all-pods><span>←</span> All pods</button><div class="investigation-health-control"><small>Health</small><span class="status ${pod.risk}">${escapeHtml(pod.risk)}</span></div><label>Investigation status<select id="developer-investigation-status"><option value="open" ${status === 'open' ? 'selected' : ''}>Open</option><option value="monitoring" ${status === 'monitoring' ? 'selected' : ''}>Monitoring</option><option value="resolved" ${status === 'resolved' ? 'selected' : ''}>Resolved</option></select></label></div></div></header>
  <section class="developer-investigation-summary"><article><span>Readiness</span><strong>${deployment ? `${deployment.available}/${deployment.desired}` : pod.status}</strong><small>${escapeHtml(deployment?.status || 'Runtime state')}</small></article><article><span>Restarts</span><strong>${relatedPods.reduce((sum,item)=>sum+Number(item.restarts||0),0)}</strong><small>Across scoped pods</small></article><article><span>Log signals</span><strong>${relatedPods.reduce((sum,item)=>sum+Number(data.analysis?.[item.name]?.counts?.errors||0),0)}</strong><small>${groups.length} grouped signatures</small></article><article><span>URL impact</span><strong>${urls.filter(item=>['down','degraded'].includes(item.status)).length}</strong><small>${urls.length} related endpoint${urls.length===1?'':'s'}</small></article></section>
  <div class="developer-investigation-grid"><section><div class="investigation-block-heading"><div><p class="eyebrow">PROBLEM & SCOPE</p><h3>Current operational assessment</h3></div></div><p class="investigation-assessment">${escapeHtml(analysis.findings?.[0] || 'No critical pattern is present in the latest sample.')}</p><dl class="investigation-metadata"><div><dt>Selected pod</dt><dd>${escapeHtml(pod.name)}</dd></div><div><dt>Image</dt><dd>${escapeHtml(deployment?.image || pod.image || 'Unavailable')}</dd></div><div><dt>Environment</dt><dd>${escapeHtml(urls[0]?.environment?.toUpperCase() || pod.namespace || 'Not mapped')}</dd></div><div><dt>Captured evidence</dt><dd>${captures.length}</dd></div></dl><div class="scoped-pods">${relatedPods.map(item=>`<button data-developer-pod="${escapeHtml(item.name)}"><span class="${severityClass(item.risk)}">${escapeHtml(item.status)}</span><b>${escapeHtml(item.name)}</b><small>${item.restarts} restart${item.restarts===1?'':'s'}</small></button>`).join('')}</div></section>
  <section><div class="investigation-block-heading"><div><p class="eyebrow">GROUPED ERRORS</p><h3>Repeated signatures</h3></div><button data-developer-open-logs>Open pod logs</button></div>${groups.length?`<div class="workspace-error-groups">${groups.map(group=>{const location=sourceCodeContext(image,group.signature);return `<article><b>${escapeHtml(group.signature)}</b><p>${group.count} occurrences · ${group.pods.size} pods</p><small>${escapeHtml([...group.pods].join(', '))}</small>${location?.exact?`<a class="error-source-link" href="${escapeHtml(location.url)}" target="_blank" rel="noopener noreferrer">Open ${escapeHtml(location.file)}:${escapeHtml(location.line)} ↗</a>`:''}</article>`;}).join('')}</div>`:'<p class="empty">No error or warning signature in the available scoped logs.</p>'}</section>
  <section><div class="investigation-block-heading"><div><p class="eyebrow">INCIDENT TIMELINE</p><h3>Changes and evidence</h3></div></div>${events.length?`<ol class="workspace-timeline">${events.map(item=>`<li><i></i><div><b>${escapeHtml(item.title)}</b><p>${escapeHtml(item.detail||'Operational event')}</p><small>${new Date(Number(item.timestamp)*1000).toLocaleString()}</small></div></li>`).join('')}</ol>`:'<p class="empty">No related transition in the selected history window.</p>'}</section>
  <section><div class="investigation-block-heading"><div><p class="eyebrow">RELEASE IMPACT</p><h3>Before / after deployment</h3></div></div>${comparison?`<div class="workspace-release ${comparison.status}"><span>${escapeHtml(comparison.status)}</span><code>${escapeHtml(comparison.previous_image||'No baseline')}</code><i>→</i><code>${escapeHtml(comparison.current_image||'Unavailable')}</code><p>${comparison.deltas?`Errors ${comparison.deltas.errors>=0?'+':''}${comparison.deltas.errors}; restarts ${comparison.deltas.restarts>=0?'+':''}${comparison.deltas.restarts}; readiness ${comparison.deltas.ready_percent>=0?'+':''}${comparison.deltas.ready_percent}%`:'Collecting enough baseline data for comparison.'}</p></div>`:'<p class="empty">No matching release comparison is available yet.</p>'}</section></div>
  <section class="incident-replay"><header><div><p class="eyebrow">INCIDENT REPLAY</p><h3>See the incident unfold</h3><p>Deployment, runtime, log, alert, URL, and recovery evidence in one ordered sequence.</p></div><div class="incident-replay-controls"><button type="button" data-replay-previous ${incidentReplayIndex === 0 ? 'disabled' : ''}>← Previous</button><button type="button" class="primary" data-replay-play ${replay.length < 2 ? 'disabled' : ''}>${incidentReplayTimer ? 'Pause replay' : '▶ Replay'}</button><button type="button" data-replay-next ${incidentReplayIndex >= replay.length - 1 ? 'disabled' : ''}>Next →</button></div></header>${replay.length ? `<div class="incident-replay-stage"><div class="replay-rail">${replay.map((item,index)=>`<button type="button" class="${index === incidentReplayIndex ? 'active' : ''} ${escapeHtml(item.severity)}" data-replay-step="${index}" title="${escapeHtml(item.title)}"><i></i><span>${new Date(item.timestamp).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'})}</span></button>`).join('')}</div><article class="replay-active ${escapeHtml(replayActive.severity)}"><div class="replay-kind"><span>${escapeHtml(replayActive.kind)}</span><time>${new Date(replayActive.timestamp).toLocaleString()}</time></div><h4>${escapeHtml(replayActive.title)}</h4><p>${escapeHtml(replayActive.detail)}</p><small>${escapeHtml(replayActive.source)}</small><b>Step ${incidentReplayIndex + 1} of ${replay.length}</b></article></div>` : '<p class="empty">No timestamped evidence is available for replay yet.</p>'}</section>
  <section class="investigation-links"><div><p class="eyebrow">COLLABORATION</p><h3>Share and continue in code</h3><p>Share this exact saved investigation or open the source version associated with the deployed image.</p></div><div class="investigation-link-actions">${workspace ? '<button type="button" data-developer-share>Copy investigation link</button>' : '<button type="button" disabled>Save to enable sharing</button>'}${source ? `<a href="${escapeHtml(source.url)}" target="_blank" rel="noopener noreferrer">Open source at ${escapeHtml(String(source.ref).slice(0, 12))} ↗</a><small>${source.origin === 'configured' ? 'Configured deployed commit' : source.origin === 'image' ? 'Commit inferred from image tag' : 'Default branch—deployed commit unavailable'}</small>` : '<span class="source-link-unavailable"><b>Source-code link not configured</b><small>Set SOURCE_REPOSITORY_URL and, preferably, SOURCE_COMMIT_SHA.</small></span>'}</div></section>
  <section class="investigation-notes"><div><p class="eyebrow">INVESTIGATION RECORD</p><h3>Developer notes and decision</h3></div><textarea id="developer-investigation-note" maxlength="1000" placeholder="Observation, impact, decision, owner, or next step">${escapeHtml(workspace?.note||'')}</textarea><div><button data-developer-save-note>Save investigation</button><button data-developer-export>Export evidence JSON</button></div></section>`;
  const summary = target.querySelector('.developer-investigation-summary');
  summary?.insertAdjacentHTML('afterend', `<section class="investigation-verdict ${verdictSeverity}"><div><p class="eyebrow">CURRENT ASSESSMENT</p><h3>${escapeHtml(verdictTitle)}</h3><p>${escapeHtml(verdictDetail)}</p></div><aside><span class="status ${verdictSeverity}">${escapeHtml(verdictSeverity === 'healthy' ? 'healthy' : 'needs review')}</span><strong>Recommended next action</strong><p>${escapeHtml(verdictAction)}</p><div><button type="button" data-developer-verdict-logs>Open pod logs</button><button type="button" data-developer-verdict-details>View evidence</button></div></aside></section>`);
  target.querySelector('.investigation-verdict')?.insertAdjacentHTML('afterend', `<section class="investigation-workflow" aria-label="Investigation workflow"><article class="active"><span>1</span><div><b>Scope</b><small>${escapeHtml(deployment?.name || pod.name)} · ${relatedPods.length} pod${relatedPods.length === 1 ? '' : 's'}</small></div></article><article><span>2</span><div><b>Review evidence</b><small>${errorCount} log error${errorCount === 1 ? '' : 's'} · ${restartCount} restart${restartCount === 1 ? '' : 's'}</small></div></article><article><span>3</span><div><b>Record decision</b><small>${status === 'open' ? 'Investigation is active' : status === 'monitoring' ? 'Watching after a change' : 'Resolution recorded'}</small></div></article></section>`);
  const advanced = document.createElement('details');
  advanced.className = 'investigation-advanced';
  advanced.open = investigationAdvancedOpen;
  advanced.innerHTML = '<summary><span><b>More investigation details</b><small>Errors, timeline, release impact, replay, sharing, and notes</small></span><em>Open</em></summary><div class="investigation-advanced-content"></div>';
  const advancedContent = advanced.querySelector('.investigation-advanced-content');
  ['.developer-investigation-grid', '.incident-replay', '.investigation-links', '.investigation-notes'].forEach(selector => { const section = target.querySelector(selector); if (section) advancedContent.append(section); });
  target.querySelector('.investigation-workflow')?.insertAdjacentElement('afterend', advanced);
  advanced.addEventListener('toggle', () => { investigationAdvancedOpen = advanced.open; });
  const statusControl = target.querySelector('#developer-investigation-status')?.closest('label');
  const updateStatusHelp = () => { const value = target.querySelector('#developer-investigation-status')?.value || 'open'; const text = value === 'monitoring' ? 'A fix or change was applied; watch the signals before closing.' : value === 'resolved' ? 'The issue is confirmed stable and the decision is recorded.' : 'The issue is actively being reviewed.'; const help = statusControl?.querySelector('.investigation-status-help'); if (help) help.textContent = text; };
  statusControl?.insertAdjacentHTML('beforeend', '<small class="investigation-status-help"></small>');
  updateStatusHelp();
  target.querySelector('#developer-investigation-status')?.addEventListener('change', updateStatusHelp);
  const notesHeading = target.querySelector('.investigation-notes h3');
  if (notesHeading) notesHeading.textContent = 'Notes, decision, and handover';
  const saveButton = target.querySelector('[data-developer-save-note]');
  if (saveButton) saveButton.textContent = 'Save notes & status';
  target.querySelector('[data-developer-verdict-logs]')?.addEventListener('click', () => { logExplorerPodName = developerInvestigationPod; logExplorerSelectedIndex = undefined; window.history.replaceState(null, '', '#log-explorer-panel'); setWorkspacePage('logs'); renderLogExplorer(); window.scrollTo({ top: 0, behavior: 'smooth' }); });
  target.querySelector('[data-developer-verdict-details]')?.addEventListener('click', () => { advanced.open = true; advanced.scrollIntoView({ behavior: 'smooth', block: 'start' }); });
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
  const changedRecently = (observabilityData.deployment_changes || []).filter(event => workloads.some(workload => workload.name === event.pod)).length;
  document.querySelector('#workload-health-content').innerHTML = workloads.length ? `<div class="workload-health-metric"><span>Deployments</span><strong>${workloads.length}</strong><small>monitored workloads</small></div><div class="workload-health-metric"><span>Healthy / completed</span><strong>${ready}</strong><small>ready workloads and finished jobs</small></div><div class="workload-health-metric ${attention ? 'attention' : ''}"><span>Needs attention</span><strong>${attention}</strong><small>${attention ? 'open the filtered view below' : 'no workload currently needs action'}</small></div><div class="workload-health-metric"><span>Recently changed</span><strong>${changedRecently}</strong><small>image or readiness observations</small></div><div class="workload-health-metric"><span>Exposed services</span><strong>${exposed}</strong><small>externally reachable</small></div>` : '<p class="empty">Deployment health appears when workload inventory is connected.</p>';
  const query = deploymentSearch.trim().toLowerCase();
  const healthRank = item => item.status === 'Ready' || item.status === 'Completed' ? 0 : 1;
  const matching = workloads.filter(item => (!query || `${item.name} ${item.type} ${item.image}`.toLowerCase().includes(query)) && (deploymentFilter === 'all' || deploymentFilter === 'attention' && item.status !== 'Ready' && item.status !== 'Completed' || deploymentFilter === 'ready' && item.status === 'Ready' || deploymentFilter === 'exposed' && item.exposed || deploymentFilter === 'completed' && item.status === 'Completed')).sort((left, right) => left.name.localeCompare(right.name));
  const pages = Math.max(1, Math.ceil(matching.length / deploymentPageSize));
  deploymentPage = Math.min(deploymentPage, pages);
  const start = (deploymentPage - 1) * deploymentPageSize;
  const visible = matching.slice(start, start + deploymentPageSize);
  document.querySelector('#deployment-list-controls').innerHTML = `<div class="inventory-filters"><label>Find deployment <select id="deployment-picker"><option value="">Choose a deployment</option>${[...workloads].sort((left, right) => left.name.localeCompare(right.name)).map(workload => `<option value="${escapeHtml(workload.name)}">${escapeHtml(workload.name)} · ${escapeHtml(workload.status)}</option>`).join('')}</select></label><label>Show <select id="deployment-filter"><option value="all" ${deploymentFilter === 'all' ? 'selected' : ''}>All deployments</option><option value="attention" ${deploymentFilter === 'attention' ? 'selected' : ''}>Needs attention</option><option value="ready" ${deploymentFilter === 'ready' ? 'selected' : ''}>Ready</option><option value="exposed" ${deploymentFilter === 'exposed' ? 'selected' : ''}>Exposed</option><option value="completed" ${deploymentFilter === 'completed' ? 'selected' : ''}>Completed</option></select></label></div><div class="inventory-pagination"><span>${matching.length ? `Showing ${start + 1}–${Math.min(start + deploymentPageSize, matching.length)} of ${matching.length}` : 'No matching deployments'} · ${workloads.length} total</span><label>Rows <select id="deployment-page-size"><option value="25" ${deploymentPageSize === 25 ? 'selected' : ''}>25</option><option value="50" ${deploymentPageSize === 50 ? 'selected' : ''}>50</option><option value="100" ${deploymentPageSize === 100 ? 'selected' : ''}>100</option></select></label><button type="button" data-deployment-prev ${deploymentPage === 1 ? 'disabled' : ''}>Previous</button><span>Page ${deploymentPage} of ${pages}</span><button type="button" data-deployment-next ${deploymentPage === pages ? 'disabled' : ''}>Next</button></div>`;
  const changed = new Set((observabilityData.events || []).filter(event => event.kind === 'deployment').map(event => event.pod));
  const dateLabel = value => value ? new Date(value).toLocaleString() : 'Not reported';
  const serviceLabel = workload => (workload.services || []).map(service => service.name).join(', ') || 'No matching service';
  const routeLabel = workload => (workload.routes || []).join(', ') || (workload.exposed ? 'Published service port' : 'Internal service');
  target.innerHTML = visible.length ? visible.map(workload => `<tr><td><button class="deployment-link" data-deployment-open="${escapeHtml(workload.name)}">${escapeHtml(workload.name)}<small>${changed.has(workload.name) ? 'Changed recently · inspect →' : 'Inspect resources →'}</small></button></td><td>${escapeHtml(workload.type)}</td><td>${workload.status === 'Completed' ? 'Completed' : `${workload.available}/${workload.desired} ready`}<small>${workload.updated == null ? 'Rollout count not available locally' : `${workload.updated} updated`} · ${workload.unavailable ?? 0} unavailable</small></td><td><small>${escapeHtml(serviceLabel(workload))}</small></td><td><small>${escapeHtml(workload.image || 'Not available')}</small></td><td><small>${escapeHtml(dateLabel(workload.deployed_at))}</small></td><td><small>${escapeHtml(routeLabel(workload))}</small></td><td><span class="${severityClass(workload.status === 'Ready' || workload.status === 'Completed' ? 'healthy' : 'warning')}">${escapeHtml(workload.status)}</span></td></tr>`).join('') : '<tr><td colspan="8" class="empty">No deployments match the selected filter.</td></tr>';
  document.querySelectorAll('[data-deployment-open]').forEach(button => button.addEventListener('click', () => { selectedDeploymentName = button.dataset.deploymentOpen; selectedDeploymentResource = undefined; renderDeploymentInspector(data.deployments || []); document.querySelector('#deployment-inspector').scrollIntoView({ behavior: 'smooth', block: 'start' }); }));
  document.querySelector('#deployment-picker').addEventListener('change', event => { if (!event.target.value) return; selectedDeploymentName = event.target.value; selectedDeploymentResource = undefined; renderDeploymentInspector(data.deployments || []); document.querySelector('#deployment-inspector').scrollIntoView({ behavior: 'smooth', block: 'start' }); });
  document.querySelector('#deployment-filter').addEventListener('change', event => { deploymentFilter = event.target.value; deploymentPage = 1; renderWorkloads(inventory); });
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

function workloadDetailsHtml(workload, resources) {
  const services = workload.services || [];
  const containers = workload.containers || [];
  const configurationReferences = workload.configuration_references || [];
  const labels = Object.entries(workload.labels || {});
  const conditions = workload.conditions || [];
  const workloadEvents = (data?.pod_events || []).filter(event => resources.some(resource => resource.pod?.name === event.pod)).slice(0, 5);
  const replica = (label, value) => `<div><span>${label}</span><strong>${value}</strong></div>`;
  return `<section class="workload-details"><header><div><p class="eyebrow">DEPLOYMENT EXPLORER</p><h3>Configuration and runtime view</h3><small>Live operational details are grouped by purpose. Secret values are never displayed.</small></div><span>${escapeHtml(workload.type)}</span></header><div class="workload-detail-grid"><article><p class="eyebrow">REPLICAS & ROLLOUT</p><div class="workload-replicas">${replica('Desired', workload.desired ?? '—')}${replica('Updated', workload.updated ?? '—')}${replica('Available', workload.available ?? '—')}${replica('Unavailable', workload.unavailable ?? '—')}</div><p class="workload-note">Strategy: <b>${escapeHtml(workload.strategy || 'Not available')}</b></p></article><article><p class="eyebrow">ASSOCIATED SERVICES</p>${services.length ? `<ul class="workload-detail-list">${services.map(service => `<li><div><b>${escapeHtml(service.name)}</b><small>${escapeHtml(service.type)} · ${(service.ports || []).map(escapeHtml).join(', ') || 'No ports reported'}</small></div><span class="status ${service.type === 'LoadBalancer' || service.type === 'NodePort' ? 'warning' : 'healthy'}">${service.type === 'LoadBalancer' || service.type === 'NodePort' ? 'exposed' : 'internal'}</span></li>`).join('')}</ul>` : '<p class="workload-empty">No Kubernetes Service selector currently matches this workload.</p>'}</article><article><p class="eyebrow">CONTAINERS & RESOURCES</p>${containers.length ? `<ul class="workload-detail-list containers">${containers.map(container => `<li><div><b>${escapeHtml(container.name)}</b><small>Requests: ${escapeHtml(Object.entries(container.requests || {}).map(([key, value]) => `${key} ${value}`).join(' · ') || 'Not set')}</small><small>Limits: ${escapeHtml(Object.entries(container.limits || {}).map(([key, value]) => `${key} ${value}`).join(' · ') || 'Not set')}</small></div></li>`).join('')}</ul>` : '<p class="workload-empty">Container requests and limits are available after Kubernetes deployment.</p>'}</article><article><p class="eyebrow">CONFIGURATION REFERENCES</p>${containers.length ? `<ul class="workload-detail-list config">${[...configurationReferences, ...containers.flatMap(container => (container.environment_sources || []).map(item => `${container.name}: ${item}`)), ...containers.flatMap(container => (container.environment_variables || []).slice(0, 8).map(item => `${container.name}: variable ${item}`))].slice(0, 14).map(item => `<li><div><small>${escapeHtml(item)}</small></div></li>`).join('') || '<li><div><small>No ConfigMap, Secret, volume, or environment-variable names reported.</small></div></li>'}</ul>` : '<p class="workload-empty">Configuration references are available after Kubernetes deployment. Secret values remain protected.</p>'}</article><article><p class="eyebrow">IDENTITY & LABELS</p><ul class="workload-detail-list config"><li><div><b>Service account</b><small>${escapeHtml(workload.service_account || 'Not reported')}</small></div></li>${labels.slice(0, 8).map(([key, value]) => `<li><div><small>${escapeHtml(`${key}: ${value}`)}</small></div></li>`).join('') || '<li><div><small>No workload labels reported by the current source.</small></div></li>'}</ul></article><article><p class="eyebrow">STATUS CONDITIONS</p>${conditions.length ? `<ul class="workload-detail-list conditions">${conditions.map(condition => `<li><div><b>${escapeHtml(condition.type)}: ${escapeHtml(condition.status)}</b><small>${escapeHtml(condition.reason || condition.message || 'No additional reason reported')}</small></div></li>`).join('')}</ul>` : '<p class="workload-empty">No Kubernetes condition details are available for this local workload.</p>'}</article><article><p class="eyebrow">RECENT WORKLOAD EVENTS</p>${workloadEvents.length ? `<ul class="workload-detail-list conditions">${workloadEvents.map(event => `<li><div><b>${escapeHtml(event.reason || 'Kubernetes event')}</b><small>${escapeHtml(event.message || '')}</small></div></li>`).join('')}</ul>` : '<p class="workload-empty">No native Kubernetes events are available in the current source.</p>'}</article></div></section>`;
}

function workloadReleaseHtml(workload) {
  const deployedAt = workload.deployed_at ? new Date(workload.deployed_at).toLocaleString() : 'Not reported by the current source';
  const routes = workload.routes || [];
  const serviceDetails = (workload.services || []).map(service => `${service.name} (${service.type})`).join(' · ') || 'No matching Service';
  return `<section class="workload-release-summary"><div><p class="eyebrow">DELIVERY & ACCESS</p><h3>Release and service details</h3><small>Shown from the connected runtime. Route information appears automatically when an Ingress or OpenShift Route is available.</small></div><dl><div><dt>Last deployed</dt><dd>${escapeHtml(deployedAt)}</dd></div><div><dt>Revision</dt><dd>${escapeHtml(workload.revision || 'Not reported')}</dd></div><div><dt>Image version</dt><dd>${escapeHtml(workload.image || 'Not reported')}</dd></div><div><dt>Associated service</dt><dd>${escapeHtml(serviceDetails)}</dd></div><div><dt>Route / endpoint</dt><dd>${escapeHtml(routes.join(', ') || (workload.exposed ? 'Published service port' : 'Internal cluster service'))}</dd></div></dl></section>`;
}

function workloadOperationsSummaryHtml(workload, resources, changes) {
  const summary = workload.summary || {};
  const errors = resources.reduce((total, resource) => total + Number(resource.analysis?.counts?.errors || 0), 0);
  const restarts = Number(summary.restarts || 0);
  const healthy = workload.status === 'Ready' || workload.status === 'Completed';
  const source = data?.mode === 'docker' ? 'Local Docker data' : data?.mode === 'kubernetes' ? 'Kubernetes live data' : 'Connected runtime data';
  const verdict = healthy ? `Healthy — ${workload.available}/${workload.desired} ready, ${restarts ? `${restarts} restart${restarts === 1 ? '' : 's'} observed` : 'no restart increase observed'}, ${errors ? `${errors} current log error${errors === 1 ? '' : 's'}` : 'no current log error signal'}.` : `Needs attention — ${workload.available}/${workload.desired} ready with ${workload.unavailable || 0} unavailable replica${Number(workload.unavailable || 0) === 1 ? '' : 's'}.`;
  const progress = workload.desired ? Math.min(100, Math.round(Number(workload.available || 0) / workload.desired * 100)) : 100;
  const impact = changes.length ? `${changes.length} deployment change${changes.length === 1 ? '' : 's'} in the current observation window. Review the deployment history below.` : 'No image, readiness, or restart change detected in the current observation window.';
  return `<section class="workload-operations-summary"><header><div><p class="eyebrow">WORKLOAD STATUS</p><h3>Operational summary</h3></div><span>${escapeHtml(source)}</span></header><div><article class="workload-verdict ${healthy ? 'healthy' : 'warning'}"><p class="eyebrow">HEALTH VERDICT</p><strong>${healthy ? 'Healthy' : 'Needs attention'}</strong><p>${escapeHtml(verdict)}</p></article><article><p class="eyebrow">ROLLOUT PROGRESS</p><strong>${workload.available}/${workload.desired} ready</strong><div class="rollout-progress"><i style="width:${progress}%"></i></div><small>Desired ${workload.desired} · Updated ${workload.updated ?? 'not reported'} · Available ${workload.available} · Unavailable ${workload.unavailable ?? 0}</small></article><article><p class="eyebrow">CHANGE IMPACT</p><strong>${changes.length ? 'Review changes' : 'Stable observation'}</strong><p>${escapeHtml(impact)}</p></article></div></section>`;
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
  const changeHtml = changes.length ? changes.map(event => `<li><strong>${escapeHtml(event.title)}</strong><small>${new Date(event.timestamp * 1000).toLocaleString()} · ${escapeHtml(event.detail || '')}</small></li>`).join('') : '<li class="deployment-change-empty"><span>✓</span><div><strong>No deployment change detected</strong><small>Current local telemetry has not observed an image, readiness, or restart change for this workload yet.</small></div><em>Healthy baseline</em></li>';
  target.innerHTML = `<div class="deployment-selector">${deployments.map(item => `<button class="${item.name === selected.name ? 'active' : ''}" data-deployment-select="${escapeHtml(item.name)}">${escapeHtml(item.name)}<small>${item.available}/${item.desired} ready</small></button>`).join('')}</div><div class="deployment-summary-grid"><div class="deployment-overview"><span class="${severityClass(selected.status === 'Ready' || selected.status === 'Completed' ? 'healthy' : 'warning')}">${escapeHtml(selected.status)}</span><h3>${escapeHtml(selected.name)}</h3><p>${escapeHtml(selected.type)} · ${escapeHtml(selected.image)}</p><div class="deployment-stat-grid"><span><b>${selected.available}/${selected.desired}</b> ready</span><span><b>${summary.resource_count}</b> resources</span><span><b>${summary.restarts}</b> restarts</span><span><b>${summary.cpu_percent}%</b> total CPU</span></div></div><div class="memory-donut-wrap"><div class="memory-donut" style="--memory:${memoryPercent}%"><strong>${memoryPercent.toFixed(0)}%</strong><small>memory used</small></div><p>${summary.memory_mib} MiB / ${summary.memory_limit_mib || '—'} MiB</p></div><div class="deployment-trend">${deploymentMemoryChart(selected.memory_history || [])}</div></div><section class="deployment-changes"><div class="panel-title deployment-history-title"><div><p class="eyebrow">DEPLOYMENT HISTORY</p><h2>Recent deployment changes</h2></div></div><p class="helper">Image and readiness changes from the current observation window.</p><ul>${changeHtml}</ul></section><div class="deployment-resource-grid"><section class="deployment-resource-list"><div class="timeline-heading"><span>Resources</span><small>Click one for details</small></div>${resources.length ? resources.map(item => `<button class="deployment-resource ${item.pod.name === selectedDeploymentResource ? 'active' : ''}" data-resource-select="${escapeHtml(item.pod.name)}"><span class="${severityClass(item.pod.risk)}">${escapeHtml(item.pod.status)}</span><strong>${escapeHtml(item.pod.name)}</strong><small>CPU ${percent(item.pod.cpu_percent)} · Memory ${percent(item.pod.memory_percent)} · Restarts ${item.pod.restarts}</small></button>`).join('') : '<p class="empty">No matching resource was found for this deployment.</p>'}</section><section class="deployment-resource-detail">${resource ? `<p class="eyebrow">SELECTED RESOURCE</p><h3>${escapeHtml(resource.pod.name)}</h3><div class="detail-grid"><div class="detail-metric"><span>CPU</span><strong>${percent(resource.pod.cpu_percent)}</strong><small>${resource.pod.cpu_millicores} millicores</small></div><div class="detail-metric"><span>Memory</span><strong>${resource.pod.memory_mib} MiB</strong><small>${percent(resource.pod.memory_percent)} of limit</small></div><div class="detail-metric"><span>Forecast</span><strong>${resource.forecast.forecast_percent ?? resource.pod.memory_percent}%</strong><small>15-minute projected memory</small></div><div class="detail-metric"><span>Signals</span><strong>${resource.analysis.counts?.errors || 0}</strong><small>Current log errors</small></div></div><p class="helper">${escapeHtml(resource.analysis.findings?.[0] || 'No critical signal in the current log sample.')}</p><button class="open-resource-detail" data-open-pod="${escapeHtml(resource.pod.name)}">Open full pod investigation</button>` : '<p class="empty">Select a resource to inspect it.</p>'}</section></div>`;
  const evidenceCount = (data?.incident_evidence || []).filter(item => resources.some(resourceItem => resourceItem.pod.name === item.pod)).length;
  target.querySelector('.deployment-changes')?.insertAdjacentHTML('beforebegin', `<section class="deployment-impact-map"><button class="impact-node"><small>WORKLOAD</small><strong>${escapeHtml(selected.name)}</strong><small>${escapeHtml(selected.type)}</small></button><button class="impact-node"><small>SERVICE</small><strong>${selected.exposed ? 'Exposed service' : 'Internal service'}</strong><small>${selected.exposed ? 'Reachable outside cluster' : 'Cluster-only access'}</small></button><button class="impact-node actionable" data-impact-resource><small>PODS / CONTAINERS</small><strong>${summary.resource_count || 0} monitored</strong><small>${selected.available}/${selected.desired} ready</small></button><button class="impact-node actionable" data-impact-logs><small>LIVE LOGS</small><strong>${resource?.analysis?.counts?.errors || 0} errors</strong><small>Open current pod context</small></button><button class="impact-node actionable" data-impact-evidence><small>INCIDENT EVIDENCE</small><strong>${evidenceCount} captures</strong><small>Restart and failure snapshots</small></button></section>`);
  target.querySelector('.deployment-impact-map')?.insertAdjacentHTML('afterend', workloadDetailsHtml(selected, resources));
  target.querySelector('.workload-commands')?.remove();
  target.querySelector('.deployment-impact-map')?.insertAdjacentHTML('afterend', workloadOperationsSummaryHtml(selected, resources, changes));
  target.querySelector('.workload-details')?.insertAdjacentHTML('afterend', workloadReleaseHtml(selected));
  const route = (selected.routes || [])[0] || '';
  target.querySelector('.workload-release-summary')?.insertAdjacentHTML('afterend', `<div class="workload-quick-actions"><span>Quick actions</span><button type="button" data-workload-open-logs ${resource?.pod?.name ? '' : 'disabled'}>View pod logs</button><button type="button" data-workload-open-investigation ${resource?.pod?.name ? '' : 'disabled'}>Open investigation</button><button type="button" data-workload-copy-route ${route ? '' : 'disabled'}>${route ? 'Copy route' : 'No route available'}</button></div>`);
  const selector = target.querySelector('.deployment-selector');
  selector.innerHTML = `<label>Choose deployment <select id="deployment-select">${[...deployments].sort((left, right) => left.name.localeCompare(right.name)).map(item => `<option value="${escapeHtml(item.name)}" ${item.name === selected.name ? 'selected' : ''}>${escapeHtml(item.name)} · ${escapeHtml(item.status)}</option>`).join('')}</select></label><span>${deployments.length} deployments available</span>`;
  selector.querySelector('#deployment-select').addEventListener('change', event => { selectedDeploymentName = event.target.value; selectedDeploymentResource = undefined; renderDeploymentInspector(deployments); });
  target.querySelectorAll('[data-deployment-select]').forEach(button => button.addEventListener('click', () => { selectedDeploymentName = button.dataset.deploymentSelect; selectedDeploymentResource = undefined; renderDeploymentInspector(deployments); }));
  target.querySelectorAll('[data-resource-select]').forEach(button => button.addEventListener('click', () => { selectedDeploymentResource = button.dataset.resourceSelect; renderDeploymentInspector(deployments); openPodInvestigation(button.dataset.resourceSelect); }));
  target.querySelector('[data-open-pod]')?.addEventListener('click', () => openPodInvestigation(target.querySelector('[data-open-pod]').dataset.openPod));
  target.querySelector('[data-workload-open-logs]')?.addEventListener('click', () => { if (!resource?.pod?.name) return; logExplorerPodName = resource.pod.name; setWorkspacePage('logs'); document.querySelector('#log-explorer-panel')?.scrollIntoView({ behavior: 'smooth', block: 'start' }); });
  target.querySelector('[data-workload-open-investigation]')?.addEventListener('click', () => { if (resource?.pod?.name) openPodInvestigation(resource.pod.name); });
  target.querySelector('[data-workload-copy-route]')?.addEventListener('click', async event => { if (!route) return; try { await navigator.clipboard.writeText(route); event.currentTarget.textContent = 'Route copied'; } catch { event.currentTarget.textContent = route; } });
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
  target.querySelectorAll('.copy-command').forEach(button => button.addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(button.dataset.command); button.textContent = 'Copied'; setTimeout(() => { button.textContent = 'Copy'; }, 1200); }
    catch { window.prompt('Copy this command', button.dataset.command); }
  }));
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

function describeErrorSignature(signature, levels) {
  const text = String(signature || '').toLowerCase();
  const severity = levels?.has('critical') || levels?.has('error') ? 'Needs attention' : 'Warning to review';
  if (/database|postgres|mysql|mongodb|connection.*(timeout|refused)|sql/.test(text)) return { title: 'Database connection problem', impact: 'Requests that need data may fail or become slow.', severity };
  if (/timeout|timed out|deadline exceeded/.test(text)) return { title: 'Application request timed out', impact: 'Some users or dependent services may experience delays.', severity };
  if (/out of memory|oom|memory limit|killed process/.test(text)) return { title: 'Application ran out of memory', impact: 'The workload may restart or stop handling requests.', severity: 'Needs attention' };
  if (/unauthorized|forbidden|authentication|access denied/.test(text)) return { title: 'Access or authentication problem', impact: 'Affected users or services may be unable to complete a request.', severity };
  if (/5\d\d|internal server error|bad gateway|service unavailable/.test(text)) return { title: 'Application server error', impact: 'One or more application requests may have failed.', severity };
  if (/not found|\b404\b/.test(text)) return { title: 'Requested resource was not found', impact: 'The affected request cannot complete until the path or resource is corrected.', severity: 'Warning to review' };
  if (/refused|unreachable|dns|host not found/.test(text)) return { title: 'Service connection problem', impact: 'The application may not be able to reach a required dependency.', severity };
  return { title: 'Repeated application error', impact: 'Review the matching logs to confirm user impact and the next action.', severity };
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

function directTailHtml() {
  const active = Boolean(directTailSource);
  const statusClass = /^connected/i.test(directTailStatus) ? 'healthy' : /error|unavailable/i.test(directTailStatus) ? 'critical' : active ? 'warning' : 'healthy';
  return `<section id="direct-live-tail" class="direct-live-tail"><header><div><p class="eyebrow">DIRECT LIVE TAIL</p><h3>${escapeHtml(directTailPod || logExplorerPodName)}</h3><small>Reads new log lines directly from this workload. It does not restart or change the pod.</small></div><div class="direct-tail-controls"><span class="${severityClass(statusClass)}">${escapeHtml(directTailStatus)}</span><button type="button" class="${active ? 'danger' : 'primary'}" data-direct-tail-toggle>${active ? 'Stop tail' : 'Start live tail'}</button><button type="button" data-direct-tail-clear ${directTailRecords.length ? '' : 'disabled'}>Clear</button></div></header><div class="direct-tail-list">${directTailRecords.length ? directTailRecords.slice(-300).map(record => `<article><span class="${severityClass(record.level === 'warn' ? 'warning' : record.level === 'error' || record.level === 'critical' ? 'critical' : 'healthy')}">${escapeHtml(record.level)}</span><time>${escapeHtml(record.timestamp || 'now')}</time><p>${escapeHtml(record.message)}</p></article>`).join('') : '<p class="direct-tail-empty">Start Live Tail when you want to watch new log lines while testing this pod.</p>'}</div></section>`;
}

function podLogEvidenceHtml() {
  const podName = logExplorerPodName;
  const deployment = (data?.deployments || []).find(item => (item.resources || []).some(resource => resource.pod?.name === podName));
  const nativeEvents = (data?.pod_events || []).filter(event => event.pod === podName).map(event => ({ ...event, title: event.reason || 'Kubernetes event', detail: event.message || '', timestamp: event.timestamp, sourceLabel: 'Kubernetes' }));
  const observedEvents = (observabilityData?.events || []).filter(event => event.pod === podName || event.workload === deployment?.name).map(event => ({ ...event, title: event.title || 'Runtime event', detail: event.detail || '', timestamp: event.timestamp ? new Date(Number(event.timestamp) * 1000).toISOString() : null, sourceLabel: 'Monitoring signal' }));
  const byIdentity = new Map();
  [...nativeEvents, ...observedEvents].forEach(event => {
    const identity = `${event.sourceLabel}|${event.title}|${event.detail}|${event.timestamp || ''}`;
    if (!byIdentity.has(identity)) byIdentity.set(identity, event);
  });
  const events = [...byIdentity.values()].sort((left, right) => Date.parse(right.timestamp || 0) - Date.parse(left.timestamp || 0)).slice(0, 8);
  const comparison = (correlationIntelligence?.deployment_comparisons || []).find(item => item.workload === deployment?.name);
  const releaseText = comparison ? comparison.status === 'regressed' ? 'Signals worsened after the observed release' : comparison.status === 'stable' ? 'No material regression found after the observed release' : 'Collecting an earlier baseline for this release' : 'No observed deployment change is available yet';
  const eventEmpty = data?.mode === 'docker' ? 'Local Docker does not expose Kubernetes events. Runtime, restart, and deployment changes will appear here when they are detected.' : 'No recent Kubernetes or runtime events were found for this pod.';
  return `<section class="pod-log-evidence"><div class="pod-log-events"><header><div><p class="eyebrow">POD EVENTS</p><h3>Events alongside this pod’s logs</h3><small>Native Kubernetes events when available, plus PulseOps-detected runtime and deployment changes.</small></div><span>${events.length} recent</span></header><div class="pod-log-event-list">${events.length ? events.map(event => `<article><span class="${severityClass(event.severity || 'healthy')}">${escapeHtml(event.sourceLabel)}</span><div><b>${escapeHtml(event.title)}</b><p>${escapeHtml(event.detail)}</p></div><time>${event.timestamp ? escapeHtml(new Date(event.timestamp).toLocaleString()) : 'Time unavailable'}</time></article>`).join('') : `<p class="pod-log-event-empty">${escapeHtml(eventEmpty)}</p>`}</div></div><aside class="pod-release-summary"><p class="eyebrow">LAST OBSERVED RELEASE</p><h3>${escapeHtml(deployment?.name || 'Deployment mapping unavailable')}</h3><span class="status ${comparison?.status === 'regressed' ? 'critical' : comparison?.status === 'stable' ? 'healthy' : 'warning'}">${escapeHtml(comparison?.status === 'regressed' ? 'Review required' : comparison?.status === 'stable' ? 'Stable' : 'Baseline pending')}</span><p>${escapeHtml(releaseText)}</p>${comparison ? `<dl><div><dt>Before errors</dt><dd>${comparison.before?.errors ?? '—'}</dd></div><div><dt>After errors</dt><dd>${comparison.after?.errors ?? '—'}</dd></div><div><dt>Restart change</dt><dd>${comparison.deltas?.restarts == null ? '—' : `${comparison.deltas.restarts > 0 ? '+' : ''}${comparison.deltas.restarts}`}</dd></div></dl>` : '<small>PulseOps compares retained readiness, restart, capacity, and log-error signals after a release is observed.</small>'}</aside></section>`;
}

function renderDirectTail() {
  const current = document.querySelector('#direct-live-tail');
  if (current) current.outerHTML = directTailHtml();
  bindDirectTailControls();
}

function stopDirectTail(status = 'Stopped') {
  directTailSource?.close();
  directTailSource = null;
  directTailStatus = status;
}

function startDirectTail() {
  const pod = logExplorerPodName;
  stopDirectTail('Connecting…');
  directTailPod = pod;
  directTailRecords = [];
  renderDirectTail();
  const source = new EventSource(`/api/pods/${encodeURIComponent(pod)}/tail`);
  directTailSource = source;
  source.addEventListener('status', event => {
    if (source !== directTailSource) return;
    const message = JSON.parse(event.data);
    directTailStatus = message.state === 'connected' ? 'Connected' : String(message.state || 'Connected');
    renderDirectTail();
  });
  source.addEventListener('log', event => {
    if (source !== directTailSource) return;
    const payload = JSON.parse(event.data);
    directTailRecords.push(payload.record);
    if (directTailRecords.length > 500) directTailRecords = directTailRecords.slice(-500);
    renderDirectTail();
  });
  source.addEventListener('tail-error', event => {
    if (source !== directTailSource) return;
    const payload = JSON.parse(event.data);
    stopDirectTail(payload.message || 'Live tail unavailable');
    renderDirectTail();
  });
  source.addEventListener('complete', () => {
    if (source !== directTailSource) return;
    stopDirectTail('Stream ended');
    renderDirectTail();
  });
  source.onerror = () => {
    if (source !== directTailSource) return;
    directTailStatus = 'Reconnecting…';
    renderDirectTail();
  };
}

function bindDirectTailControls() {
  const controls = document.querySelector('.direct-tail-controls');
  if (controls && !controls.querySelector('[data-direct-tail-pod]')) controls.insertAdjacentHTML('afterbegin', `<label class="direct-tail-picker" aria-label="Pod for direct live tail"><select data-direct-tail-pod aria-label="Select pod for direct live tail">${(data?.pods || []).map(pod => `<option value="${escapeHtml(pod.name)}" ${pod.name === (directTailPod || logExplorerPodName) ? 'selected' : ''}>${escapeHtml(pod.name)}</option>`).join('')}</select></label>`);
  controls?.querySelector('[data-direct-tail-pod]')?.addEventListener('change', event => {
    logExplorerPodName = event.target.value;
    directTailPod = event.target.value;
    logExplorerSelectedIndex = undefined;
    renderLogExplorer();
    startDirectTail();
  });
  document.querySelector('[data-direct-tail-toggle]')?.addEventListener('click', () => directTailSource ? (stopDirectTail(), renderDirectTail()) : startDirectTail());
  document.querySelector('[data-direct-tail-clear]')?.addEventListener('click', () => { directTailRecords = []; renderDirectTail(); });
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
  const errorGroups = groupedErrorSignatures((record, pod) => (!rangeMs || (record.timestamp && Date.parse(record.timestamp) >= cutoff)) && (errorSignatureScope === 'all' || pod === errorSignatureScope));
  const matchesLogFilters = record => (!rangeMs || (record.timestamp && Date.parse(record.timestamp) >= cutoff)) && (logExplorerLevel === 'all' || record.level === logExplorerLevel) && (!search || `${record.level} ${record.message} ${record.raw}`.toLocaleLowerCase().includes(search)) && (!fieldSearch || JSON.stringify(record.fields || {}).toLocaleLowerCase().includes(fieldSearch));
  const streamRecords = Object.entries(data.structured_logs || {}).flatMap(([pod, podRecords]) => podRecords.filter(matchesLogFilters).map(record => ({ pod, record }))).sort((left, right) => Date.parse(right.record.timestamp || 0) - Date.parse(left.record.timestamp || 0)).slice(0, 100);
  target.innerHTML = `<section class="log-summary"><article><span>Errors</span><strong>${errorCount}</strong><small>Latest: ${escapeHtml(latestError)}</small></article><article><span>Warnings</span><strong>${warningCount}</strong><small>Current sampled window</small></article><article><span>Recurring patterns</span><strong>${patterns.length}</strong><small>Repeated error signatures</small></article><article><span>Available data</span><strong>${records.length}</strong><small>${escapeHtml(sourceNote)}</small></article></section><div class="log-control-bar"><label>Pod<select id="log-explorer-pod">${data.pods.map(pod => `<option value="${escapeHtml(pod.name)}" ${pod.name === logExplorerPodName ? 'selected' : ''}>${escapeHtml(pod.name)} · ${escapeHtml(pod.status)}</option>`).join('')}</select></label><label>Time range<select id="log-explorer-range"><option value="all" ${logExplorerRange === 'all' ? 'selected' : ''}>Available sample</option><option value="5m" ${logExplorerRange === '5m' ? 'selected' : ''}>Last 5 minutes</option><option value="15m" ${logExplorerRange === '15m' ? 'selected' : ''}>Last 15 minutes</option><option value="1h" ${logExplorerRange === '1h' ? 'selected' : ''}>Last hour</option><option value="6h" ${logExplorerRange === '6h' ? 'selected' : ''}>Last 6 hours</option></select></label><label>Severity<select id="log-explorer-level"><option value="all" ${logExplorerLevel === 'all' ? 'selected' : ''}>All events</option><option value="critical" ${logExplorerLevel === 'critical' ? 'selected' : ''}>Critical</option><option value="error" ${logExplorerLevel === 'error' ? 'selected' : ''}>Errors</option><option value="warn" ${logExplorerLevel === 'warn' ? 'selected' : ''}>Warnings</option><option value="info" ${logExplorerLevel === 'info' ? 'selected' : ''}>Information</option></select></label><label class="log-search">Search<input id="log-explorer-search" value="${escapeHtml(logExplorerSearch)}" placeholder="Error text, request ID, message…"></label><button data-log-apply-search>Search</button><button class="live-tail ${logExplorerLiveTail ? 'active' : ''}" data-log-live-tail>${logExplorerLiveTail ? '● Live tail on' : '○ Live tail paused'}</button></div><details class="advanced-log-filters"><summary>Advanced filter</summary><label>Structured field value<input id="log-explorer-field-search" value="${escapeHtml(logExplorerFieldSearch)}" placeholder="e.g. request_id, 500, timeout"></label><button type="button" data-log-apply-field>Apply filter</button></details><div class="log-action-bar"><label>Saved query<select id="log-saved-query"><option value="">Choose a saved query</option>${queryOptions.map((query, index) => `<option value="${index}">${escapeHtml(query.name)}</option>`).join('')}</select></label><button data-log-save-query>Save current query</button><label>Context<select id="log-context-before"><option value="5" ${logExplorerBefore === 5 ? 'selected' : ''}>5 before</option><option value="20" ${logExplorerBefore === 20 ? 'selected' : ''}>20 before</option><option value="100" ${logExplorerBefore === 100 ? 'selected' : ''}>100 before</option></select></label><label>Following<select id="log-context-after"><option value="0" ${logExplorerAfter === 0 ? 'selected' : ''}>None</option><option value="5" ${logExplorerAfter === 5 ? 'selected' : ''}>5 after</option><option value="20" ${logExplorerAfter === 20 ? 'selected' : ''}>20 after</option></select></label><span>${recent.length}/${records.length} records shown</span><button data-log-export="json">Export JSON</button><button data-log-export="csv">Export CSV</button></div><section class="live-log-stream"><header><div><p class="eyebrow">LIVE LOG STREAM</p><h3>Latest events across monitored pods</h3><small>Updates with the dashboard refresh. Click an event to inspect that pod’s structured context.</small></div><div class="stream-controls"><button type="button" class="${logExplorerStreamScope === 'all' ? 'active' : ''}" data-log-stream-scope="all">All pods</button><button type="button" class="${logExplorerStreamScope === 'selected' ? 'active' : ''}" data-log-stream-scope="selected">Selected pod</button></div></header><div class="live-stream-list">${(logExplorerStreamScope === 'all' ? streamRecords : streamRecords.filter(item => item.pod === logExplorerPodName)).length ? (logExplorerStreamScope === 'all' ? streamRecords : streamRecords.filter(item => item.pod === logExplorerPodName)).map(({ pod, record }) => `<button type="button" class="live-stream-event" data-live-stream-pod="${escapeHtml(pod)}" data-live-stream-index="${record.index}"><span class="${severityClass(severity(record))}">${escapeHtml(record.level)}</span><b>${escapeHtml(pod)}</b><time>${escapeHtml(record.timestamp || `Entry ${record.index + 1}`)}</time><p>${escapeHtml(record.message)}</p></button>`).join('') : '<p class="empty">No matching events in the available live sample.</p>'}</div></section><div class="log-explorer-grid"><div class="log-event-list"><div class="log-list-heading"><strong>${escapeHtml(logExplorerPodName)}</strong><small>${records.length} recent records</small></div>${recent.length ? recent.map(record => `<button class="log-event ${record.index === logExplorerSelectedIndex ? 'active' : ''}" data-log-explorer-index="${record.index}"><span class="${severityClass(severity(record))}">${escapeHtml(record.level)}</span><strong>${escapeHtml(record.timestamp || `Entry ${record.index + 1}`)}</strong><small>${escapeHtml(record.message)}</small></button>`).join('') : '<p class="empty">No matching logs for this filter.</p>'}</div><div class="log-json-view">${selected ? `<div class="log-list-heading"><strong>${logExplorerJsonOpen ? 'JSON context' : 'Selected log event'}</strong><small>${logExplorerJsonOpen ? `${Math.max(0, context.length - 1)} nearby events included` : 'Open as JSON for full details'}</small></div>${logExplorerJsonOpen ? `<pre class="large-log">${escapeHtml(JSON.stringify(context, null, 2))}</pre><button class="log-json-action" data-log-json-close>Show selected event</button>` : `<div class="log-preview"><span class="${severityClass(severity(selected))}">${escapeHtml(selected.level)}</span><p>${escapeHtml(selected.message)}</p><button class="log-json-action" data-log-json-open>Open JSON context</button></div>`}` : '<p class="empty">Choose a log event to inspect it.</p>'}</div></div><section class="pattern-panel"><div><p class="eyebrow">RECURRING ERROR PATTERNS</p><h3>Potential incident signals</h3></div>${patterns.length ? patterns.map(item => `<article><strong>${item.count} occurrences</strong><p>${escapeHtml(item.pattern)}</p><button data-pattern-filter="${escapeHtml(item.pattern)}">Filter</button><button data-pattern-alert="${escapeHtml(item.pattern)}">Create alert</button></article>`).join('') : '<p class="empty">No repeated error or critical pattern in the current sample.</p>'}</section>`;
  const rangeSelector = target.querySelector('#log-explorer-range');
  const beforeSelector = target.querySelector('#log-context-before');
  const afterSelector = target.querySelector('#log-context-after');
  const savedQuerySelector = target.querySelector('#log-saved-query');
  const saveQueryButton = target.querySelector('[data-log-save-query]');
  if (beforeSelector?.parentElement?.firstChild) beforeSelector.parentElement.firstChild.textContent = 'Logs before selected event';
  if (afterSelector?.parentElement?.firstChild) afterSelector.parentElement.firstChild.textContent = 'Logs after selected event';
  if (savedQuerySelector?.parentElement?.firstChild) savedQuerySelector.parentElement.firstChild.textContent = 'Saved searches';
  if (saveQueryButton) {
    saveQueryButton.textContent = '+ Save this search';
    saveQueryButton.classList.add('save-log-query');
    saveQueryButton.title = 'Save the current pod, time range, severity, and search terms';
  }
  target.querySelector('.log-action-bar')?.insertAdjacentHTML('beforeend', '<small class="json-context-note">Applies only when you open JSON context.</small>');
  target.querySelector('.log-explorer-grid')?.insertAdjacentHTML('afterend', `${directTailHtml()}${podLogEvidenceHtml()}`);
  bindDirectTailControls();
  const streamEmpty = target.querySelector('.live-stream-list .empty');
  if (streamEmpty) {
    streamEmpty.classList.add('live-stream-empty');
    streamEmpty.textContent = 'No recent log events match the current stream selection or filters.';
  }
  [['12h', 'Last 12 hours'], ['24h', 'Last 24 hours']].forEach(([value, label]) => {
    const option = document.createElement('option'); option.value = value; option.textContent = label; option.selected = logExplorerRange === value; rangeSelector.append(option);
  });
  if (selectedExplanation) target.querySelector('.log-json-view')?.insertAdjacentHTML('afterbegin', `${selectedExplanation}${selectedTrace}`);
  target.querySelector('.pattern-panel')?.insertAdjacentHTML('beforebegin', `<section class="error-signature-panel"><header><div><p class="eyebrow">GROUPED ERROR SIGNATURES</p><h3>Repeated failures across available pods</h3></div><small>${errorGroups.length} normalized group${errorGroups.length === 1 ? '' : 's'} · current available samples</small></header>${errorGroups.length ? `<div>${errorGroups.map((group, index) => `<article><span class="signature-rank">${index + 1}</span><div><b>${escapeHtml(group.signature)}</b><p>${group.count} occurrence${group.count === 1 ? '' : 's'} across ${group.pods.size} pod${group.pods.size === 1 ? '' : 's'} · ${escapeHtml([...group.levels].join(', '))}</p><small>${escapeHtml([...group.pods].slice(0, 5).join(', '))}${group.pods.size > 5 ? ` +${group.pods.size - 5} more` : ''}</small></div><div><small>${escapeHtml(group.first || 'Time unavailable')} → ${escapeHtml(group.last || 'Time unavailable')}</small><button type="button" data-error-group-pod="${escapeHtml(group.examplePod)}" data-error-group-index="${group.example.index}">View matching log</button></div></article>`).join('')}</div>` : '<p class="empty">No warning, error, or critical signatures in the available samples.</p>'}</section>`);
  const signaturePanel = target.querySelector('.error-signature-panel');
  const signatureEmpty = signaturePanel?.querySelector(':scope > .empty');
  if (signatureEmpty) {
    signatureEmpty.classList.add('signature-empty');
    signatureEmpty.textContent = errorSignatureScope === 'all' ? 'No repeated warning, error, or critical patterns were found across the monitored pods.' : `No warning, error, or critical patterns were found for ${errorSignatureScope}.`;
  }
  signaturePanel?.querySelector('header > div')?.insertAdjacentHTML('afterend', `<label class="signature-scope-picker">Show signatures for<select id="error-signature-scope"><option value="all" ${errorSignatureScope === 'all' ? 'selected' : ''}>All monitored pods</option>${data.pods.map(pod => `<option value="${escapeHtml(pod.name)}" ${errorSignatureScope === pod.name ? 'selected' : ''}>${escapeHtml(pod.name)}</option>`).join('')}</select></label>`);
  signaturePanel?.querySelector('h3')?.replaceChildren(document.createTextNode(errorSignatureScope === 'all' ? 'Repeated failures across all monitored pods' : `Repeated failures in ${errorSignatureScope}`));
  target.querySelector('.error-signature-panel header > small')?.replaceWith(Object.assign(document.createElement('small'), { textContent: errorGroups.length ? 'Grouped by similar log messages in the current sample' : 'No repeated issues found' }));
  target.querySelectorAll('.error-signature-panel article').forEach((article, index) => {
    const group = errorGroups[index];
    if (!group) return;
    const description = describeErrorSignature(group.signature, group.levels);
    const detail = article.querySelector(':scope > div');
    const technical = detail?.querySelector('b');
    const facts = detail?.querySelector('p');
    technical?.classList.add('signature-technical');
    technical?.insertAdjacentHTML('beforebegin', `<strong class="signature-title">${escapeHtml(description.title)}</strong><span class="signature-impact">${escapeHtml(description.impact)}</span><span class="signature-status">${escapeHtml(description.severity)}</span>`);
    if (facts) facts.textContent = `Seen ${group.count} time${group.count === 1 ? '' : 's'} across ${group.pods.size} pod${group.pods.size === 1 ? '' : 's'} · ${[...group.levels].join(', ')}`;
    if (isDeveloperOrAdministrator()) {
      const button = document.createElement('button');
      button.type = 'button'; button.textContent = 'Open investigation'; button.dataset.errorGroupWorkspace = group.examplePod;
      article.lastElementChild?.append(button);
    }
  });
  target.querySelectorAll('[data-error-group-workspace]').forEach(button => button.addEventListener('click', () => openDeveloperInvestigation(button.dataset.errorGroupWorkspace)));
  target.querySelector('#error-signature-scope')?.addEventListener('change', event => { errorSignatureScope = event.target.value; if (errorSignatureScope !== 'all') logExplorerPodName = errorSignatureScope; renderLogExplorer(); });
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
    startDirectTail();
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
  target.querySelector('.stream-controls')?.insertAdjacentHTML('afterbegin', `<label class="stream-pod-picker">Live logs from<select id="live-stream-pod"><option value="all" ${logExplorerStreamScope === 'all' ? 'selected' : ''}>All monitored pods</option>${data.pods.map(pod => `<option value="${escapeHtml(pod.name)}" ${logExplorerStreamScope === 'selected' && pod.name === logExplorerPodName ? 'selected' : ''}>${escapeHtml(pod.name)}</option>`).join('')}</select></label>`);
  target.querySelectorAll('[data-log-stream-scope]').forEach(button => button.addEventListener('click', () => { logExplorerStreamScope = button.dataset.logStreamScope; renderLogExplorer(); }));
  target.querySelector('#live-stream-pod')?.addEventListener('change', event => {
    logExplorerStreamScope = event.target.value === 'all' ? 'all' : 'selected';
    if (logExplorerStreamScope === 'selected') logExplorerPodName = event.target.value;
    renderLogExplorer();
  });
  target.querySelectorAll('[data-live-stream-pod]').forEach(button => button.addEventListener('click', () => {
    logExplorerPodName = button.dataset.liveStreamPod;
    logExplorerSelectedIndex = Number(button.dataset.liveStreamIndex);
    logExplorerJsonOpen = true;
    renderLogExplorer();
  }));
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
  }).sort((left, right) => left.name.localeCompare(right.name));
  const pages = Math.max(1, Math.ceil(filtered.length / podPageSize));
  podPage = Math.min(podPage, pages);
  const start = (podPage - 1) * podPageSize;
  const visible = filtered.slice(start, start + podPageSize);
  const pagination = filtered.length > podPageSize ? `<div class="inventory-pagination"><span>Showing ${start + 1}–${Math.min(start + podPageSize, filtered.length)} of ${filtered.length}</span><label>Rows <select id="pod-page-size"><option value="25" ${podPageSize === 25 ? 'selected' : ''}>25</option><option value="50" ${podPageSize === 50 ? 'selected' : ''}>50</option><option value="100" ${podPageSize === 100 ? 'selected' : ''}>100</option></select></label><button type="button" data-pod-prev ${podPage === 1 ? 'disabled' : ''}>Previous</button><span>Page ${podPage} of ${pages}</span><button type="button" data-pod-next ${podPage === pages ? 'disabled' : ''}>Next</button></div>` : `<div class="inventory-total">${filtered.length ? `${filtered.length} pod${filtered.length === 1 ? '' : 's'} shown` : 'No matching pods'} · ${pods.length} total</div>`;
  document.querySelector('#pod-inventory-controls').innerHTML = `<div class="inventory-filters"><label>Find pod <select id="pod-picker"><option value="">Choose a pod</option>${[...pods].sort((left, right) => left.name.localeCompare(right.name)).map(pod => `<option value="${escapeHtml(pod.name)}">${escapeHtml(pod.name)} · ${escapeHtml(pod.status)}</option>`).join('')}</select></label><label>Show <select id="pod-filter"><option value="all" ${podFilter === 'all' ? 'selected' : ''}>All pods</option><option value="attention" ${podFilter === 'attention' ? 'selected' : ''}>Needs attention</option><option value="running" ${podFilter === 'running' ? 'selected' : ''}>Running only</option></select></label></div>${pagination}`;
  document.querySelector('#pods').innerHTML = visible.length ? visible.map(pod => `<tr class="${selectedPodName === pod.name ? 'selected' : ''}">
    <td><button class="pod-link" data-pod="${escapeHtml(pod.name)}">${escapeHtml(pod.name)}</button><small>${escapeHtml(pod.namespace)}</small></td>
    <td><span class="${severityClass(pod.risk)}">${pod.status}</span></td>
    <td>${pod.cpu_millicores}m <div class="bar"><i style="width:${Math.min(100, pod.cpu_percent)}%"></i></div><small>${percent(pod.cpu_percent)} of limit</small></td>
    <td>${pod.memory_mib} MiB <div class="bar memory"><i style="width:${Math.min(100, pod.memory_percent)}%"></i></div><small>${percent(pod.memory_percent)} of limit</small></td>
    <td>${pod.restarts}</td><td>${escapeHtml(pod.node)}</td><td><button class="forecast-button" data-pod="${escapeHtml(pod.name)}">Inspect</button></td></tr>`).join('') : '<tr><td colspan="7" class="empty">No pods match the selected filter.</td></tr>';
  document.querySelectorAll('[data-pod]').forEach(button => button.addEventListener('click', () => openPodInvestigation(button.dataset.pod)));
  document.querySelector('#pod-picker').addEventListener('change', event => { if (event.target.value) openPodInvestigation(event.target.value); });
  document.querySelector('#pod-filter').addEventListener('change', event => { podFilter = event.target.value; podPage = 1; renderPods(pods); });
  document.querySelector('#pod-page-size')?.addEventListener('change', event => { podPageSize = Number(event.target.value); podPage = 1; renderPods(pods); });
  document.querySelector('[data-pod-prev]')?.addEventListener('click', () => { podPage -= 1; renderPods(pods); });
  document.querySelector('[data-pod-next]')?.addEventListener('click', () => { podPage += 1; renderPods(pods); });
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
  if (action) { action.disabled = !alerts.length; action.textContent = alerts.length ? 'Investigate highest-priority alert' : 'No action needed'; }
  const states = alerts.map(alert => acknowledgedAlerts[alertKey(alert)]?.status || 'active');
  const counts = { critical: alerts.filter(alert => alert.severity === 'critical').length, warning: alerts.filter(alert => alert.severity === 'warning').length, investigating: states.filter(state => state === 'investigating').length, acknowledged: states.filter(state => state === 'acknowledged').length, recovered: alertHistory.filter(event => event.state === 'resolved' && new Date(event.last_seen || event.first_seen).getTime() >= Date.now() - 86400000).length };
  const visibleAlerts = alerts.filter(alert => { const state = acknowledgedAlerts[alertKey(alert)]?.status || 'active'; return alertFilter === 'all' || alert.severity === alertFilter || state === alertFilter; });
  const summary = `<div class="alert-summary" aria-label="Alert summary"><button type="button" class="${alertFilter === 'all' ? 'active' : ''}" data-alert-filter="all"><span>Active alerts</span><strong>${alerts.length}</strong><small>Current signals</small></button><button type="button" class="${alertFilter === 'critical' ? 'active critical' : 'critical'}" data-alert-filter="critical"><span>Critical</span><strong>${counts.critical}</strong><small>Immediate review</small></button><button type="button" class="${alertFilter === 'warning' ? 'active warning' : 'warning'}" data-alert-filter="warning"><span>Warnings</span><strong>${counts.warning}</strong><small>Needs review</small></button><button type="button" class="${alertFilter === 'investigating' ? 'active' : ''}" data-alert-filter="investigating"><span>Investigating</span><strong>${counts.investigating}</strong><small>Work in progress</small></button><button type="button" class="${alertFilter === 'acknowledged' ? 'active' : ''}" data-alert-filter="acknowledged"><span>Acknowledged</span><strong>${counts.acknowledged}</strong><small>Owner informed</small></button><button type="button" class="alert-recovered" data-alert-history><span>Recovered in 24h</span><strong>${counts.recovered}</strong><small>Open alert history</small></button></div>`;
  const groups = new Map();
  visibleAlerts.sort((a, b) => severityRank[b.severity] - severityRank[a.severity]).forEach(alert => { const list = groups.get(alert.pod) || []; list.push(alert); groups.set(alert.pod, list); });
  target.innerHTML = `${summary}<div class="alert-filter-note">Showing ${visibleAlerts.length} of ${alerts.length} active alert${alerts.length === 1 ? '' : 's'}.</div>${groups.size ? [...groups.entries()].map(([pod, podAlerts]) => {
    const podHistory = alertHistory.filter(event => event.pod === pod).sort((a, b) => new Date(b.last_seen || b.first_seen) - new Date(a.last_seen || a.first_seen));
    const recent = podHistory[0];
    const activeSince = recent?.first_seen ? `First seen ${new Date(recent.first_seen).toLocaleString()}` : 'First observed in the current collection';
    const impact = podAlerts.some(item => item.severity === 'critical') ? 'Critical signals are affecting this workload.' : 'This workload needs review; no critical signal is currently detected.';
    const change = podHistory.length > 1 ? `${podHistory.length} related alert lifecycles retained.` : 'No earlier related alert lifecycle is retained yet.';
    return `<section class="alert-group"><div class="alert-group-heading"><div><strong>${escapeHtml(pod)}</strong><small>${podAlerts.length} active signal${podAlerts.length === 1 ? '' : 's'} · ${escapeHtml(activeSince)}</small></div><button type="button" data-alert-investigate-pod="${escapeHtml(pod)}">Open workload investigation</button></div><div class="alert-context"><div><b>Impact</b><span>${escapeHtml(impact)}</span></div><div><b>Change & history</b><span>${escapeHtml(change)}</span></div><div><b>Owner & runbook</b><span>Workload owner not configured · use the investigation workspace.</span></div></div>${podAlerts.map(alert => { const key = alertKey(alert); const record = acknowledgedAlerts[key]; const state = record?.status || 'active'; const lifecycle = record ? `<small>${escapeHtml(state)} by ${escapeHtml(record.acknowledged_by)} · ${new Date(record.acknowledged_at).toLocaleString()}${record.note ? ` · ${escapeHtml(record.note)}` : ''}</small>` : '<small>Active and not yet acknowledged</small>'; const controls = isDeveloperOrAdministrator() ? `<div class="alert-actions"><button type="button" data-alert-investigate="${escapeHtml(key)}">Open pod logs</button>${state === 'investigating' ? '<span class="alert-acknowledged">Investigation in progress</span>' : `<button type="button" data-alert-lifecycle="${escapeHtml(key)}" data-alert-status="investigating">Start investigation</button>`}${state === 'acknowledged' ? '<span class="alert-acknowledged">Acknowledged</span>' : `<button type="button" data-alert-lifecycle="${escapeHtml(key)}" data-alert-status="acknowledged">Acknowledge alert</button>`}</div>` : '<span class="alert-acknowledged">View only</span>'; return `<div class="alert ${alert.severity} ${record ? 'acknowledged' : ''}"><span class="${severityClass(alert.severity)}">${escapeHtml(alert.severity)}</span><div><p>${escapeHtml(alert.message)}</p>${lifecycle}</div>${controls}</div>`; }).join('')}</section>`;
  }).join('') : `<p class="empty">${alerts.length ? 'No active alerts match this filter.' : 'No active alerts. The monitored services are currently clear.'}</p>`}`;
  target.querySelectorAll('[data-alert-filter]').forEach(button => button.addEventListener('click', () => { alertFilter = button.dataset.alertFilter; renderAlerts(data?.alerts || []); }));
  target.querySelector('[data-alert-history]')?.addEventListener('click', () => document.querySelector('.alert-history-panel')?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
  target.querySelectorAll('[data-alert-investigate-pod]').forEach(button => button.addEventListener('click', () => openAlertEvidencePath({ pod: button.dataset.alertInvestigatePod, severity: 'warning' })));
  target.querySelectorAll('[data-alert-investigate]').forEach(button => button.addEventListener('click', () => { const alert = alerts.find(item => alertKey(item) === button.dataset.alertInvestigate); if (alert) investigateAlert(alert); }));
  target.querySelectorAll('[data-alert-lifecycle]').forEach(button => button.addEventListener('click', () => updateAlertLifecycle(button.dataset.alertLifecycle, button.dataset.alertStatus, button)));
}

function renderAlertNotifications() {
  const target = document.querySelector('#alert-notifications');
  if (!target) return;
  const settings = notificationSettings;
  const deliveryCopy = settings?.muted ? `Teams notifications are paused until ${new Date(settings.muted_until).toLocaleString()}. Alerts and evidence continue to be collected.` : settings?.webhook_configured ? (settings.enabled ? `New alert breaches are delivered once and recovery is delivered once. ${settings.last_delivery ? `Last delivery ${new Date(settings.last_delivery).toLocaleString()}.` : 'No alert has been sent yet.'}` : 'The approved Teams webhook is available. Enable delivery when you are ready.') : 'Add TEAMS_WEBHOOK_URL and NOTIFICATION_ALLOWED_HOSTS through the deployment Secret; the URL is never shown here.';
  target.innerHTML = isAdministrator() ? `<section class="notification-delivery ${settings?.enabled && settings?.webhook_configured && !settings?.muted ? 'ready' : 'not-ready'}"><div><span>${settings?.muted ? 'Teams delivery paused' : settings?.enabled && settings?.webhook_configured ? 'Teams delivery active' : 'Teams delivery not active'}</span><strong>Microsoft Teams alert delivery</strong><small>${deliveryCopy}${settings?.last_error ? ` Latest delivery issue: ${escapeHtml(settings.last_error)}` : ''}</small></div><div><label class="notification-toggle"><input type="checkbox" data-notification-enabled ${settings?.enabled ? 'checked' : ''} ${settings?.webhook_configured ? '' : 'disabled'}> Enable Teams</label><button type="button" data-notification-pause ${settings?.webhook_configured && settings?.enabled ? '' : 'disabled'}>${settings?.muted ? 'Resume now' : 'Pause 1 hour'}</button><button type="button" data-notification-test ${settings?.webhook_configured ? '' : 'disabled'}>Send test</button></div></section>` : '<p class="rule-view-only">Alert delivery and rules are managed by an administrator.</p>';
  target.querySelector('[data-notification-enabled]')?.addEventListener('change', async event => {
    event.target.disabled = true;
    try { const response = await fetch('/api/notification-settings', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ enabled: event.target.checked, mute_minutes: 0 }) }); const payload = await response.json(); if (!response.ok) throw new Error(payload.detail || 'Unable to update notification delivery.'); notificationSettings = payload.settings; renderAlertNotifications(); } catch (error) { window.alert(error.message); event.target.disabled = false; }
  });
  target.querySelector('[data-notification-pause]')?.addEventListener('click', async event => {
    event.target.disabled = true;
    try { const response = await fetch('/api/notification-settings', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ enabled: true, mute_minutes: settings?.muted ? 0 : 60 }) }); const payload = await response.json(); if (!response.ok) throw new Error(payload.detail || 'Unable to update notification delivery.'); notificationSettings = payload.settings; renderAlertNotifications(); } catch (error) { window.alert(error.message); event.target.disabled = false; }
  });
  target.querySelector('[data-notification-test]')?.addEventListener('click', async event => {
    event.target.disabled = true; event.target.textContent = 'Sending…';
    try { const response = await fetch('/api/notification-settings/test', { method: 'POST' }); const payload = await response.json(); if (!response.ok) throw new Error(payload.detail || 'Unable to send test notification.'); notificationSettings = payload.settings; renderAlertNotifications(); window.alert(payload.message); } catch (error) { window.alert(error.message); event.target.disabled = false; event.target.textContent = 'Send test'; }
  });
}

async function loadNotificationSettings() {
  if (!isAdministrator()) return;
  try {
    const response = await fetch('/api/notification-settings');
    const payload = await response.json();
    if (response.ok) notificationSettings = payload.settings;
  } catch { /* The alert workspace continues without delivery configuration. */ }
}

function renderAlertHistory(events) {
  const target = document.querySelector('#alert-history');
  if (!target) return;
  const visible = [...events].sort((a, b) => new Date(b.last_seen || b.first_seen) - new Date(a.last_seen || a.first_seen)).slice(0, 50);
  const week = alertHistoryReport?.windows?.['7d'] || {};
  const month = alertHistoryReport?.windows?.['30d'] || {};
  const trend = `<div class="alert-trend-summary"><article><span>Last 7 days</span><strong>${Number(week.raised || 0)} raised</strong><small>${Number(week.recovered || 0)} recovered · ${Number(week.critical || 0)} critical</small></article><article><span>Last 30 days</span><strong>${Number(month.raised || 0)} raised</strong><small>${Number(month.recovered || 0)} recovered · ${Number(month.critical || 0)} critical</small></article><article><span>Delivery policy</span><strong>Noise controlled</strong><small>Teams is notified once when a breach starts and once when it recovers.</small></article></div>`;
  target.innerHTML = `${trend}${visible.length ? `<div class="table-wrap"><table class="alert-history-table"><thead><tr><th>Signal</th><th>Pod</th><th>State</th><th>First seen</th><th>Last seen</th><th>Occurrences</th><th></th></tr></thead><tbody>${visible.map(event => `<tr><td>${escapeHtml(event.message || event.rule_id || 'Alert')}</td><td>${escapeHtml(event.pod || 'Cluster')}</td><td><span class="${severityClass(event.state === 'active' ? event.severity : 'healthy')}">${escapeHtml(event.state || 'active')}</span></td><td>${event.first_seen ? new Date(event.first_seen).toLocaleString() : '—'}</td><td>${event.last_seen ? new Date(event.last_seen).toLocaleString() : '—'}</td><td>${Number(event.occurrences || 1)}</td><td><button type="button" data-alert-history-investigate="${escapeHtml(event.pod || '')}">Investigate</button></td></tr>`).join('')}</tbody></table></div>` : '<p class="empty">History is building. Active and recovered alerts will appear here automatically.</p>'}`;
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
    target.innerHTML = '<p class="empty">No incident evidence has been captured yet. L1ControlScope keeps a rolling 15-minute log window and saves it automatically for repeated errors, restarts, failures, or evictions.</p>';
    return;
  }
  target.innerHTML = `<div class="incident-evidence-list">${incidents.map(item => {
    const severity = item.severity || (item.kind === 'restart' ? 'warning' : 'critical');
    const kind = item.kind === 'repeated_error' ? 'repeated errors' : String(item.kind || 'incident').replace('_', ' ');
    const deployment = item.deployment?.name ? `${item.deployment.name}${item.deployment.image ? ` · ${item.deployment.image}` : ''}` : 'Deployment mapping unavailable';
    return `<article class="incident-evidence-card ${escapeHtml(item.kind)} ${escapeHtml(severity)}"><div><span class="${severityClass(severity)}">${escapeHtml(kind)}</span><strong>${escapeHtml(item.pod)}</strong><small>${new Date(item.detected_at).toLocaleString()} · ${item.log_count} captured log records</small><small>${escapeHtml(deployment)}</small><p>${escapeHtml(item.detail)}</p></div><button type="button" data-incident-evidence-open="${escapeHtml(item.id)}">Open evidence</button></article>`;
  }).join('')}</div><div id="incident-evidence-detail"></div>`;
  target.querySelectorAll('[data-incident-evidence-open]').forEach(button => button.addEventListener('click', async () => {
    button.disabled = true; button.textContent = 'Loading…';
    try {
      const response = await fetch(`/api/incident-evidence/${encodeURIComponent(button.dataset.incidentEvidenceOpen)}`);
      const incident = await response.json();
      if (!response.ok) throw new Error(incident.detail || 'Captured evidence is unavailable.');
      const detail = target.querySelector('#incident-evidence-detail');
      const exportId = `incident-${incident.id}`;
      const kind = incident.kind === 'repeated_error' ? 'repeated errors' : String(incident.kind || 'incident').replace('_', ' ');
      const deployment = incident.deployment?.name ? ` Deployment: ${incident.deployment.name}${incident.deployment.image ? ` (${incident.deployment.image}).` : '.'}` : '';
      const alerts = Array.isArray(incident.active_alerts) && incident.active_alerts.length ? ` ${incident.active_alerts.length} related active alert${incident.active_alerts.length === 1 ? '' : 's'} recorded.` : '';
      detail.innerHTML = `<section class="incident-evidence-detail"><div><p class="eyebrow">${escapeHtml(incident.pod)} · ${escapeHtml(kind)}</p><h3>Captured incident evidence</h3><p>${escapeHtml(incident.detail)} This snapshot contains ${incident.log_window.length} masked records from the preceding evidence window.${escapeHtml(deployment + alerts)}</p></div><button type="button" data-incident-evidence-export="${escapeHtml(exportId)}">Export JSON</button><pre>${escapeHtml(JSON.stringify(incident, null, 2))}</pre></section>`;
      detail.querySelector('[data-incident-evidence-export]').addEventListener('click', () => {
        const link = Object.assign(document.createElement('a'), { href: URL.createObjectURL(new Blob([JSON.stringify(incident, null, 2)], { type: 'application/json' })), download: `${incident.pod}-${incident.kind}-evidence.json` });
        link.click(); URL.revokeObjectURL(link.href);
      });
      detail.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    } catch (error) { window.alert(error.message); } finally { button.disabled = false; button.textContent = 'Open evidence'; }
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
  const search = accessUserSearch.trim().toLowerCase();
  const filtered = users.filter(user => (role === 'all' || user.role === role) && (!search || `${user.name || ''} ${user.email || ''}`.toLowerCase().includes(search))).sort((left, right) => String(left.name || '').localeCompare(String(right.name || '')));
  const active = users.filter(user => user.enabled !== false).length;
  const administrators = users.filter(user => user.role === 'administrator').length;
  const disabled = users.filter(user => user.enabled === false).length;
  const rows = filtered.map(user => `<tr class="${user.enabled === false ? 'user-disabled' : ''}"><td><strong>${escapeHtml(user.name)}</strong></td><td>${escapeHtml(user.email)}</td><td>${escapeHtml(roleLabel(user.role))}</td><td><span class="${severityClass(user.enabled === false ? 'critical' : 'healthy')}">${user.enabled === false ? 'Disabled' : 'Active'}</span></td><td>${user.created_at ? new Date(user.created_at).toLocaleDateString() : '—'}</td><td class="user-actions"><button type="button" data-user-manage="${escapeHtml(user.email)}">Manage</button></td></tr>`).join('');
  target.innerHTML = `<div class="access-summary"><article><span>Total accounts</span><strong>${users.length}</strong><small>Local access records</small></article><article><span>Active users</span><strong>${active}</strong><small>Can sign in now</small></article><article><span>Administrators</span><strong>${administrators}</strong><small>Manage access and sources</small></article><article><span>Disabled</span><strong>${disabled}</strong><small>Retained for audit</small></article></div><div class="inventory-controls access-controls"><label class="access-search"><span>Find user</span><input id="access-user-search" value="${escapeHtml(accessUserSearch)}" placeholder="Name or login"></label><label>Role <select id="user-role-filter"><option value="all" ${role === 'all' ? 'selected' : ''}>All roles</option><option value="administrator" ${role === 'administrator' ? 'selected' : ''}>Administrators</option><option value="developer" ${role === 'developer' ? 'selected' : ''}>Developers / Operators</option><option value="readonly" ${role === 'readonly' ? 'selected' : ''}>Read-only</option></select></label><span class="access-result-count">${filtered.length} shown</span><button id="export-users">Export displayed list</button></div><div class="table-wrap"><table><thead><tr><th>Name</th><th>Login</th><th>Role</th><th>Access</th><th>Created</th><th><span class="sr-only">Actions</span></th></tr></thead><tbody>${rows || '<tr><td colspan="6">No matching users.</td></tr>'}</tbody></table></div>`;
  target.querySelector('#user-role-filter').addEventListener('change', () => renderAccessUsers(users));
  target.querySelector('#access-user-search').addEventListener('input', event => { accessUserSearch = event.target.value; renderAccessUsers(users); });
  target.querySelector('#export-users').addEventListener('click', () => {
    const csv = ['Name,Login,Role,Access,Source,Created', ...filtered.map(user => [user.name, user.email, user.role, user.enabled === false ? 'Disabled' : 'Active', user.source, user.created_at].map(value => `"${String(value || '').replaceAll('"', '""')}"`).join(','))].join('\n');
    const link = Object.assign(document.createElement('a'), { href: URL.createObjectURL(new Blob([csv], { type: 'text/csv' })), download: `l1controlscope-users-${new Date().toISOString().slice(0, 10)}.csv` });
    link.click();
    URL.revokeObjectURL(link.href);
  });
  target.querySelectorAll('[data-user-manage]').forEach(button => button.addEventListener('click', () => showUserProfile(button.dataset.userManage)));
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
  };
  if (!content[activeTab]) activeTab = 'health';
  document.querySelector('#details').innerHTML = `<nav class="detail-tabs">${[['overview', 'Overview'], ['health', 'Health'], ['correlation', 'Correlate']].map(([key, label]) => `<button class="detail-tab ${activeTab === key ? 'active' : ''}" data-tab="${key}">${label}</button>`).join('')}</nav><div class="tab-content">${content[activeTab]}</div>`;
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
  const allForecasts = [...data.forecasts].sort((left, right) => Number(right.forecast_percent ?? right.current_percent ?? 0) - Number(left.forecast_percent ?? left.current_percent ?? 0));
  const forecastOverview = `<section class="forecast-overview"><header><span>ALL MONITORED PODS</span><small>${allForecasts.length} compared · highest projected use first</small></header><div>${allForecasts.map(item => { const value = Number(item.available ? item.forecast_percent : item.current_percent); const risk = item.available ? item.forecast_risk : item.risk; return `<button type="button" class="${item.pod === pod.name ? 'active' : ''}" data-forecast-pod="${escapeHtml(item.pod)}"><div><b>${escapeHtml(item.pod)}</b><small>${item.available ? '15-minute projection' : 'Current memory use'}</small></div><strong>${value}%</strong><span class="${severityClass(risk)}">${escapeHtml(risk)}</span></button>`; }).join('')}</div></section>`;
  document.querySelector('#forecast').innerHTML = `${forecastOverview}<section class="forecast-detail"><p class="selected-data-scope">Detailed view: <b>${escapeHtml(pod.name)}</b></p><div class="forecast ${forecast.available ? forecast.forecast_risk : forecast.risk}"><div><strong>${forecastHeadline}</strong><span>${forecastLabel}</span></div><p>${forecastDetail} · ${escapeHtml(forecast.message)}</p></div>${memoryTimeline(forecast)}</section>`;
  document.querySelectorAll('[data-forecast-pod]').forEach(button => button.addEventListener('click', () => selectPod(button.dataset.forecastPod)));
  document.querySelector('#analysis').innerHTML = `<p class="selected-data-scope">Selected pod: <b>${escapeHtml(pod.name)}</b></p><span class="${severityClass(analysis.severity)}">${analysis.severity}</span><ul>${analysis.findings.map(item => `<li>${escapeHtml(item)}</li>`).join('')}</ul><p class="muted">Errors ${analysis.counts.errors} · Warnings ${analysis.counts.warnings} · OOM ${analysis.counts.oom_events}</p><p class="muted">Use Centralised Log Explorer for searchable, masked JSON log records and context.</p>`;
  const deployment = (data.deployments || []).find(item => (item.resources || []).some(resource => resource.pod?.name === pod.name));
  const relatedUrls = urlMonitors.filter(item => {
    const text = `${item.name} ${item.url}`.toLowerCase();
    return String(deployment?.name || pod.name).toLowerCase().split(/[-_.]/).filter(term => term.length > 3).some(term => text.includes(term));
  });
  const capacityRisk = forecast.available ? forecast.forecast_risk : forecast.risk;
  const checks = [];
  if (analysis.counts.errors || analysis.counts.oom_events) checks.push({ action: 'logs', tone: analysis.counts.oom_events ? 'critical' : 'warning', title: 'Review error evidence', detail: `${analysis.counts.errors} error${analysis.counts.errors === 1 ? '' : 's'} and ${analysis.counts.oom_events} OOM event${analysis.counts.oom_events === 1 ? '' : 's'} in the latest sample. Open the masked log context for ${pod.name}.` });
  if (Number(pod.restarts || 0) > 0) checks.push({ action: 'workload', tone: 'warning', title: 'Check restart history', detail: `${pod.restarts} container restart${pod.restarts === 1 ? '' : 's'} recorded. Review the current runtime state and recent deployment change.` });
  if (capacityRisk === 'warning' || capacityRisk === 'critical') checks.push({ action: 'capacity', tone: capacityRisk, title: 'Review memory risk', detail: `${forecast.available ? 'Projected' : 'Current'} memory use is ${forecast.available ? forecast.forecast_percent : forecast.current_percent}%. Check the forecast before the pod reaches its limit.` });
  if (deployment && (analysis.severity === 'warning' || analysis.severity === 'critical')) checks.push({ action: 'deployment', tone: analysis.severity, title: 'Compare the deployed release', detail: `${deployment.name} is linked to this pod. Review its image, readiness, and the before/after release comparison.` });
  if (relatedUrls.some(item => ['degraded', 'down'].includes(item.status))) checks.push({ action: 'urls', tone: 'warning', title: 'Verify affected application URL', detail: `${relatedUrls.filter(item => ['degraded', 'down'].includes(item.status)).length} related endpoint${relatedUrls.length === 1 ? '' : 's'} needs attention. Confirm the user-facing impact.` });
  if (!checks.length) checks.push({ action: 'logs', tone: 'healthy', title: 'No urgent check is indicated', detail: 'Runtime, log, and capacity signals are currently stable. Review live logs only if you need confirmation while testing.' });
  const checksTarget = document.querySelector('#recommended-checks');
  checksTarget.innerHTML = `<p class="selected-data-scope">Selected pod: <b>${escapeHtml(pod.name)}</b></p><div>${checks.slice(0, 4).map((check, index) => `<button type="button" class="recommended-check ${escapeHtml(check.tone)}" data-recommended-check="${escapeHtml(check.action)}"><span class="check-number">${index + 1}</span><span><b>${escapeHtml(check.title)}</b><small>${escapeHtml(check.detail)}</small></span><i>Open →</i></button>`).join('')}</div>`;
  checksTarget.querySelectorAll('[data-recommended-check]').forEach(button => button.addEventListener('click', () => {
    const action = button.dataset.recommendedCheck;
    if (action === 'logs') { logExplorerPodName = pod.name; logExplorerSelectedIndex = undefined; window.history.replaceState(null, '', '#log-explorer-panel'); setWorkspacePage('logs'); renderLogExplorer(); }
    if (action === 'workload') { window.history.replaceState(null, '', '#container-monitoring'); setWorkspacePage('workloads'); }
    if (action === 'capacity') { window.history.replaceState(null, '', '#intelligence-center'); setWorkspacePage('intelligence'); document.querySelector('#forecast')?.scrollIntoView({ behavior: 'smooth', block: 'start' }); return; }
    if (action === 'deployment') { selectedDeploymentName = deployment.name; selectedDeploymentResource = pod.name; window.history.replaceState(null, '', '#deployment-inspector'); setWorkspacePage('workloads'); renderDeploymentInspector(data.deployments || []); }
    if (action === 'urls') { window.history.replaceState(null, '', '#url-monitoring'); setWorkspacePage('url-monitoring'); }
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }));
  renderDetails(pod, logs, records);
}

async function load(preservePausedLogs = false) {
  try {
    const [response, historyResponse, alertHistoryResponse, readinessResponse] = await Promise.all([fetch('/api/overview'), fetch(`/api/observability/history?minutes=${observabilityMinutes}`), fetch('/api/alert-history'), fetch('/ready'), loadNotificationSettings()]);
    const payload = await response.json();
    const historyPayload = historyResponse.ok ? await historyResponse.json() : observabilityData;
    const alertHistoryPayload = alertHistoryResponse.ok ? await alertHistoryResponse.json() : { events: [] };
    sourceHealth = await readinessResponse.json().catch(() => ({ status: 'checking', collector: {} }));
    if (!response.ok) throw new Error(payload.detail || 'Live telemetry is unavailable.');
    data = payload;
    renderOperatingContext(data);
    renderWelcomeBanner(data.summary);
    await restoreSharedInvestigation();
    acknowledgedAlerts = data.alert_acknowledgements || {};
    alertHistory = alertHistoryPayload.events || [];
    alertHistoryReport = alertHistoryPayload.report || alertHistoryReport;
    renderSummary(data.summary); renderPlatformHealth(data.summary, data.alerts); if (!document.querySelector('#assistant-form')) renderAssistant(); renderObservability(historyPayload); renderOverviewFocus(data, historyPayload); renderApplicationHealth(); renderManagementSummary(); renderWorkloads(data.inventory); renderDeploymentInspector(data.deployments || []); if (!preservePausedLogs || logExplorerLiveTail) renderLogExplorer(); renderAlerts(data.alerts); renderAlertHistory(alertHistory); renderIncidentEvidence(data.incident_evidence || []); renderAlertNotifications(); renderAlertRules(data.alert_rules || []); loadServiceHealth();
    document.querySelector('#mode').textContent = data.mode === 'docker' ? 'Local Docker' : data.mode === 'splunk' ? 'Splunk' : 'Kubernetes';
    document.querySelector('#connection').textContent = 'Live';
    document.querySelector('#connection').classList.remove('disconnected');
    const collectedAt = data.collector?.last_collected || data.generated_at;
    const ageSeconds = Math.max(0, Math.round((Date.now() - new Date(collectedAt).getTime()) / 1000));
    const freshness = ageSeconds < 15 ? `Updated ${ageSeconds}s ago` : `Updated ${Math.round(ageSeconds / 60)}m ago`;
    document.querySelector('#updated').textContent = `${freshness} · auto-refreshes every 30 seconds`;
    document.querySelector('#header-updated').textContent = freshness;
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
    document.querySelector('#slo-signals').textContent = 'No live service signals are available.';
    document.querySelector('#capacity-ranking').textContent = 'No capacity data is available.';
    document.querySelector('#service-map').textContent = 'No live service map is available.';
    document.querySelector('#dependencies').textContent = 'No dependency data is available.';
    document.querySelector('#event-timeline').textContent = 'No event history is available.';
    document.querySelector('#deployment-inspector-content').textContent = 'No deployment resource data is available.';
  }
}

function startPulseOps() {
ensureDeveloperInvestigationPage();
const navigationHelp = { '#overview': 'Live health, trends, capacity, dependencies, and recent changes', '#deployment-readiness': 'Deployments, services, pods, images, and readiness', '#log-explorer-panel': 'Search and inspect retained pod logs', '#alert-center': 'Active alerts, history, evidence, and rules', '#developer-investigation': 'Correlated developer investigation workspace', '#intelligence-center': 'Evidence-led automated investigation and optional AI', '#url-monitoring': 'Environment URL availability monitoring', '#data-sources': 'Administrator monitoring-source configuration', '#access': 'Administrator users, roles, and audit history' };
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
  button.textContent = compact ? 'Use comfortable layout' : 'Use compact layout';
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
document.querySelector('#administration-nav').hidden = !isAdministrator();
if (!isAdministrator()) document.querySelector('#export-json').hidden = true;
if (!isDeveloperOrAdministrator()) {
  document.querySelector('a[href="#log-explorer-panel"]').hidden = true;
  document.querySelector('a[href="#observability-center"]')?.setAttribute('hidden', '');
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
  if (alert?.pod && data?.pods?.some(pod => pod.name === alert.pod)) { openDeveloperInvestigation(alert.pod); return; }
  button.textContent = 'No active alerts';
  setTimeout(() => { button.textContent = 'Investigate highest-priority alert'; }, 1800);
});
document.body.dataset.audience = 'operator';

function setWorkspacePage(page) {
  document.body.dataset.page = page;
  // Service Map and Dependency Health live inside Command Center only.
  // This explicit guard keeps them out of every focused workspace page.
  const commandCenter = document.querySelector('#observability-center');
  if (commandCenter) commandCenter.hidden = page !== 'overview';
  document.querySelectorAll('[data-workspace-tab], .workspace-nav a').forEach(tab => {
    const targetId = (tab.getAttribute('href') || '#overview').slice(1);
    const selected = pageFromTarget(targetId) === page && !(page === 'overview' && targetId !== 'overview');
    tab.classList.toggle('active', selected);
    if (selected) tab.setAttribute('aria-current', 'page'); else tab.removeAttribute('aria-current');
  });
}

function syncWorkspacePage() {
  const targetId = (window.location.hash || '#overview').slice(1);
  const page = pageFromTarget(targetId);
  // A shared investigation link needs its identifier only while the
  // investigation workspace is open. Keep every other application URL clean.
  if (page !== 'investigation') {
    const url = new URL(window.location.href);
    if (url.searchParams.has('investigation')) {
      url.searchParams.delete('investigation');
      window.history.replaceState(null, '', url);
    }
  }
  setWorkspacePage(page);
}

document.querySelectorAll('[data-workspace-tab], .workspace-nav a').forEach(tab => tab.addEventListener('click', event => {
  event.preventDefault();
  const hash = tab.getAttribute('href') || '#overview';
  const url = new URL(window.location.href);
  url.searchParams.delete('investigation');
  url.hash = hash;
  window.history.pushState(null, '', url);
  setWorkspacePage(pageFromTarget(hash.slice(1)));
  window.scrollTo({ top: 0, behavior: 'smooth' });
}));
window.addEventListener('hashchange', syncWorkspacePage);
window.addEventListener('popstate', syncWorkspacePage);
syncWorkspacePage();
Promise.all([loadSplunkSettings(), loadPrometheusSettings()]).then(renderDataSources);
loadUrlMonitors();
loadCorrelationIntelligence();
// Keep the navigation sequence operational: workloads, pods, then centralised logs.
const dashboardLayout = document.querySelector('.layout');
dashboardLayout.insertBefore(document.querySelector('#log-explorer-panel'), document.querySelector('#container-monitoring').nextElementSibling);
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
  renderWelcomeBanner();
  loginScreen.classList.add('hidden');
  renderCurrentUser(result.user);
  startPulseOps();
}

function setAdministratorLoginMode(enabled) {
  administratorLoginMode = enabled;
  const identity = document.querySelector('#login-email');
  const message = document.querySelector('#login-message');
  document.querySelector('#login-identity-label').innerHTML = enabled ? `Administrator username <input id="login-email" type="text" required value="${escapeHtml(breakGlassUsername)}" readonly>` : 'Work email <input id="login-email" type="text" required placeholder="name@db.com">';
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
  renderWelcomeBanner();
  document.querySelector('#login-screen').classList.add('hidden');
  renderCurrentUser(result.user);
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
