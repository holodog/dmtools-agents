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
     * Strategy:
     *   1. Try rebase — if it fails, take main's version for ALL conflicting files
     *      (test branches only add test code in e2e/tests/, e2e/fixtures/, e2e/helpers/
     *      and never modify source/config files — main's version is always correct).
     *   2. If rebase --continue still fails after resolving, abort and fall back to
     *      hard-reset: checkout main, pull latest, then recreate the test branch.
     *      This is safe because test branch changes are already on the remote and
     *      will be re-applied when the agent writes new tests.
     */
    function syncWithMain() {
        var base = 'origin/' + GIT_CONFIG.DEFAULT_BASE_BRANCH;
        try {
            cli_execute_command({ command: 'git rebase ' + base });
            console.log('✅ Rebase succeeded');
            return;
        } catch (rebaseErr) {
            console.warn('Rebase failed, attempting conflict resolution:', rebaseErr);
        }

        // Attempt 1: resolve ALL conflicts by taking main's version for everything
        try {
            cli_execute_command({ command: 'git checkout --ours .' });
            cli_execute_command({ command: 'git add -A' });
            cli_execute_command({ command: 'git rebase --continue' });
            console.log('✅ Rebase resumed (took main\'s version for all conflicts)');
            return;
        } catch (continueErr) {
            console.warn('Rebase --continue failed, aborting:', continueErr);
        }
        try { cli_execute_command({ command: 'git rebase --abort' }); } catch (_) {}

        // Attempt 2: per-file resolution — keep test code, take main's version for everything else
        try {
            var statusOutput = cli_execute_command({ command: 'git diff --name-only --diff-filter=U' }) || '';
            var conflictingFiles = statusOutput.trim().split('\n').filter(function(f) { return f.trim().length > 0; });

            if (conflictingFiles.length > 0) {
                console.log('Resolving ' + conflictingFiles.length + ' conflicting files');
                conflictingFiles.forEach(function(file) {
                    if (file.indexOf('e2e/') === 0 || file.indexOf('testing/') === 0) {
                        cli_execute_command({ command: 'git checkout --theirs "' + file + '"' });
                    } else {
                        cli_execute_command({ command: 'git checkout --ours "' + file + '"' });
                    }
                });
                cli_execute_command({ command: 'git add -A' });
                cli_execute_command({ command: 'git rebase --continue' });
                console.log('✅ Rebase resumed after per-file conflict resolution');
                return;
            }
        } catch (perFileErr) {
            console.warn('Per-file resolution failed:', perFileErr);
        }
        try { cli_execute_command({ command: 'git rebase --abort' }); } catch (_) {}

        // Last resort: hard reset to main
        console.warn('Falling back to hard reset — recreating branch from latest main');
        try {
            cli_execute_command({ command: 'git stash --include-untracked' });
            cli_execute_command({ command: 'git checkout ' + GIT_CONFIG.DEFAULT_BASE_BRANCH });
            cli_execute_command({ command: 'git pull origin ' + GIT_CONFIG.DEFAULT_BASE_BRANCH });
            cli_execute_command({ command: 'git branch -D ' + branchName + ' || true' });
            cli_execute_command({ command: 'git checkout -b ' + branchName + ' ' + GIT_CONFIG.DEFAULT_BASE_BRANCH });
            console.log('✅ Hard reset branch to latest main — test code will be re-written by agent');
        } catch (resetErr) {
            console.error('❌ Hard reset failed — branch needs manual intervention:', resetErr);
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
