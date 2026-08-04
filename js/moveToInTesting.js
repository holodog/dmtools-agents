/**
 * Move To In Testing Action (postJSAction for test_cases_generator)
 * 1. Propagate parent Story's repo labels (frontend/backend) to newly created Test Cases
 * 2. Moves the ticket to "In Testing" status after test cases are generated.
 */

const { STATUSES } = require('./config.js');

/**
 * Propagate repo labels from Story to its newly created Test Cases.
 * TestCasesGenerator only adds 'ai_generated' — it doesn't know about frontend/backend split.
 * We copy frontend/backend/api/go/ui/react labels from the parent Story so downstream
 * automation (test_case_automation, CI check, merge) can determine the target repo.
 */
function propagateRepoLabels(storyKey) {
    try {
        // Fetch the story to get its labels
        var storyRaw = jira_get_ticket(storyKey);
        var story = (typeof storyRaw === 'string') ? JSON.parse(storyRaw) : storyRaw;
        var storyLabels = (story.fields && story.fields.labels) || [];

        // Find repo-related labels on the story
        var repoLabels = storyLabels.filter(function(l) {
            var lower = l.toLowerCase();
            return lower === 'frontend' || lower === 'backend' ||
                   lower === 'api' || lower === 'go' ||
                   lower === 'ui' || lower === 'react';
        });

        if (repoLabels.length === 0) {
            console.log('No repo labels found on story ' + storyKey + ' — skipping label propagation');
            return;
        }

        console.log('Repo labels on ' + storyKey + ': ' + repoLabels.join(', '));

        // Find all Test Cases linked to this story that have ai_generated label
        // (newly created by TestCasesGenerator).
        // NOTE: use standard Jira JQL linkedIssues() — NOT ScriptRunner's
        // issueFunction in linkedIssuesOf(). Without ScriptRunner installed that
        // query throws, the catch below swallows it, and labels silently never
        // propagate (downstream CI checks then search the wrong repo).
        var linkedTCsRaw = jira_jql('project = MAJESENS AND issuetype = "Test Case" AND issue in linkedIssues("' + storyKey + '") AND labels = ai_generated');
        var linkedTCs = (typeof linkedTCsRaw === 'string') ? JSON.parse(linkedTCsRaw) : linkedTCsRaw;
        var issues = linkedTCs.issues || linkedTCs || [];

        if (!issues.length) {
            console.log('No linked Test Cases found for ' + storyKey);
            return;
        }

        console.log('Found ' + issues.length + ' linked Test Case(s) — propagating labels');

        for (var i = 0; i < issues.length; i++) {
            var tcKey = issues[i].key || issues[i].id;
            if (!tcKey) continue;

            for (var j = 0; j < repoLabels.length; j++) {
                try {
                    jira_add_label({ key: tcKey, label: repoLabels[j] });
                    console.log('✅ Added ' + repoLabels[j] + ' to ' + tcKey);
                } catch (e) {
                    console.warn('Could not add ' + repoLabels[j] + ' to ' + tcKey + ':', e);
                }
            }
        }

    } catch (e) {
        console.warn('Failed to propagate repo labels:', e);
    }
}

function action(params) {
    try {
        const ticketKey = params.ticket ? params.ticket.key : null;
        if (!ticketKey) {
            return { success: false, error: 'No ticket key found in params' };
        }

        console.log('Moving ' + ticketKey + ' to ' + STATUSES.IN_TESTING);

        // Propagate repo labels from Story to newly created Test Cases
        propagateRepoLabels(ticketKey);

        jira_move_to_status({
            key: ticketKey,
            statusName: STATUSES.IN_TESTING
        });

        try {
            jira_remove_label({ key: ticketKey, label: 'sm_test_cases_triggered' });
        } catch (e) {
            console.log('Label sm_test_cases_triggered not found or already removed');
        }

        console.log('✅ ' + ticketKey + ' moved to ' + STATUSES.IN_TESTING);

        return {
            success: true,
            message: ticketKey + ' moved to ' + STATUSES.IN_TESTING
        };

    } catch (error) {
        console.error('❌ Error in moveToInTesting:', error);
        return { success: false, error: error.toString() };
    }
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { action };
}
