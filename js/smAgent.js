/**
 * SM Agent — Scrum Master automation (JSRunner)
 *
 * Rule engine for Jira ticket movement.
 * Track run stats and generate Markdown summary.
 */

// ─── Global State ────────────────────────────────────────────────────────────
var runSummary = [];

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
        agentConfig = JSON.parse(file_read({ path: rule.configFile }));
    } catch (e) {
        console.error('  ❌ Config error: ' + rule.configFile);
        return { processed: 0, skipped: 0 };
    }

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
            var fullTicket = JSON.parse(jira_get_ticket(key));
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

        if (rule.targetStatus) moveStatus(key, rule.targetStatus);
        var targetRepo = getTargetRepo(ticket, rule.targetRepo || 'root');
        var triggered = triggerWorkflow(targetRepo, key, rule);

        if (triggered) {
            if (rule.addLabel) try { jira_add_label({ key: key, label: rule.addLabel }); } catch (e) {}
            runSummary.push({ rule: ruleLabel, ticket: key, action: '🚀 Dispatched', status: ticket.fields.status.name, updated: stale });
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
    console.log('SM Agent — ' + repoInfo.owner + '/' + repoInfo.repo);

    rules.forEach(function(rule, i) { processRule(rule, repoInfo, i); });

    var md = '# SM Agent Run Summary\n\n';
    if (runSummary.length === 0) {
        md += 'No tickets found in this run.\n';
    } else {
        md += '| Rule | Ticket | Action | Status | Updated |\n';
        md += '| :--- | :--- | :--- | :--- | :--- |\n';
        runSummary.forEach(function(r) {
            var ticketLink = '[' + r.ticket + '](https://majesens.atlassian.net/browse/' + r.ticket + ')';
            md += '| ' + r.rule + ' | ' + ticketLink + ' | ' + r.action + ' | ' + r.status + ' | ' + r.updated + ' |\n';
        });
    }
    
    try {
        file_write({ path: 'agents/outputs/sm_summary.md', content: md });
        console.log('\nSummary written to agents/outputs/sm_summary.md');
    } catch (e) {
        console.warn('Failed summary file:', e);
    }

    console.log('\n══ SM Agent complete ══');
    return { success: true, processed: runSummary.length };
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { action: action };
}
