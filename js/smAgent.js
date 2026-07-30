/**
 * SM Agent — Scrum Master automation (JSRunner)
 *
 * Rule engine for Jira ticket movement.
 * Track run stats and generate Markdown summary.
 */

// ─── Global State ────────────────────────────────────────────────────────────
var runSummary = [];

// Cross-repo guard labels (must match LABELS in config.js — smAgent.js runs in
// the GraalVM JSRunner global scope where require() is unavailable)
var GUARD_LABELS = {
    HAS_API_DEPENDENCY: 'has_api_dependency',
    NEEDS_BACKEND: 'needs_backend',
    BACKEND_SPLIT_CREATED: 'backend_split_created',
    NEEDS_FRONTEND: 'needs_frontend',
    FRONTEND_SPLIT_CREATED: 'frontend_split_created'
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

function getStalenessInfo(ticket) {
    var updatedStr = ticket.fields.updated;
    if (!updatedStr) return '';
    var updatedDate = new Date(updatedStr);
    var now = new Date();
    var diffMs = now.getTime() - updatedDate.getTime();
    var diffHours = diffMs / (1000 * 60 * 60);
    var label = diffHours.toFixed(1) + 'h';
    if (diffHours >= 12) return '⚠️ **STALE (' + label + ')**';
    return label;
}

function getTargetRepo(ticket, defaultTarget) {
    var labels = (ticket.fields && ticket.fields.labels) ? ticket.fields.labels : [];
    var target = defaultTarget || 'root';

    if (labels.indexOf('frontend') !== -1 || labels.indexOf('ui') !== -1 || labels.indexOf('react') !== -1) {
        target = 'frontend';
    } else if (labels.indexOf('backend') !== -1 || labels.indexOf('api') !== -1 || labels.indexOf('go') !== -1) {
        target = 'backend';
    }

    if (target === 'root') {
        var issueType = (ticket.fields && ticket.fields.issuetype && ticket.fields.issuetype.name) || '';
        if (issueType === 'Test Case') {
            if (ticket.fields && ticket.fields.issuelinks) {
                for (var i = 0; i < ticket.fields.issuelinks.length; i++) {
                    var link = ticket.fields.issuelinks[i];
                    var linkedIssue = link.outwardIssue || link.inwardIssue;
                    if (linkedIssue && linkedIssue.key) {
                        var linkedType = (linkedIssue.fields && linkedIssue.fields.issuetype && linkedIssue.fields.issuetype.name) || '';
                        if (linkedType === 'Story' || linkedType === 'Bug') {
                            try {
                                var parentTicket = jira_get_ticket(linkedIssue.key);
                                if (typeof parentTicket === 'string') parentTicket = JSON.parse(parentTicket);
                                var parentLabels = (parentTicket.fields && parentTicket.fields.labels) || [];
                                if (parentLabels.indexOf('frontend') !== -1 || parentLabels.indexOf('ui') !== -1 || parentLabels.indexOf('react') !== -1) {
                                    target = 'frontend'; break;
                                } else if (parentLabels.indexOf('backend') !== -1 || parentLabels.indexOf('api') !== -1 || parentLabels.indexOf('go') !== -1) {
                                    target = 'backend'; break;
                                }
                            } catch (e) { console.warn('  ⚠️ parent error ' + linkedIssue.key); }
                        }
                    }
                }
            }
        }
    }

    if (target === 'frontend') return { owner: 'holodog', repo: 'ms_front', ref: 'main' };
    if (target === 'backend')  return { owner: 'holodog', repo: 'ms_back',  ref: 'main' };
    return { owner: 'holodog', repo: 'ms_root', ref: 'master' };
}

function buildEncodedConfig(ticketKey, initiatorId, baseBranch) {
    var p = { inputJql: 'key = ' + ticketKey };
    if (initiatorId) p.initiator = initiatorId;
    if (baseBranch) p.base_branch = baseBranch;
    else if (typeof DEFAULT_BASE_BRANCH !== 'undefined') p.base_branch = DEFAULT_BASE_BRANCH;
    return encodeURIComponent(JSON.stringify({ params: p }));
}

function triggerWorkflow(repoInfo, ticketKey, rule) {
    var workflowFile = rule.workflowFile || 'ai-teammate.yml';
    var workflowRef = rule.workflowRef || repoInfo.ref || 'main';
    var initiatorId = null;
    try { initiatorId = JIRA_INITIATOR_ACCOUNT_ID || null; } catch (e) {}

    try {
        github_trigger_workflow(
            repoInfo.owner,
            repoInfo.repo,
            workflowFile,
            JSON.stringify({
                concurrency_key: ticketKey,
                config_file:     rule.configFile,
                encoded_config:  buildEncodedConfig(ticketKey, initiatorId)
            }),
            workflowRef
        );
        console.log('  ✅ Triggered ' + workflowFile + '@' + workflowRef + ' for ' + ticketKey);
        return true;
    } catch (e) {
        console.warn('  ⚠️ Workflow fail ' + ticketKey + ': ' + (e.message || e));
        return false;
    }
}

function moveStatus(ticketKey, targetStatus) {
    try {
        jira_move_to_status({ key: ticketKey, statusName: targetStatus });
        console.log('  ✅ ' + ticketKey + ' → ' + targetStatus);
    } catch (e) {
        console.warn('  ⚠️ Move fail ' + ticketKey + ': ' + (e.message || e));
    }
}

function hasLabel(ticket, label) {
    if (!label) return false;
    var labels = (ticket.fields && ticket.fields.labels) ? ticket.fields.labels : [];
    return labels.indexOf(label) !== -1;
}

// ─── Cross-Repo Guard ────────────────────────────────────────────────────────
// Detects frontend-scoped tickets that need backend API work and splits them:
// auto-creates a linked backend Story, blocks the frontend ticket, and lets
// the SM dispatch the backend part first. Opt-in per rule via rule.crossRepoGuard
// (only sm_ms.json sets it — sm.json/mytube is unaffected).
// Returns true  → dispatch must be skipped (ticket blocked/waiting/just split).
// Returns false → dispatch proceeds normally.

// Probe once per run: does this project's workflow even have a "Blocked"
// status? (MAJESENS doesn't.) dmtools' jira_move_to_status silently no-ops
// on a missing status, so verify via JQL probe instead of trusting the move.
var blockedStatusExists = null;
function hasBlockedStatus(projectKey) {
    if (blockedStatusExists !== null) return blockedStatusExists;
    try {
        jira_search_by_jql({ jql: 'project = ' + projectKey + ' AND status = "Blocked"', maxResults: 1 });
        blockedStatusExists = true;
    } catch (e) {
        // JQL parse error → status value doesn't exist in this project
        blockedStatusExists = false;
    }
    return blockedStatusExists;
}

function findBackendBlockers(ticketKey, statusClause) {
    try {
        return jira_search_by_jql({
            jql: 'issue in linkedIssues("' + ticketKey + '") AND issuetype = Story' +
                 ' AND labels in ("backend","api","go") AND ' + statusClause,
            maxResults: 1
        }) || [];
    } catch (e) {
        console.warn('  ⚠️ linkedIssues JQL fail for ' + ticketKey + ': ' + (e.message || e));
        return [];
    }
}

function createBackendSplitTicket(ticket, key) {
    var fullTicket = null;
    try {
        var raw = jira_get_ticket(key);
        fullTicket = (typeof raw === 'string') ? JSON.parse(raw) : raw;
    } catch (e) {
        console.warn('  ⚠️ Full ticket fetch fail ' + key + ': ' + (e.message || e));
    }

    var fields = (fullTicket && fullTicket.fields) || {};
    var summary = fields.summary || key;
    var projectKey = key.split('-')[0];

    var backendFields = {
        summary: '[Backend API] ' + summary,
        description: 'h3. Backend API Implementation\n\n' +
            'Auto-created by SM cross-repo guard for frontend ticket ' +
            '[' + key + '|https://majesens.atlassian.net/browse/' + key + '].\n\n' +
            'Implement the backend changes described in the *API Changes* section of the\n' +
            'Solution field on ' + key + ' (fetch the linked ticket for the full contract).\n\n' +
            'After this ticket is merged, ' + key + ' is unblocked and dispatched to ms_front automatically.',
        issuetype: { name: 'Story' },
        labels: ['backend', 'api', 'ai_generated']
    };
    if (fields.parent && fields.parent.key) {
        backendFields.parent = { key: fields.parent.key };
    }

    var result = jira_create_ticket_with_json({ project: projectKey, fieldsJson: backendFields });
    var parsed = (typeof result === 'string') ? JSON.parse(result) : result;
    return parsed ? parsed.key : null;
}

function findLinkedFrontend(ticketKey) {
    try {
        return jira_search_by_jql({
            jql: 'issue in linkedIssues("' + ticketKey + '") AND issuetype = Story' +
                 ' AND labels in ("frontend","ui","react")',
            maxResults: 1
        }) || [];
    } catch (e) {
        console.warn('  ⚠️ linkedIssues(frontend) JQL fail for ' + ticketKey + ': ' + (e.message || e));
        return [];
    }
}

function createFrontendSplitTicket(key) {
    var fullTicket = null;
    try {
        var raw = jira_get_ticket(key);
        fullTicket = (typeof raw === 'string') ? JSON.parse(raw) : raw;
    } catch (e) {
        console.warn('  ⚠️ Full ticket fetch fail ' + key + ': ' + (e.message || e));
    }

    var fields = (fullTicket && fullTicket.fields) || {};
    var summary = fields.summary || key;
    var projectKey = key.split('-')[0];

    var frontendFields = {
        summary: '[Frontend] ' + summary,
        description: 'h3. Frontend Implementation\n\n' +
            'Auto-created by SM cross-repo guard (mirror) for backend ticket ' +
            '[' + key + '|https://majesens.atlassian.net/browse/' + key + '].\n\n' +
            'Implement the frontend changes consuming the API/logic from ' + key + '.\n' +
            'The API contract is in the Solution field and the API-sync comment on ' + key + '.\n\n' +
            'This ticket is dispatched to ms_front after ' + key + ' is merged.',
        issuetype: { name: 'Story' },
        // has_api_dependency is deliberate: the main guard's active/merged
        // blocker checks then hold this ticket until the backend ticket merges
        labels: ['frontend', 'has_api_dependency', 'ai_generated']
    };
    if (fields.parent && fields.parent.key) {
        frontendFields.parent = { key: fields.parent.key };
    }

    var result = jira_create_ticket_with_json({ project: projectKey, fieldsJson: frontendFields });
    var parsed = (typeof result === 'string') ? JSON.parse(result) : result;
    return parsed ? parsed.key : null;
}

function crossRepoGuard(ticket, rule) {
    if (!rule.crossRepoGuard) return false;

    var key = ticket.key;
    var labels = (ticket.fields && ticket.fields.labels) ? ticket.fields.labels : [];

    // 1. Scope detection (same label sets as getTargetRepo)
    var isFrontend = labels.indexOf('frontend') !== -1 ||
                     labels.indexOf('ui') !== -1 ||
                     labels.indexOf('react') !== -1;

    // Non-frontend tickets delegate to the mirror guard (backend → frontend
    // split). Every path of the frontend branch below returns, so the mirror
    // never double-fires on frontend-scoped tickets.
    if (!isFrontend) return mirrorGuard(key, labels);

    // 2. Dependency marker required (SA-set for stories, human-set for bugs)
    var hasMarker = labels.indexOf(GUARD_LABELS.HAS_API_DEPENDENCY) !== -1 ||
                    labels.indexOf(GUARD_LABELS.NEEDS_BACKEND) !== -1;
    if (!hasMarker) return false;

    // 3. Active backend blocker → stay blocked, skip dispatch.
    // "Satisfied" = PR landed: Merged and every post-merge lifecycle status
    // (SM moves tickets Merged → Ready For Testing → In Testing → Done within
    // cycles, so matching only Merged/Done would re-block tickets forever).
    if (findBackendBlockers(key, 'status NOT IN ("Merged","Ready For Testing","In Testing","Done")').length > 0) {
        console.log('  ⏳ ' + key + ' waiting on active backend blocker');
        return true;
    }

    // 4. Backend blocker landed → dependency satisfied, dispatch normally
    if (findBackendBlockers(key, 'status IN ("Merged","Ready For Testing","In Testing","Done")').length > 0) {
        return false;
    }

    // 5. Already split in a previous cycle → skip dispatch (unblock rule owns it)
    if (labels.indexOf(GUARD_LABELS.BACKEND_SPLIT_CREATED) !== -1) return true;

    // 6. No backend ticket exists — create the split
    console.log('  🔀 CROSS-REPO SPLIT: ' + key + ' needs a backend ticket');
    var backendKey = null;
    try {
        backendKey = createBackendSplitTicket(ticket, key);
    } catch (e) {
        console.error('  ❌ Backend ticket creation fail ' + key + ': ' + (e.message || e));
    }
    if (!backendKey) {
        console.error('  ❌ No backend key — skipping dispatch, will retry next cycle');
        return true; // never fall through to an ms_front dispatch without the API
    }
    console.log('  ✅ Created ' + backendKey + ' for ' + key);

    try {
        // Mirror createIntakeTickets.js: sourceKey = blocked ticket, relationship 'Blocks'
        jira_link_issues({ sourceKey: key, anotherKey: backendKey, relationship: 'Blocks' });
    } catch (e) {
        console.warn('  ⚠️ Link fail ' + backendKey + ' blocks ' + key + ': ' + (e.message || e));
    }

    // Optional visibility: move to Blocked when the workflow has that status.
    // Correctness does not depend on it — the active-blocker check holds the
    // ticket in future cycles regardless of its status.
    if (hasBlockedStatus(key.split('-')[0])) {
        try {
            jira_move_to_status({ key: key, statusName: 'Blocked' });
            console.log('  ✅ ' + key + ' → Blocked');
        } catch (e) {
            console.warn('  ⚠️ Block move fail ' + key + ': ' + (e.message || e));
        }
    } else {
        console.log('  ℹ️ No "Blocked" status in workflow — ' + key + ' keeps current status, hold enforced by blocker check');
    }

    try {
        jira_move_to_status({ key: backendKey, statusName: 'Ready For Development' });
        console.log('  ✅ ' + backendKey + ' → Ready For Development');
    } catch (e) {
        console.warn('  ⚠️ RFD move fail ' + backendKey + ': ' + (e.message || e));
    }

    try {
        jira_add_label({ key: key, label: GUARD_LABELS.BACKEND_SPLIT_CREATED });
    } catch (e) {}

    try {
        jira_post_comment({
            key: key,
            comment: 'h3. Cross-Repo API Split\n\n' +
                'This frontend ticket requires backend API changes. Created ' +
                '[' + backendKey + '|https://majesens.atlassian.net/browse/' + backendKey + '].\n\n' +
                'This ticket stays *Blocked* until the backend implementation is merged, ' +
                'then it is re-dispatched to ms_front automatically.'
        });
    } catch (e) {}

    return true;
}

/**
 * Mirror cross-repo guard — backend-scoped ticket needing frontend follow-up.
 * Creates the paired frontend Story but NEVER holds the backend dispatch:
 * the created Story carries frontend + has_api_dependency labels, so the main
 * guard's blocker checks hold it and release it after the backend merge.
 * Always returns false (backend dispatch proceeds).
 */
function mirrorGuard(key, labels) {
    // Backend-scoped only (same label set as getTargetRepo)
    if (labels.indexOf('backend') === -1 &&
        labels.indexOf('api') === -1 &&
        labels.indexOf('go') === -1) {
        return false;
    }

    // Marker required (SA-set for stories, human-set for bugs)
    if (labels.indexOf(GUARD_LABELS.NEEDS_FRONTEND) === -1) return false;

    // Already split in a previous cycle
    if (labels.indexOf(GUARD_LABELS.FRONTEND_SPLIT_CREATED) !== -1) return false;

    // A frontend Story is already linked (human- or automation-created)
    if (findLinkedFrontend(key).length > 0) return false;

    console.log('  🔀 CROSS-REPO SPLIT (mirror): ' + key + ' needs a frontend ticket');
    var frontendKey = null;
    try {
        frontendKey = createFrontendSplitTicket(key);
    } catch (e) {
        console.error('  ❌ Frontend ticket creation fail ' + key + ': ' + (e.message || e));
    }
    if (!frontendKey) {
        // Backend work is independent — dispatch proceeds, split retries next
        // cycle (idempotency label is only set after a successful create)
        console.warn('  ⚠️ No frontend key — backend dispatch proceeds, split retried next cycle');
        return false;
    }
    console.log('  ✅ Created ' + frontendKey + ' for ' + key);

    try {
        // sourceKey = the blocked (frontend) ticket, per createIntakeTickets.js
        jira_link_issues({ sourceKey: frontendKey, anotherKey: key, relationship: 'Blocks' });
    } catch (e) {
        console.warn('  ⚠️ Link fail ' + key + ' blocks ' + frontendKey + ': ' + (e.message || e));
    }

    try {
        jira_move_to_status({ key: frontendKey, statusName: 'Ready For Development' });
        console.log('  ✅ ' + frontendKey + ' → Ready For Development');
    } catch (e) {
        console.warn('  ⚠️ RFD move fail ' + frontendKey + ': ' + (e.message || e));
    }

    try {
        jira_add_label({ key: key, label: GUARD_LABELS.FRONTEND_SPLIT_CREATED });
    } catch (e) {}

    try {
        jira_post_comment({
            key: key,
            comment: 'h3. Cross-Repo Frontend Split\n\n' +
                'This backend ticket requires frontend follow-up. Created ' +
                '[' + frontendKey + '|https://majesens.atlassian.net/browse/' + frontendKey + '].\n\n' +
                'It is held until this backend implementation is merged, ' +
                'then dispatched to ms_front automatically.'
        });
    } catch (e) {}

    return false;
}

// ─── Local execution ──────────────────────────────────────────────────────────

function runLocalAction(jsPath, ticket, agentParams) {
    var actionCode = file_read({ path: jsPath });
    if (!actionCode || !actionCode.trim()) throw new Error('No JS: ' + jsPath);
    var configCode = file_read({ path: 'agents/js/config.js' });

    var script =
        '(function() {\n' +
        '  var _cm = { exports: {} };\n' +
        '  (function(module, exports) {\n' + configCode + '\n  })(_cm, _cm.exports);\n' +
        '  var _am = { exports: {} };\n' +
        '  (function(module, exports, require) {\n' + actionCode + '\n  })(\n' +
        '    _am, _am.exports,\n' +
        '    function(id) { return _cm.exports; }\n' +
        '  );\n' +
        '  return _am.exports;\n' +
        '})()';

    var exported = eval(script);
    if (!exported || typeof exported.action !== 'function') throw new Error('No action() in: ' + jsPath);
    return exported.action({ ticket: ticket, jobParams: agentParams });
}

function processRuleLocally(rule, ruleIndex) {
    var ruleLabel = rule.description || ('Rule #' + (ruleIndex + 1));
    console.log('\n══ [LOCAL] ' + ruleLabel + ' ══');

    if (rule.enabled === false) {
        console.log('  ⏸️  Disabled');
        return { processed: 0, skipped: 0 };
    }

    var agentConfig;
    try {
        var rawConfig = file_read({ path: rule.configFile });
        if (!rawConfig) { console.error('  ❌ Config missing: ' + rule.configFile); return { processed: 0, skipped: 0 }; }
        agentConfig = JSON.parse(rawConfig);
    } catch (e) {
        console.error('  ❌ Config error: ' + rule.configFile + ' — ' + e.message);
        return { processed: 0, skipped: 0 };
    }

    if (!agentConfig) { console.error('  ❌ Config parsed as null: ' + rule.configFile); return { processed: 0, skipped: 0 }; }

    var agentParams = agentConfig.params || {};
    try { if (JIRA_INITIATOR_ACCOUNT_ID) agentParams.initiator = JIRA_INITIATOR_ACCOUNT_ID; } catch (e) {}

    var postJSActionPath = agentParams.postJSAction;
    if (!postJSActionPath) {
        console.warn('  ⚠️ No postJS in ' + rule.configFile);
        return { processed: 0, skipped: 0 };
    }

    var tickets = [];
    try {
        tickets = jira_search_by_jql({ jql: rule.jql, fields: ['key', 'labels', 'issuetype', 'issuelinks', 'status', 'updated'] }) || [];
    } catch (e) {
        console.error('  ❌ JQL fail: ' + e.message);
        return { processed: 0, skipped: 0 };
    }

    if (typeof rule.limit === 'number' && tickets.length > rule.limit) tickets = tickets.slice(0, rule.limit);
    if (tickets.length === 0) return { processed: 0, skipped: 0 };

    console.log('  Found ' + tickets.length + ' ticket(s)');

    var pCount = 0;
    var sCount = 0;

    tickets.forEach(function(ticket) {
        var key = ticket.key;
        var stale = getStalenessInfo(ticket);

        if (rule.skipIfLabel && hasLabel(ticket, rule.skipIfLabel)) {
            console.log('  ⏭️  ' + key + ' skipped');
            runSummary.push({ rule: ruleLabel, ticket: key, action: '⏭️ Skipped', status: ticket.fields.status.name, updated: stale });
            sCount++;
            return;
        }

        if (rule.targetStatus) moveStatus(key, rule.targetStatus);

        try {
            var rawTicket = jira_get_ticket(key); var fullTicket = (typeof rawTicket === "string") ? JSON.parse(rawTicket) : rawTicket;
            console.log('  ▶️  ' + key + ' → ' + postJSActionPath);
            var result = runLocalAction(postJSActionPath, fullTicket, agentParams);
            var actStr = '✅ Done (' + (result && result.action || 'ok') + ')';
            console.log('  ' + actStr);
            runSummary.push({ rule: ruleLabel, ticket: key, action: actStr, status: fullTicket.fields.status.name, updated: stale });
            pCount++;
            if (rule.addLabel) try { jira_add_label({ key: key, label: rule.addLabel }); } catch (e) {}
        } catch (e) {
            console.error('  ❌ Fail ' + key + ': ' + e.message);
            runSummary.push({ rule: ruleLabel, ticket: key, action: '❌ Error', status: 'Error', updated: stale });
        }
    });

    return { processed: pCount, skipped: sCount };
}

// ─── Rule processor ───────────────────────────────────────────────────────────

function processRule(rule, repoInfo, ruleIndex) {
    if (rule.localExecution) return processRuleLocally(rule, ruleIndex);

    var ruleLabel = rule.description || ('Rule #' + (ruleIndex + 1));
    console.log('\n══ ' + ruleLabel + ' ══');

    if (rule.enabled === false) {
        console.log('  ⏸️  Disabled');
        return { processed: 0, skipped: 0 };
    }

    var tickets = [];
    try {
        tickets = jira_search_by_jql({ jql: rule.jql, fields: ['key', 'labels', 'issuetype', 'issuelinks', 'status', 'updated'] }) || [];
    } catch (e) {
        console.error('  ❌ JQL fail: ' + e.message);
        return { processed: 0, skipped: 0 };
    }

    if (typeof rule.limit === 'number' && tickets.length > rule.limit) tickets = tickets.slice(0, rule.limit);
    if (tickets.length === 0) return { processed: 0, skipped: 0 };

    console.log('  Found ' + tickets.length + ' ticket(s)');

    var pCount = 0;
    var sCount = 0;

    tickets.forEach(function(ticket) {
        var key = ticket.key;
        var stale = getStalenessInfo(ticket);

        if (rule.skipIfLabel && hasLabel(ticket, rule.skipIfLabel)) {
            console.log('  ⏭️  ' + key + ' skipped');
            runSummary.push({ rule: ruleLabel, ticket: key, action: '⏭️ Skipped', status: ticket.fields.status.name, updated: stale });
            sCount++;
            return;
        }

        if (rule.crossRepoGuard && crossRepoGuard(ticket, rule)) {
            runSummary.push({
                rule: ruleLabel,
                ticket: key,
                action: '🔀 Cross-repo guard — backend split created/waiting, dispatch skipped',
                status: ticket.fields.status.name,
                updated: stale
            });
            sCount++;
            return;
        }

        if (rule.targetStatus) moveStatus(key, rule.targetStatus);
        var targetRepo = getTargetRepo(ticket, rule.targetRepo || 'root');
        var triggered = triggerWorkflow(targetRepo, key, rule);

        if (triggered) {
            if (rule.addLabel) try { jira_add_label({ key: key, label: rule.addLabel }); } catch (e) {}
            var runLink = 'https://github.com/' + targetRepo.owner + '/' + targetRepo.repo + '/actions?query=' + key;
            var actionStr = '[🚀 Dispatched](' + runLink + ')';
            runSummary.push({ rule: ruleLabel, ticket: key, action: actionStr, status: ticket.fields.status.name, updated: stale });
            pCount++;
        }
    });

    return { processed: pCount, skipped: sCount };
}

// ─── Main ─────────────────────────────────────────────────────────────────────

function action(params) {
    var p = params.jobParams || params;
    var rules = p.rules;
    if (!rules || rules.length === 0) return { success: false, error: 'No rules' };

    var repoInfo = { owner: p.owner, repo: p.repo };
    var ciRunUrl = p.ciRunUrl || null;
    
    console.log('SM Agent — ' + repoInfo.owner + '/' + repoInfo.repo);

    rules.forEach(function(rule, i) { processRule(rule, repoInfo, i); });

    var md = '# SM Agent Run Summary\n\n';
    if (ciRunUrl) {
        md += '[View GitHub Action Run](' + ciRunUrl + ')\n\n';
    }
    
    if (runSummary.length === 0) {
        md += 'No tickets found in this run.\n';
    } else {
        md += '| Rule | Ticket | Action | Status | Updated |\n';
        md += '| :--- | :--- | :--- | :--- | :--- |\n';
        runSummary.forEach(function(r) {
            var ticketLink = '[' + r.ticket + '](https://majesens.atlassian.net/browse/' + r.ticket + ')';
            
            // If action is local and we have ciRunUrl, link it
            var actionStr = r.action;
            if (ciRunUrl && actionStr.indexOf('✅ Done') === 0) {
                actionStr = '[' + actionStr + '](' + ciRunUrl + ')';
            }
            
            md += '| ' + r.rule + ' | ' + ticketLink + ' | ' + actionStr + ' | ' + r.status + ' | ' + r.updated + ' |\n';
        });
    }
    
    try {
        file_write({ path: 'agents/outputs/sm_summary.md', content: md });
        console.log('\nSummary written to agents/outputs/sm_summary.md (' + md.length + ' bytes)');
    } catch (e) {
        console.warn('  ⚠️ Failed summary file: ' + e.message);
        try {
            file_write({ path: '/workspace/agents/outputs/sm_summary.md', content: md });
            console.log('\nSummary written to /workspace/agents/outputs/sm_summary.md');
        } catch (e2) {
            console.warn('  ⚠️ Fallback write also failed: ' + e2.message);
        }
    }

    console.log('\n══ SM Agent complete ══');
    return { success: true, processed: runSummary.length };
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { action: action };
}
