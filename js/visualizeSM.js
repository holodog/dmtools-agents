/**
 * SM Workflow Diagram Generator
 * Parses sm_ms.json rules and generates a Mermaid flowchart of status transitions.
 * Uses known workflow paths for the diagram + auto-generated rules table.
 */

function action(params) {
    var p = params.jobParams || params;
    var configFile = p.configFile || 'agents/sm_ms.json';

    // Read SM config
    var configCode;
    try {
        configCode = file_read({ path: configFile });
    } catch (e) {
        console.error('Cannot read ' + configFile + ': ' + e.message);
        return { success: false, error: 'Config read failed' };
    }

    var config;
    try {
        config = JSON.parse(configCode);
    } catch (e) {
        console.error('Invalid JSON in ' + configFile);
        return { success: false, error: 'JSON parse failed' };
    }

    var rules = config.params.jobParams.rules || [];

    // ── Build rule lookup by source status ──
    var ruleMap = {};
    for (var i = 0; i < rules.length; i++) {
        var rule = rules[i];
        var jql = rule.jql || '';
        var statusMatch = jql.match(/status\s+in\s*\(([^)]+)\)/);
        if (!statusMatch) continue;

        var sources = statusMatch[1].split(',').map(function(s) {
            return s.trim().replace(/'/g, '');
        });
        var configName = (rule.configFile || '').replace('agents/', '').replace('.json', '');
        var local = rule.localExecution ? ' (local)' : '';
        var enabled = rule.enabled !== false;

        sources.forEach(function(src) {
            if (!ruleMap[src]) ruleMap[src] = [];
            ruleMap[src].push({
                label: configName + local,
                target: rule.targetStatus || null,
                enabled: enabled,
                description: rule.description || ''
            });
        });
    }

    // ── Known workflow transitions ──
    var knownTransitions = [
        { from: 'Backlog', to: 'Backlog', label: 'story_questions (clarify)', type: 'loop' },
        { from: 'Backlog', to: 'BA Analysis', label: 'story_ba_check', type: 'story' },
        { from: 'BA Analysis', to: 'Ready For Development', label: 'story_acceptance_criterias', type: 'story' },
        { from: 'Solution Architecture', to: 'Ready For Development', label: 'story_solution', type: 'story' },
        { from: 'Ready For Development', to: 'In Development', label: 'story_development / bug_development', type: 'story' },
        { from: 'In Development', to: 'In Review', label: 'develop PR', type: 'story' },
        { from: 'In Review', to: 'In Rework', label: 'pr_review (conflicts)', type: 'review' },
        { from: 'In Review - Failed', to: 'In Rework', label: 'pr_rework', type: 'review' },
        { from: 'In Rework', to: 'In Review', label: 'pr_rework', type: 'review' },
        { from: 'In Review - Passed', to: 'Merged', label: 'retry_merge', type: 'review' },
        { from: 'In Development', to: 'Ready For Testing', label: 'task_done_check', type: 'task' },
        { from: 'Merged', to: 'Ready For Testing', label: 'test_cases_generator', type: 'story' },
        { from: 'Ready For Testing', to: 'In Testing', label: 'bug_test_cases_generator', type: 'bug' },
        { from: 'In Testing', to: 'Done', label: 'story_done_check', type: 'story' },
        { from: 'Backlog', to: 'In Development', label: 'test_case_automation', type: 'test' },
        { from: 'In Development', to: 'CI Pending', label: 'pr_test_automation_review', type: 'test' },
        { from: 'CI Pending', to: 'Done', label: 'new_test_ci_check', type: 'test' },
        { from: 'CI Pending', to: 'In Rework', label: 'pr_test_automation_rework', type: 'test' },
        { from: 'Failed', to: 'Bug To Fix', label: 'bug_creation', type: 'test' },
        { from: 'Bug To Fix', to: 'Backlog', label: 'bug_to_fix_check', type: 'test' }
    ];

    // ── Build Mermaid diagram ──
    var md = '# SM Agent Workflow Diagram\n\n';
    md += 'Automatically generated from `agents/sm_ms.json` rules.\n\n';
    md += '```mermaid\n';
    md += 'graph TD\n';
    md += '    classDef status fill:#e8f4fd,stroke:#0ea5e9,stroke-width:2px,color:#0c4a6e;\n';
    md += '    classDef gate fill:#f0fdf4,stroke:#22c55e,stroke-width:2px,color:#14532d;\n';
    md += '    classDef terminal fill:#f5f5f5,stroke:#666,stroke-width:2px,color:#333;\n';
    md += '\n';

    // Status nodes with styling
    var statuses = [
        'Backlog', 'BA Analysis', 'Solution Architecture',
        'Ready For Development', 'In Development', 'In Review',
        'In Review - Passed', 'In Review - Failed', 'In Rework',
        'Ready For Testing', 'In Testing', 'CI Pending',
        'Merged', 'Done', 'Failed', 'Bug To Fix'
    ];
    var gates = { 'Merged': true };
    var terminals = { 'Done': true, 'Failed': true, 'Bug To Fix': true };

    statuses.forEach(function(s) {
        var id = s.replace(/[\s\-]/g, '_');
        var cls = gates[s] ? 'gate' : (terminals[s] ? 'terminal' : 'status');
        md += '    ' + id + '["' + s + '"]:::' + cls + '\n';
    });

    md += '\n';

    // Transitions
    knownTransitions.forEach(function(t) {
        var fromId = t.from.replace(/[\s\-]/g, '_');
        var toId = t.to.replace(/[\s\-]/g, '_');
        md += '    ' + fromId + ' -->|' + t.label + '| ' + toId + '\n';
    });

    md += '```\n\n';

    // ── Rules table ──
    md += '## Rules\n\n';
    md += '| Rule | Source Status | Target | Enabled | Description |\n';
    md += '| :--- | :--- | :--- | :--- | :--- |\n';

    rules.forEach(function(rule) {
        var jql = rule.jql || '';
        var statusMatch = jql.match(/status\s+in\s*\(([^)]+)\)/);
        var sources = statusMatch ? statusMatch[1].split(',').map(function(s) { return s.trim().replace(/'/g, ''); }).join(', ') : 'N/A';
        var target = rule.targetStatus || 'via agent';
        var enabled = rule.enabled !== false ? 'Yes' : 'No';
        var configName = (rule.configFile || '').replace('agents/', '').replace('.json', '');
        var desc = rule.description || '';
        md += '| `' + configName + '` | ' + sources + ' | ' + target + ' | ' + enabled + ' | ' + desc + ' |\n';
    });

    md += '\n## Stats\n\n';
    md += '- **Total rules:** ' + rules.length + '\n';
    md += '- **Enabled:** ' + rules.filter(function(r) { return r.enabled !== false; }).length + '\n';
    md += '- **Disabled:** ' + rules.filter(function(r) { return r.enabled === false; }).length + '\n';
    md += '- **Workflow transitions:** ' + knownTransitions.length + '\n';

    // Write output
    var outputPath = 'agents/outputs/SM_WORKFLOW.md';
    try {
        file_write({ path: outputPath, content: md });
        console.log('Diagram written to ' + outputPath);
    } catch (e) {
        console.error('Write failed: ' + e.message);
        return { success: false, error: e.message };
    }

    return { success: true, rules: rules.length, transitions: knownTransitions.length };
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { action: action };
}
