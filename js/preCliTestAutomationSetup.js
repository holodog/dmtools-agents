/**
 * Pre-CLI Test Automation Setup Action (preCliJSAction for test_case_automation)
 * 1. Moves ticket to In Development
 * 2. Creates/checks out test/{TICKET-KEY} branch from main
 */

const { GIT_CONFIG, STATUSES } = require('./config.js');
const fetchLinkedBugsToInput = require('./fetchLinkedBugsToInput.js');

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
