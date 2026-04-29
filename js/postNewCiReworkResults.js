/**
 * Post New CI Rework Results Action (postJSAction for new_test_ci_rework)
 *
 * After coding agent fixes test based on CI failure logs:
 * 1. Commits and pushes fix to existing PR branch
 * 2. Posts Jira comment: "Fix pushed, CI will re-run"
 * 3. Moves ticket back to "CI Pending"
 * 4. Removes WIP and retry trigger labels
 */

const { GIT_CONFIG, STATUSES, LABELS } = require('./config.js');

function cleanCommandOutput(output) {
    if (!output) return '';
    return output.split('\n').filter(function(line) {
        return line.indexOf('Script started') === -1 &&
               line.indexOf('Script done') === -1 &&
               line.indexOf('COMMAND=') === -1 &&
               line.indexOf('COMMAND_EXIT_CODE=') === -1;
    }).join('\n').trim();
}

function action(params) {
    const actualParams = params.ticket ? params : (params.jobParams || params);
    const ticketKey = actualParams.ticket.key;
    const fixSummary = actualParams.response || '_(No fix summary)_';

    const wipLabel = actualParams.metadata && actualParams.metadata.contextId
        ? actualParams.metadata.contextId + '_wip'
        : 'new_test_ci_rework_wip';

    function releaseLock() {
        try { jira_remove_label({ key: ticketKey, label: wipLabel }); } catch (e) {}
        try { jira_remove_label({ key: ticketKey, label: LABELS.NEW_SM_CI_REWORK }); } catch (e) {}
        try { jira_remove_label({ key: ticketKey, label: LABELS.NEW_CI_RETRY }); } catch (e) {}
    }

    try {
        console.log('=== Processing new CI rework results for', ticketKey, '===');

        // Step 1: Configure git
        try {
            cli_execute_command({ command: 'git config user.name "' + GIT_CONFIG.AUTHOR_NAME + '"' });
            cli_execute_command({ command: 'git config user.email "' + GIT_CONFIG.AUTHOR_EMAIL + '"' });
        } catch (e) {}

        // Step 2: Read current branch
        const branchName = cleanCommandOutput(
            cli_execute_command({ command: 'git branch --show-current' }) || ''
        );
        if (!branchName) {
            releaseLock();
            return { success: false, error: 'Could not determine current branch' };
        }

        // Guard: refuse to push directly to main
        if (branchName === 'main' || branchName === 'master') {
            releaseLock();
            return { success: false, error: 'Refusing to commit directly to "' + branchName + '". Expected test/' + ticketKey + ' branch.' };
        }

        console.log('Current branch:', branchName);

        // Step 3: Stage test files
        try { cli_execute_command({ command: 'git add e2e/tests/' }); } catch (e) {}
        try { cli_execute_command({ command: 'git add e2e/fixtures/' }); } catch (e) {}
        try { cli_execute_command({ command: 'git add e2e/helpers/' }); } catch (e) {}
        try { cli_execute_command({ command: 'git add services/*/e2e/*_test.go' }); } catch (e) {}
        try { cli_execute_command({ command: 'git add testing/' }); } catch (e) {}
        try { cli_execute_command({ command: 'git add src/test/' }); } catch (e) {}

        // Step 4: Check if there are changes
        const statusOutput = cleanCommandOutput(
            cli_execute_command({ command: 'git status --porcelain' }) || ''
        );

        if (statusOutput.trim()) {
            cli_execute_command({
                command: 'git commit -m "' + ticketKey + ' test fix: address CI failure"'
            });
            console.log('✅ Committed fix');
        } else {
            console.log('ℹ️ No changes to commit');
        }

        // Step 5: Push
        try {
            cli_execute_command({ command: 'git push -u origin ' + branchName });
        } catch (e) {
            cli_execute_command({ command: 'git push -u origin ' + branchName + ' --force' });
        }

        // Verify push
        const remoteCheck = cleanCommandOutput(
            cli_execute_command({ command: 'git ls-remote --heads origin ' + branchName }) || ''
        );
        if (!remoteCheck.trim()) {
            releaseLock();
            return { success: false, error: 'Branch not found on remote after push' };
        }

        console.log('✅ Pushed to remote branch:', branchName);

        // Step 6: Find PR URL
        let prUrl = null;
        try {
            const listOutput = cleanCommandOutput(
                cli_execute_command({ command: 'gh pr list --head ' + branchName + ' --state open --json url --jq ".[0].url"' }) || ''
            );
            if (listOutput && listOutput.startsWith('https://')) prUrl = listOutput;
        } catch (e) {}

        // Step 7: Post Jira comment
        try {
            let comment = 'h3. 🔧 CI Fix Pushed\n\n';
            if (prUrl) {
                comment += '*Pull Request*: ' + prUrl + '\n';
            }
            comment += '\nCI will re-run automatically on the PR.\n';
            comment += '\n---\n\n' + fixSummary;
            jira_post_comment({ key: ticketKey, comment: comment });
            console.log('✅ Posted Jira comment');
        } catch (e) {
            console.warn('Failed to post Jira comment:', e);
        }

        // Step 8: Move back to CI Pending
        try {
            jira_move_to_status({ key: ticketKey, statusName: STATUSES.CI_PENDING });
            console.log('✅ Moved', ticketKey, 'to', STATUSES.CI_PENDING);
        } catch (e) {
            console.warn('Failed to move to CI Pending:', e);
        }

        // Step 9: Remove WIP and trigger labels
        releaseLock();

        console.log('✅ CI rework complete — pushed fix, back to CI Pending');

        return {
            success: true,
            action: 'ci_pending',
            ticketKey: ticketKey,
            prUrl: prUrl,
            branchName: branchName
        };

    } catch (error) {
        console.error('❌ Error in new CI rework post-action:', error);
        try {
            jira_post_comment({
                key: ticketKey,
                comment: 'h3. ❌ CI Rework Error\n\n{code}' + error.toString() + '{code}'
            });
        } catch (e) {}
        releaseLock();
        return { success: false, error: error.toString() };
    }
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { action };
}
