/**
 * Post API Sync to Jira — Backend Development Post-Action
 *
 * Reads outputs/response.md for API endpoint changes, posts structured
 * Jira comment with endpoint summary, and creates/updates Confluence page
 * with full API documentation.
 */

const { LABELS, JIRA_FIELDS } = require('./config.js');

function action(params) {
    try {
        var ticketKey = params.ticket.key;
        var ticketSummary = params.ticket.fields.summary || '';

        // 1. Read development summary
        var response = '';
        try {
            response = file_read('outputs/response.md');
            if (response) response = response.trim();
        } catch (e) {
            console.warn('Could not read outputs/response.md, skipping API sync:', e);
            return { success: false, reason: 'No response.md' };
        }
        if (!response) {
            return { success: false, reason: 'response.md is empty' };
        }

        // 2. Extract API changes section
        var apiChanges = extractApiChanges(response);
        if (apiChanges.length === 0) {
            console.log('No API changes detected in response.md');
            return { success: false, reason: 'No API changes found' };
        }

        console.log('Extracted ' + apiChanges.length + ' API endpoint(s) from response.md');

        // 3. Post structured comment to Jira
        var jiraComment = buildJiraComment(apiChanges, ticketKey, ticketSummary);
        try {
            jira_post_comment({ key: ticketKey, comment: jiraComment });
            console.log('Posted API comment to ' + ticketKey);
        } catch (e) {
            console.error('Failed to post Jira comment:', e);
        }

        // 4. Create/update Confluence page
        var confluenceUrl = '';
        try {
            var pageHtml = buildConfluenceBody(apiChanges, ticketKey, ticketSummary);
            confluenceUrl = createOrUpdateConfluencePage(ticketKey, ticketSummary, pageHtml);
            if (confluenceUrl) {
                // Append Confluence link to Jira comment
                jira_post_comment({
                    key: ticketKey,
                    comment: 'h3. API Documentation\n\nFull API specification: ' + confluenceUrl
                });
                console.log('Created Confluence page: ' + confluenceUrl);
            }
        } catch (e) {
            console.warn('Failed to create Confluence page:', e);
        }

        return {
            success: true,
            message: 'Posted ' + apiChanges.length + ' API change(s) to Jira' + (confluenceUrl ? ' + Confluence' : ''),
            apiChanges: apiChanges.length,
            confluenceUrl: confluenceUrl
        };

    } catch (error) {
        console.error('Error in postApiSyncToJira:', error);
        return { success: false, error: error.toString() };
    }
}

/**
 * Extract API endpoint changes from response.md content.
 * Looks for "API Changes" heading, or scans for HTTP method + /api/ patterns.
 */
function extractApiChanges(content) {
    var endpoints = [];

    // Strategy 1: Find "API Changes" section and parse table
    var apiSectionStart = content.indexOf('API Changes');
    if (apiSectionStart !== -1) {
        var sectionEnd = content.indexOf('## ', apiSectionStart + 20);
        if (sectionEnd === -1) sectionEnd = content.length;
        var section = content.substring(apiSectionStart, sectionEnd);

        // Parse markdown table rows: |METHOD /api/path|Description|
        var tableLines = section.split('\n');
        var inTable = false;
        for (var i = 0; i < tableLines.length; i++) {
            var line = tableLines[i].trim();
            // Skip header separator lines
            if (line.indexOf('|---') === 0 || line.indexOf('||--') === 0) { inTable = true; continue; }
            if (line.indexOf('|') !== 0) { if (inTable) break; continue; }

            // Parse: |GET /api/path|Description text|
            var cells = line.split('|');
            // cells[0] is empty (before first |), cells[1] is endpoint, cells[2] is description
            var endpoint = '';
            var desc = '';
            for (var j = 1; j < cells.length; j++) {
                var val = cells[j].trim();
                if (val === '' || val === '---' || val === '--') continue;
                if (endpoint === '') { endpoint = val; }
                else { desc = val; break; }
            }
            if (endpoint && (endpoint.indexOf('GET') === 0 || endpoint.indexOf('POST') === 0 || endpoint.indexOf('PUT') === 0 || endpoint.indexOf('DELETE') === 0 || endpoint.indexOf('PATCH') === 0)) {
                endpoints.push({ method: extractMethod(endpoint), path: extractPath(endpoint), description: desc });
            }
        }
    }

    // Strategy 2: Fallback — scan entire content for endpoint patterns
    if (endpoints.length === 0) {
        var lines = content.split('\n');
        var seen = {};
        for (var k = 0; k < lines.length; k++) {
            var match = lines[k].match(/\b(GET|POST|PUT|DELETE|PATCH)\s+(\/api\/\S+)/);
            if (match) {
                var key = match[1] + ' ' + match[2];
                if (!seen[key]) {
                    seen[key] = true;
                    endpoints.push({ method: match[1], path: match[2], description: lines[k].trim() });
                }
            }
        }
    }

    return endpoints;
}

function extractMethod(endpoint) {
    var methods = ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'];
    for (var i = 0; i < methods.length; i++) {
        if (endpoint.indexOf(methods[i]) === 0) {
            return methods[i];
        }
    }
    return 'GET';
}

function extractPath(endpoint) {
    var slashIdx = endpoint.indexOf('/');
    return slashIdx !== -1 ? endpoint.substring(slashIdx) : endpoint;
}

function buildJiraComment(endpoints, ticketKey, summary) {
    var comment = 'h3. *API Changes*\n\n';
    comment += 'Endpoints added/modified for ' + ticketKey + ' (' + summary + '):\n\n';
    comment += '||Method||Endpoint||Description||\n';
    for (var i = 0; i < endpoints.length; i++) {
        var e = endpoints[i];
        comment += '|' + e.method + '|' + e.path + '|' + e.description + '|\n';
    }
    comment += '\n{color:#707070}OpenAPI spec updated in {code}public/docs/openapi.yaml{code} and docs at {code}DOCS/api/rest-api.md{code}{color}\n';
    return comment;
}

function buildConfluenceBody(endpoints, ticketKey, summary) {
    var html = '<h1>API Changes: ' + escapeHtml(ticketKey) + '</h1>';
    html += '<p>Ticket: <a href="https://majesens.atlassian.net/browse/' + ticketKey + '">' + ticketKey + '</a> — ' + escapeHtml(summary) + '</p>';
    html += '<p>Central API docs: <a href="https://majesens.atlassian.net/wiki/spaces/majesens/pages/17301505/Majesens+API+Specification">Majesens API Specification</a></p>';

    html += '<h2>Endpoints</h2>';
    html += '<table><thead><tr><th>Method</th><th>Endpoint</th><th>Description</th></tr></thead><tbody>';
    for (var i = 0; i < endpoints.length; i++) {
        var e = endpoints[i];
        var color = methodColor(e.method);
        html += '<tr><td><span style="color:' + color + ';font-weight:bold">' + e.method + '</span></td>';
        html += '<td><code>' + escapeHtml(e.path) + '</code></td>';
        html += '<td>' + escapeHtml(e.description) + '</td></tr>';
    }
    html += '</tbody></table>';

    return html;
}

function createOrUpdateConfluencePage(ticketKey, summary, pageHtml) {
    var spaceKey = 'majesens';
    try {
        var space = CONFLUENCE_DEFAULT_SPACE || spaceKey;
    } catch (e) {
        space = spaceKey;
    }

    var pageTitle = 'API: ' + ticketKey + ' — ' + summary;
    pageTitle = pageTitle.substring(0, 255);

    try {
        var result = confluence_create_page({
            spaceKey: space,
            title: pageTitle,
            body: pageHtml,
            bodyFormat: 'storage'
        });

        if (result && typeof result === 'string') {
            try {
                var parsed = JSON.parse(result);
                if (parsed && parsed._links && parsed._links.webui) {
                    return 'https://majesens.atlassian.net' + parsed._links.webui;
                }
            } catch (e) {}
        }
    } catch (e) {
        console.warn('Confluence page creation failed:', e);
    }

    return '';
}

function methodColor(method) {
    var colors = { GET: '#2ecc71', POST: '#3498db', PUT: '#f39c12', DELETE: '#e74c3c', PATCH: '#9b59b6' };
    return colors[method] || '#7f8c8d';
}

function escapeHtml(str) {
    if (!str) return '';
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { action: action };
}
