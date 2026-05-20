/**
 * Pre-CLI Test Automation Setup Action (preCliJSAction for test_case_automation)
 * 1. Moves ticket to In Development
 * 2. Creates/checks out test/{TICKET-KEY} branch from main
 */

const { GIT_CONFIG, STATUSES } = require('./config.js');
const fetchLinkedBugsToInput = require('./fetchLinkedBugsToInput.js');

/**
 * Determine target repo from Test Case's linked Story labels.
 * Returns 'ms_back', 'ms_front', or 'ms_root'.
 */
function getTargetRepoFromLinkedStory(ticketKey, ticket) {
    try {
        // Use ticket if already available, otherwise fetch
        var fullTicket = ticket;
        if (!fullTicket) {
            var raw = jira_get_ticket(ticketKey);
            fullTicket = (typeof raw === 'string') ? JSON.parse(raw) : raw;
        }

        // First check the Test Case's own labels
        var labels = (fullTicket.fields && fullTicket.fields.labels) || [];

        // If Test Case has explicit repo labels, use them
        for (var k = 0; k < labels.length; k++) {
            var l = labels[k].toLowerCase();
            if (l === 'frontend' || l === 'ui' || l === 'react') return 'ms_front';
            if (l === 'backend' || l === 'api' || l === 'go') return 'ms_back';
        }

        // Fall back to linked Story/Bug
        var issueLinks = fullTicket.fields && fullTicket.fields.issuelinks;
        if (!issueLinks) return 'ms_root';

        for (var i = 0; i < issueLinks.length; i++) {
            var link = issueLinks[i];
            var linkedIssue = link.outwardIssue || link.inwardIssue;
            if (!linkedIssue || !linkedIssue.key) continue;
            var linkedType = (linkedIssue.fields && linkedIssue.fields.issuetype && linkedIssue.fields.issuetype.name) || '';
            if (linkedType !== 'Story' && linkedType !== 'Bug') continue;

            try {
                var parentRaw = jira_get_ticket(linkedIssue.key);
                var parent = (typeof parentRaw === 'string') ? JSON.parse(parentRaw) : parentRaw;
                var parentLabels = (parent.fields && parent.fields.labels) || [];
                for (var j = 0; j < parentLabels.length; j++) {
                    var pl = parentLabels[j].toLowerCase();
                    if (pl === 'frontend' || pl === 'ui' || pl === 'react') return 'ms_front';
                    if (pl === 'backend' || pl === 'api' || pl === 'go') return 'ms_back';
                }
            } catch (e) {
                console.warn('Could not fetch linked issue ' + linkedIssue.key + ':', e);
            }
        }
    } catch (e) {
        console.warn('Could not determine target repo:', e);
    }
    return 'ms_root';
}

/**
 * Check if current workflow repo matches the Test Case's target repo.
 * If mismatch, skip automation and move ticket back to Backlog.
 */
function checkRepoMatch(ticketKey, ticket) {
    // Current workflow runs from ms_back (this is the ms_back repo)
    var currentRepo = 'ms_back';
    var targetRepo = getTargetRepoFromLinkedStory(ticketKey, ticket);

    if (targetRepo === currentRepo) {
        console.log('Repo match: target=' + targetRepo + ', current=' + currentRepo + ' — proceeding');
        return true;
    }

    console.log('⚠️ Repo mismatch: target=' + targetRepo + ', current=' + currentRepo + ' — skipping');

    // Move ticket back to Backlog (Ready For Testing) so the correct repo's SM Agent picks it up
    try {
        jira_move_to_status({ key: ticketKey, statusName: STATUSES.READY_FOR_TESTING });
        console.log('✅ Moved ' + ticketKey + ' back to ' + STATUSES.READY_FOR_TESTING);
    } catch (e) {
        console.warn('Could not move ticket back to Ready For Testing:', e);
    }

    // Add skip label so SM rule excludes this ticket
    try {
        jira_add_label({ key: ticketKey, label: 'sm_test_automation_wrong_repo' });
        console.log('✅ Added wrong_repo skip label to ' + ticketKey);
    } catch (e) {
        console.warn('Could not add skip label:', e);
    }

    // Post comment explaining why
    try {
        jira_post_comment({
            key: ticketKey,
            comment: 'h3. ⚠️ Skipped — Wrong Repo\n\nThis test case targets *' + targetRepo + '* but automation ran from *' + currentRepo + '*.\n\nMoved back to *Ready For Testing* so the correct repo\'s SM Agent can pick it up.\n\n*Action needed*: Ensure the ' + targetRepo + ' SM Agent rule triggers for this ticket.'
        });
    } catch (e) {
        console.warn('Could not post comment:', e);
    }

    return false;
}

function cleanCommandOutput(output) {
    if (!output) return '';
    return output.split('\n').filter(function(line) {
        return line.indexOf('Script started') === -1 &&
               line.indexOf('Script done') === -1 &&
               line.indexOf('COMMAND=') === -1 &&
               line.indexOf('COMMAND_EXIT_CODE=') === -1;
    }).join('\n').trim();
}

function checkoutBranch(ticketKey) {
    var branchName = 'test/' + ticketKey;
    console.log('Setting up branch:', branchName);

    try {
        cli_execute_command({ command: 'git config user.name "' + GIT_CONFIG.AUTHOR_NAME + '"' });
        cli_execute_command({ command: 'git config user.email "' + GIT_CONFIG.AUTHOR_EMAIL + '"' });
    } catch (e) {
        console.warn('Failed to configure git author:', e);
    }

    try {
        cli_execute_command({ command: 'git fetch origin --prune' });
    } catch (e) {
        console.warn('Could not fetch remote branches:', e);
    }

    var localBranches = cleanCommandOutput(
        cli_execute_command({ command: 'git branch --list "' + branchName + '"' }) || ''
    );

    /**
     * Bring the current branch up-to-date with main.
     * Strategy: hard-reset to latest main (safest — test branches only add test code
     * in e2e/tests/, e2e/fixtures/, e2e/helpers/ which will be re-written by the agent).
     *
     * NOTE: we skip rebase entirely because:
     *   - Rebase fails on multi-file conflicts (package-lock.json, etc.)
     *   - git rebase --continue requires EDITOR (GIT_EDITOR=true workaround is fragile)
     *   - Shell metacharacters (||, &&) are blocked by the command validator
     */
    function syncWithMain() {
        var base = 'origin/' + GIT_CONFIG.DEFAULT_BASE_BRANCH;
        console.log('Syncing branch to latest main (hard reset)');
        try {
            cli_execute_command({ command: 'git fetch origin ' + GIT_CONFIG.DEFAULT_BASE_BRANCH });
            cli_execute_command({ command: 'git reset --hard ' + base });
            console.log('✅ Branch updated to latest main');
        } catch (resetErr) {
            console.error('❌ Failed to sync branch — may need manual attention:', resetErr);
        }
    }

    if (localBranches.trim()) {
        console.log('Branch exists locally, syncing from main:', branchName);
        cli_execute_command({ command: 'git checkout ' + branchName });
        syncWithMain();
    } else {
        var remoteBranches = cleanCommandOutput(
            cli_execute_command({ command: 'git ls-remote --heads origin ' + branchName }) || ''
        );

        if (remoteBranches.trim()) {
            console.log('Branch exists on remote, checking out and syncing from main:', branchName);
            cli_execute_command({ command: 'git checkout -b ' + branchName + ' origin/' + branchName });
            syncWithMain();
        } else {
            console.log('Creating new branch from', GIT_CONFIG.DEFAULT_BASE_BRANCH + ':', branchName);
            cli_execute_command({ command: 'git checkout ' + GIT_CONFIG.DEFAULT_BASE_BRANCH });
            cli_execute_command({ command: 'git pull origin ' + GIT_CONFIG.DEFAULT_BASE_BRANCH });
            cli_execute_command({ command: 'git checkout -b ' + branchName });
        }
    }

    console.log('✅ Branch ready:', branchName);
}

function action(params) {
    try {
        var actualParams = params.inputFolderPath ? params : (params.jobParams || params);
        var folder = actualParams.inputFolderPath;
        var ticketKey = folder.split('/').pop();

        console.log('=== Test automation setup for:', ticketKey, '===');

        // Step 0: Check if this Test Case targets the current repo
        if (!checkRepoMatch(ticketKey, actualParams.ticket)) {
            console.log('⚠️ Repo mismatch — skipping automation for', ticketKey);
            return { success: true, skipped: true, reason: 'repo_mismatch', ticketKey: ticketKey };
        }

        // Step 1: Move ticket to In Development
        try {
            jira_move_to_status({ key: ticketKey, statusName: STATUSES.IN_DEVELOPMENT });
            console.log('✅ Moved ' + ticketKey + ' to ' + STATUSES.IN_DEVELOPMENT);
        } catch (e) {
            console.warn('Failed to move ticket to In Development:', e);
        }

        // Step 2: Create/checkout test/{KEY} branch from main
        try {
            checkoutBranch(ticketKey);
        } catch (e) {
            console.error('Branch checkout failed (non-fatal):', e);
        }

        // Step 3: Fetch linked bugs (with fix comments) into input folder
        // This gives the test agent context about HOW bugs were fixed (timing, delays, etc.)
        try {
            fetchLinkedBugsToInput.action(actualParams);
        } catch (e) {
            console.warn('fetchLinkedBugsToInput failed (non-fatal):', e);
        }

        console.log('✅ Test automation setup complete for', ticketKey);

    } catch (error) {
        console.error('❌ Error in preCliTestAutomationSetup:', error);
    }
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { action };
}
