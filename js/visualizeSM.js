/**
 * SM Workflow Visualizer
 *
 * turn sm_ms.json rules into Mermaid diagram.
 */

function action(params) {
    try {
        var raw = file_read({ path: 'sm_ms.json' });
        var config = JSON.parse(raw);
        var rules = config.params.jobParams.rules;

        var edges = [];

        rules.forEach(function(rule) {
            if (rule.enabled === false) return;

            // extract 'from' status from JQL
            var from = 'Unknown';
            var jql = rule.jql || '';
            var statusMatch = jql.match(/status\s+(?:in\s+\(([^)]+)\)|=\s+['"]([^'"]+)['"])/i);
            if (statusMatch) {
                from = (statusMatch[1] || statusMatch[2]).replace(/['"]/g, '').split(',')[0].trim();
            }

            // extract 'to' status
            var to = rule.targetStatus || 'Action';
            if (to === 'Action' && rule.description) {
                var descMatch = rule.description.match(/→\s+([^,]+)/);
                if (descMatch) to = descMatch[1].trim();
            }

            var label = rule.description ? rule.description.split('→')[0].trim() : 'Rule';
            
            edges.push('    ' + from.replace(/\s+/g, '_') + '([' + from + ']) -->|"' + label + '"| ' + to.replace(/\s+/g, '_') + '([' + to + '])');
        });

        var mermaid = '```mermaid\ngraph TD\n' + edges.join('\n') + '\n```';
        
        var content = '# SM Agent Workflow\n\nAuto-generated from `sm_ms.json` rules.\n\n' + mermaid + '\n';
        
        file_write({ path: 'outputs/SM_WORKFLOW.md', content: content });
        console.log('✅ SM_WORKFLOW.md generated');

        return { success: true };
    } catch (e) {
        console.error('❌ Visualize fail:', e.message);
        return { success: false, error: e.message };
    }
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { action: action };
}
