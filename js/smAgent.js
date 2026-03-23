/**
 * SM Agent — Scrum Master automation (JSRunner)
 *
 * Reads an array of rules from params.rules (defined in agents/sm.json)
 * and for each rule:
 *   1. Queries Jira by rule.jql
 *   2. Optionally transitions each ticket to rule.targetStatus
 *   3. Triggers an ai-teammate GitHub Actions workflow for each ticket
 *      OR executes the postJSAction locally (if localExecution: true)
 *
 * Rule fields:
 *   jql            (required) — JQL to find tickets
 *   configFile     (required) — agents/*.json to pass as config_file workflow input
 *   description    (optional) — human-readable label shown in logs
 *   targetStatus   (optional) — Jira status to transition tickets to before triggering
 *   workflowFile   (optional) — GitHub Actions workflow file  (default: ai-teammate.yml)
 *   workflowRef    (optional) — git ref for dispatch           (default: main)
 *   skipIfLabel    (optional) — skip ticket if it already has this label (idempotency)
 *   addLabel       (optional) — add this label after triggering (idempotency marker)
 *   enabled        (optional) — set to false to disable the rule entirely (default: true)
 *   limit          (optional) — max number of tickets to process per run (default: 50)
 *   localExecution (optional) — if true, run postJSAction directly (no runner, no AI/CLI)
 */

// ─── Helpers ─────────────────────────────────────────────────────────────────

function buildEncodedConfig(ticketKey, initiatorId) {
    var p = {
        inputJql: 'key = ' + ticketKey
    };
    if (initiatorId) {
        p.initiator = initiatorId;
    }
    return encodeURIComponent(JSON.stringify({ params: p }));
}

function triggerWorkflow(repoInfo, ticketKey, rule) {
    var workflowFile = rule.workflowFile || 'ai-teammate.yml';
    var workflowRef  = rule.workflowRef  || 'main';

    // Get initiator from environment variable (set in GitHub Actions)
    var initiatorId = null;
    try {
        initiatorId = JIRA_INITIATOR_ACCOUNT_ID || null;
    } catch (e) {}

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
        console.warn('  ⚠️  Workflow trigger failed for ' + ticketKey + ': ' + (e.message || e));
        return false;
    }
}

function moveStatus(ticketKey, targetStatus) {
    try {
        jira_move_to_status({ key: ticketKey, statusName: targetStatus });
        console.log('  ✅ ' + ticketKey + ' → ' + targetStatus);
    } catch (e) {
        console.warn('  ⚠️  Status transition failed for ' + ticketKey + ': ' + (e.message || e));
    }
}

function hasLabel(ticket, label) {
    if (!label) return false;
    var labels = (ticket.fields && ticket.fields.labels) ? ticket.fields.labels : [];
    return labels.indexOf(label) !== -1;
}

// ─── Local execution ──────────────────────────────────────────────────────────

/**
 * Loads a postJSAction JS file and executes its action() function in-process.
 * Uses a module wrapper so that require('./config.js') works inside the loaded file.
 *
 * @param {string} jsPath  - path to the JS file (e.g. "agents/js/checkBugTestsPassed.js")
 * @param {Object} ticket  - full Jira ticket object (from jira_get_ticket)
 * @param {Object} agentParams - params block from the agent config JSON
 * @returns result of action()
 */
function runLocalAction(jsPath, ticket, agentParams) {
    var actionCode = file_read({ path: jsPath });
    if (!actionCode || !actionCode.trim()) throw new Error('Cannot read: ' + jsPath);

    var configCode = file_read({ path: 'agents/js/config.js' });
    if (!configCode || !configCode.trim()) throw new Error('Cannot read: agents/js/config.js');

    // Wrap both files as CommonJS modules so require('./config.js') works inside action file
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
    if (!exported || typeof exported.action !== 'function') {
        throw new Error('No action() exported from: ' + jsPath);
    }
    return exported.action({ ticket: ticket, jobParams: agentParams });
}

/**
 * Processes a rule with localExecution: true.
 * For each matching ticket: fetches full ticket, runs postJSAction in-process.
 */
function processRuleLocally(rule, ruleIndex) {
    var label = rule.description || ('Rule #' + (ruleIndex + 1));
    console.log('\n══ [LOCAL] ' + label + ' ══');
    console.log('   JQL: ' + rule.jql + (rule.limit ? ' (limit: ' + rule.limit + ')' : ''));

    if (rule.enabled === false) {
        console.log('  ⏸️  Rule disabled — skipping');
        return { processedKeys: [], skippedKeys: [] };
    }

    if (!rule.jql || !rule.configFile) {
        console.warn('  ⚠️  Skipping rule — jql and configFile are required');
        return { processedKeys: [], skippedKeys: [] };
    }

    // Read agent config to get postJSAction path and params (customParams, metadata, etc.)
    var agentConfig;
    try {
        var raw = file_read({ path: rule.configFile });
        agentConfig = JSON.parse(raw);
    } catch (e) {
        console.error('  ❌ Cannot read/parse configFile: ' + rule.configFile + ' — ' + e);
        return { processedKeys: [], skippedKeys: [] };
    }

    var agentParams = agentConfig.params || {};

    // Add initiator from environment variable for local execution
    try {
        if (JIRA_INITIATOR_ACCOUNT_ID) {
            agentParams.initiator = JIRA_INITIATOR_ACCOUNT_ID;
        }
    } catch (e) {}

    var postJSActionPath = agentParams.postJSAction;

    if (!postJSActionPath) {
        console.warn('  ⚠️  No postJSAction in ' + rule.configFile + ' — cannot run locally');
        return { processedKeys: [], skippedKeys: [] };
    }

    var tickets = [];
    try {
        tickets = jira_search_by_jql({ jql: rule.jql, fields: ['key', 'labels'] }) || [];
    } catch (e) {
        console.error('  ❌ Jira query failed: ' + (e.message || e));
        return { processedKeys: [], skippedKeys: [] };
    }

    if (typeof rule.limit === 'number' && tickets.length > rule.limit) {
        console.log('  Limiting from ' + tickets.length + ' to ' + rule.limit + ' ticket(s)');
        tickets = tickets.slice(0, rule.limit);
    }

    if (tickets.length === 0) {
        console.log('  No tickets found.');
        return { processedKeys: [], skippedKeys: [] };
    }

    console.log('  Found ' + tickets.length + ' ticket(s) — running locally via ' + postJSActionPath);

    var processedKeys = [];
    var skippedKeys = [];

    tickets.forEach(function(ticket) {
        var key = ticket.key;

        if (rule.skipIfLabel && hasLabel(ticket, rule.skipIfLabel)) {
            console.log('  ⏭️  ' + key + ' skipped (label: ' + rule.skipIfLabel + ')');
            skippedKeys.push(key);
            return;
        }

        if (rule.targetStatus) {
            moveStatus(key, rule.targetStatus);
        }

        // Fetch full ticket so action() has all fields available
        var fullTicket;
        try {
            var ticketRaw = jira_get_ticket(key);
            fullTicket = (typeof ticketRaw === 'string') ? JSON.parse(ticketRaw) : ticketRaw;
            if (!fullTicket || !fullTicket.key) throw new Error('Empty ticket returned');
        } catch (e) {
            console.error('  ❌ Failed to fetch ticket ' + key + ': ' + e);
            return;
        }

        try {
            console.log('  ▶️  ' + key + ' → ' + postJSActionPath);
            var result = runLocalAction(postJSActionPath, fullTicket, agentParams);
            console.log('  ✅ ' + key + ' done — action: ' + (result && result.action || JSON.stringify(result).substring(0, 80)));
            processedKeys.push(key);

            if (rule.addLabel) {
                try { jira_add_label({ key: key, label: rule.addLabel }); } catch (e) {}
            }
        } catch (e) {
            console.error('  ❌ Local execution failed for ' + key + ': ' + (e.message || e));
        }
    });

    return { processedKeys: processedKeys, skippedKeys: skippedKeys };
}

// ─── Rule processor ───────────────────────────────────────────────────────────

function processRule(rule, repoInfo, ruleIndex) {
    if (rule.localExecution) {
        return processRuleLocally(rule, ruleIndex);
    }

    var label = rule.description || ('Rule #' + (ruleIndex + 1));
    console.log('\n══ ' + label + ' ══');
    console.log('   JQL: ' + rule.jql + (rule.limit ? ' (limit: ' + rule.limit + ')' : ''));

    if (rule.enabled === false) {
        console.log('  ⏸️  Rule disabled — skipping');
        return { processedKeys: [], skippedKeys: [] };
    }

    if (!rule.jql || !rule.configFile) {
        console.warn('  ⚠️  Skipping rule — jql and configFile are required');
        return { processedKeys: [], skippedKeys: [] };
    }

    var tickets = [];
    try {
        tickets = jira_search_by_jql({ jql: rule.jql, fields: ['key', 'labels'] }) || [];
    } catch (e) {
        console.error('  ❌ Jira query failed: ' + (e.message || e));
        return { processedKeys: [], skippedKeys: [] };
    }

    // Enforce limit client-side
    if (typeof rule.limit === 'number' && tickets.length > rule.limit) {
        console.log('  Limiting from ' + tickets.length + ' to ' + rule.limit + ' ticket(s)');
        tickets = tickets.slice(0, rule.limit);
    }

    if (tickets.length === 0) {
        console.log('  No tickets found.');
        return { processedKeys: [], skippedKeys: [] };
    }

    console.log('  Found ' + tickets.length + ' ticket(s)');

    var processedKeys = [];
    var skippedKeys   = [];

    tickets.forEach(function(ticket) {
        var key = ticket.key;

        if (rule.skipIfLabel && hasLabel(ticket, rule.skipIfLabel)) {
            console.log('  ⏭️  ' + key + ' skipped (label: ' + rule.skipIfLabel + ')');
            skippedKeys.push(key);
            return;
        }

        if (rule.targetStatus) {
            moveStatus(key, rule.targetStatus);
        }

        var triggered = triggerWorkflow(repoInfo, key, rule);

        if (triggered && rule.addLabel) {
            try { jira_add_label({ key: key, label: rule.addLabel }); } catch (e) {}
        }

        if (triggered) processedKeys.push(key);
    });

    return { processedKeys: processedKeys, skippedKeys: skippedKeys };
}

// ─── Main ─────────────────────────────────────────────────────────────────────

function action(params) {
    var p     = params.jobParams || params;
    var rules = p.rules;

    if (!rules || rules.length === 0) {
        console.error('❌ No rules defined in jobParams.rules');
        return { success: false, error: 'No rules defined' };
    }

    if (!p.owner || !p.repo) {
        console.error('❌ jobParams.owner and jobParams.repo are required');
        return { success: false, error: 'Missing owner or repo' };
    }

    var repoInfo = { owner: p.owner, repo: p.repo };
    console.log('SM Agent — ' + repoInfo.owner + '/' + repoInfo.repo + ' (' + rules.length + ' rules)');

    var allProcessedKeys = [];
    var allSkippedKeys   = [];

    rules.forEach(function(rule, i) {
        var result = processRule(rule, repoInfo, i);
        allProcessedKeys = allProcessedKeys.concat(result.processedKeys);
        allSkippedKeys   = allSkippedKeys.concat(result.skippedKeys);
    });

    console.log('\n══ SM Agent complete — processed: ' + allProcessedKeys.length + ' ' +
        (allProcessedKeys.length ? '[' + allProcessedKeys.join(', ') + ']' : '') +
        ', skipped: ' + allSkippedKeys.length +
        (allSkippedKeys.length ? ' [' + allSkippedKeys.join(', ') + ']' : '') + ' ══');

    return {
        success: true,
        processed: allProcessedKeys.length,
        skipped: allSkippedKeys.length,
        processedKeys: allProcessedKeys,
        skippedKeys: allSkippedKeys
    };
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { action: action };
}
