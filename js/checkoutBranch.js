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

        // Clean any uncommitted changes (dmtools cache files, etc.)
        // Only remove untracked files to avoid undoing the checkout step
        try {
            cli_execute_command({ command: 'git clean -fd' });
            console.log('Cleaned untracked files');
        } catch (e) {
            console.warn('Could not clean working directory:', e);
        }

        // Fetch latest remote state
        try {
            cli_execute_command({ command: 'git fetch origin --prune' });
            console.log('Fetched remote');
        } catch (e) {
            console.warn('Could not fetch remote branches:', e);
        }

        // Double-check we're on the right branch by reading current branch
        var currentBranch = '';
        try {
            var rawBranch = cli_execute_command({ command: 'git branch --show-current' }) || '';
            currentBranch = cleanCommandOutput(rawBranch);
        } catch (e) {
            console.warn('Error checking current branch:', e);
        }

        console.log('Current branch before checkout logic:', currentBranch || '(unknown)');

        // Check if branch exists locally
        var localBranches = '';
        try {
            var rawLocal = cli_execute_command({ command: 'git branch --list "' + branchName + '"' }) || '';
            localBranches = cleanCommandOutput(rawLocal);
        } catch (e) {
            console.warn('Error checking local branches:', e);
        }

        if (localBranches.trim()) {
            // Branch exists locally — check it out
            console.log('Branch exists locally, checking out:', branchName);
            cli_execute_command({ command: 'git checkout ' + branchName });
        } else {
            // Check if branch exists on remote
            var remoteBranches = '';
            try {
                var rawRemote = cli_execute_command({ command: 'git ls-remote --heads origin ' + branchName }) || '';
                remoteBranches = cleanCommandOutput(rawRemote);
            } catch (e) {
                console.warn('Error checking remote branches:', e);
            }

            if (remoteBranches.trim()) {
                // Exists on remote — checkout tracking remote
                console.log('Branch exists on remote, checking out with tracking:', branchName);
                cli_execute_command({ command: 'git checkout -b ' + branchName + ' origin/' + branchName });
            } else {
                // New branch — start from base branch
                console.log('Creating new branch from', GIT_CONFIG.DEFAULT_BASE_BRANCH + ':', branchName);
                cli_execute_command({ command: 'git checkout ' + GIT_CONFIG.DEFAULT_BASE_BRANCH });
                cli_execute_command({ command: 'git pull origin ' + GIT_CONFIG.DEFAULT_BASE_BRANCH });
                cli_execute_command({ command: 'git checkout -b ' + branchName });
            }
        }

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
            // Force checkout to correct branch
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
