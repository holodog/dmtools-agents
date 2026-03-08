/**
 * Pre-CLI Development Setup Action
 * Combined preCliJSAction for development agents:
 * 1. Moves ticket to In Development status
 * 2. Checks out the feature branch (creating if needed) — ai/<TICKET-KEY>
 * 3. Fetches existing question subtasks with answers into the input folder
 *
 * Used by: story_development.json, test_case_automation.json
 */

const { GIT_CONFIG, STATUSES } = require('./config.js');
const fetchQuestionsToInput = require('./fetchQuestionsToInput.js');
const fetchLinkedTestsToInput = require('./fetchLinkedTestsToInput.js');

/**
 * Clean command output from script wrapper artifacts
 * @param {string} output - Raw command output
 * @returns {string} Cleaned output
 */
function cleanCommandOutput(output) {
    if (!output) {
        return '';
    }
    const lines = output.split('\n').filter(function(line) {
        return line.indexOf('Script started') === -1 &&
               line.indexOf('Script done') === -1 &&
               line.indexOf('COMMAND=') === -1 &&
               line.indexOf('COMMAND_EXIT_CODE=') === -1;
    });
    return lines.join('\n').trim();
}

function checkoutBranch(ticketKey) {
    var branchName = 'ai/' + ticketKey;
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

    var localBranches = '';
    try {
        var rawLocal = cli_execute_command({ command: 'git branch --list "' + branchName + '"' }) || '';
        localBranches = cleanCommandOutput(rawLocal);
    } catch (e) {
        console.warn('Error checking local branches:', e);
    }

    if (localBranches.trim()) {
        console.log('Branch exists locally, rebasing from main:', branchName);
        cli_execute_command({ command: 'git checkout ' + branchName });
        try {
            var rebaseOutput = cleanCommandOutput(
                cli_execute_command({ command: 'git rebase origin/' + GIT_CONFIG.DEFAULT_BASE_BRANCH }) || ''
            );
            if (rebaseOutput.indexOf('CONFLICT') !== -1) {
                throw new Error('Rebase conflict detected: ' + rebaseOutput.substring(0, 200));
            }
        } catch (rebaseErr) {
            console.warn('Rebase failed, resetting to main:', rebaseErr);
            try { cli_execute_command({ command: 'git rebase --abort' }); } catch (_) {}
            cli_execute_command({ command: 'git reset --hard origin/' + GIT_CONFIG.DEFAULT_BASE_BRANCH });
        }
    } else {
        var remoteBranches = '';
        try {
            var rawRemote = cli_execute_command({ command: 'git ls-remote --heads origin ' + branchName }) || '';
            remoteBranches = cleanCommandOutput(rawRemote);
        } catch (e) {
            console.warn('Error checking remote branches:', e);
        }

        if (remoteBranches.trim()) {
            console.log('Branch exists on remote, checking out and rebasing from main:', branchName);
            cli_execute_command({ command: 'git checkout -b ' + branchName + ' origin/' + branchName });
            try {
                var rebaseOutput2 = cleanCommandOutput(
                    cli_execute_command({ command: 'git rebase origin/' + GIT_CONFIG.DEFAULT_BASE_BRANCH }) || ''
                );
                if (rebaseOutput2.indexOf('CONFLICT') !== -1) {
                    throw new Error('Rebase conflict detected: ' + rebaseOutput2.substring(0, 200));
                }
            } catch (rebaseErr) {
                console.warn('Rebase failed, resetting to main:', rebaseErr);
                try { cli_execute_command({ command: 'git rebase --abort' }); } catch (_) {}
                cli_execute_command({ command: 'git reset --hard origin/' + GIT_CONFIG.DEFAULT_BASE_BRANCH });
            }
        } else {
            console.log('Creating new branch from', GIT_CONFIG.DEFAULT_BASE_BRANCH + ':', branchName);
            cli_execute_command({ command: 'git checkout ' + GIT_CONFIG.DEFAULT_BASE_BRANCH });
            cli_execute_command({ command: 'git pull origin ' + GIT_CONFIG.DEFAULT_BASE_BRANCH });
            cli_execute_command({ command: 'git checkout -b ' + branchName });
        }
    }

    console.log('Branch ready:', branchName);
}

function action(params) {
    try {
        // Handle both Teammate workflow and standalone dmtools execution
        // - Teammate workflow: params.inputFolderPath exists directly
        // - Standalone dmtools (JSRunner): params.jobParams.inputFolderPath
        var actualParams = params.inputFolderPath ? params : (params.jobParams || params);

        var folder = actualParams.inputFolderPath;
        var ticketKey = folder.split('/').pop();

        // 1. Move ticket to In Development
        try {
            jira_move_to_status({ key: ticketKey, statusName: STATUSES.IN_DEVELOPMENT });
            console.log('Moved ' + ticketKey + ' to In Development');
        } catch (e) {
            console.warn('Failed to move ticket to In Development:', e);
        }

        // 2. Checkout or create feature branch
        try {
            checkoutBranch(ticketKey);
        } catch (e) {
            console.error('Branch checkout failed (non-fatal):', e);
        }

        // 3. Fetch questions with answers into input folder
        fetchQuestionsToInput.action(actualParams);

        // 4. Fetch linked test cases (with failure comments) into input folder
        // Gives the bug agent context about what the test asserts and why it's failing
        try {
            fetchLinkedTestsToInput.action(actualParams);
        } catch (e) {
            console.warn('fetchLinkedTestsToInput failed (non-fatal):', e);
        }

    } catch (error) {
        console.error('Error in preCliDevelopmentSetup:', error);
    }
}
