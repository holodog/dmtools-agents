/**
 * Checkout Branch Pre-CLI Action
 * Creates or checks out the feature branch for the ticket before the CLI agent runs.
 * Branch name format: ai/<TICKET-KEY>
 * If the branch already exists (locally or remotely), it is checked out directly.
 * postAction (developTicketAndCreatePR) then just commits and pushes the current branch.
 */

const { GIT_CONFIG } = require('./config.js');

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

function action(params) {
    try {
        var ticketKey = params.ticket.key;
        var branchName = 'ai/' + ticketKey;

        console.log('Setting up branch for ticket:', ticketKey, '→', branchName);

        // Configure git author
        try {
            cli_execute_command({ command: 'git config user.name "' + GIT_CONFIG.AUTHOR_NAME + '"' });
            cli_execute_command({ command: 'git config user.email "' + GIT_CONFIG.AUTHOR_EMAIL + '"' });
            console.log('Configured git author');
        } catch (e) {
            console.warn('Failed to configure git author:', e);
        }

        // Clean ALL uncommitted changes including dmtools-generated input/ files
        // The input/ folder is created by CliExecutionHelper before preCliJSAction runs
        try {
            cli_execute_command({ command: 'git clean -fdx 2>/dev/null || true' });
            cli_execute_command({ command: 'git checkout -- . 2>/dev/null || true' });
            // git clean -fdx removes git-ignored files too (input/, caches, dmtools.env)
            // Also clean inside agents submodule (dmtools may create cache there)
            cli_execute_command({ command: 'cd agents && git clean -fdx && git checkout -- . && cd ..' });
            console.log('Cleaned all uncommitted changes and dmtools artifacts');
        } catch (e) {
            console.warn('Could not clean workspace:', e);
        }

        // Fetch latest remote state
        try {
            cli_execute_command({ command: 'git fetch origin --prune' });
            console.log('Fetched remote');
        } catch (e) {
            console.warn('Could not fetch remote branches:', e);
        }

        // ALWAYS start fresh from base branch - delete local branch if exists
        var localBranches = '';
        try {
            var rawLocal = cli_execute_command({ command: 'git branch --list "' + branchName + '"' }) || '';
            localBranches = cleanCommandOutput(rawLocal);
        } catch (e) {
            console.warn('Error checking local branches:', e);
        }

        if (localBranches.trim()) {
            console.log('Deleting existing local branch:', branchName);
            cli_execute_command({ command: 'git branch -D ' + branchName });
        }

        // Check if branch exists on remote
        var remoteBranches = '';
        try {
            var rawRemote = cli_execute_command({ command: 'git ls-remote --heads origin ' + branchName }) || '';
            remoteBranches = cleanCommandOutput(rawRemote);
        } catch (e) {
            console.warn('Error checking remote branches:', e);
        }

        if (remoteBranches.trim()) {
            // Branch exists on remote - delete and recreate from base to avoid conflicts
            console.log('Branch exists on remote, deleting remote tracking branch and recreating from base:', branchName);
            try {
                cli_execute_command({ command: 'git push origin --delete ' + branchName + ' 2>/dev/null || true' });
                console.log('Deleted remote branch');
            } catch (e) {
                console.warn('Could not delete remote branch:', e);
            }
        }

        // Always create fresh branch from base
        console.log('Creating fresh branch from', GIT_CONFIG.DEFAULT_BASE_BRANCH + ':', branchName);
        cli_execute_command({ command: 'git checkout ' + GIT_CONFIG.DEFAULT_BASE_BRANCH });
        cli_execute_command({ command: 'git pull origin ' + GIT_CONFIG.DEFAULT_BASE_BRANCH });
        cli_execute_command({ command: 'git checkout -b ' + branchName });

        // Verify we're on the correct branch
        var finalBranch = '';
        try {
            var rawFinalBranch = cli_execute_command({ command: 'git branch --show-current' }) || '';
            finalBranch = cleanCommandOutput(rawFinalBranch);
        } catch (e) {
            console.warn('Error reading final branch:', e);
        }

        if (finalBranch !== branchName) {
            console.warn('WARNING: Expected branch ' + branchName + ' but currently on ' + (finalBranch || 'unknown'));
            console.log('Forcing checkout to', branchName);
            try {
                cli_execute_command({ command: 'git checkout ' + branchName });
                finalBranch = branchName;
                console.log('✅ Forced checkout succeeded');
            } catch (forceErr) {
                console.error('Failed to force checkout:', forceErr);
            }
        }

        console.log('Branch ready:', finalBranch);

    } catch (error) {
        console.error('Error in checkoutBranch:', error);
        // Non-fatal: log but do not block CLI execution
    }
}
