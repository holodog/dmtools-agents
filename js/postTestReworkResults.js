/**
 * Post Test Rework Results Action (postJSAction for pr_test_automation_rework)
 *
 * Rework flow:
 *   AI reads ci_failures.md → fixes test code → runs tests locally → writes test_automation_result.json
 *   → If passed:  stage test files + commit + push to existing PR → move to In Review - Passed
 *   → If failed: stage test files + commit + push to existing PR → move to In Review - Failed
 *
 * DIFFERS from postTestAutomationResults.js:
 *   - Does NOT create PR (PR already exists on test/{KEY} branch)
 *   - Does NOT check for existing test files (rework always has them)
 *   - Removes rework-specific labels (sm_test_rework_triggered)
 *
 * HOW TO REVERT BACK TO CI-BASED REWORK:
 *   1. In pr_test_automation_rework.json, change postJSAction to:
 *        "postJSAction": "agents/js/postNewCiReworkResults.js"
 *   2. Restore skipAIProcessing: true in pr_test_automation_rework.json
 *   3. Restore cliPrompt to: "./agents/prompts/new_test_ci_rework_prompt.md"
 *   Commit 4c5ce73 (2026-05-21) was the last state using CI-based rework.
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

function readFile(path) {
    try {
        const content = file_read({ path: path });
        return (content && content.trim()) ? content : null;
    } catch (e) {
        console.warn('Could not read file ' + path + ':', e);
        return null;
    }
}

function readResultJson() {
    try {
        const raw = readFile('outputs/test_automation_result.json');
        if (!raw) {
            console.warn('outputs/test_automation_result.json is empty or missing');
            return null;
        }
        const parsed = JSON.parse(raw);
        console.log('Test rework result status:', parsed.status);
        return parsed;
    } catch (e) {
        console.error('Failed to parse test_automation_result.json:', e);
        return null;
    }
}

function action(params) {
    try {
        const actualParams = params.ticket ? params : (params.jobParams || params);
        const ticketKey = actualParams.ticket.key;
        const ticketSummary = actualParams.ticket.fields ? actualParams.ticket.fields.summary : ticketKey;

        console.log('=== Processing test rework results for', ticketKey, '===');

        // Step 1: Read structured result
        const result = readResultJson();
        if (!result) {
            jira_post_comment({
                key: ticketKey,
                comment: 'h3. ⚠️ Test Rework Error\n\nCould not read test result JSON. AI may not have written test_automation_result.json.'
            });
            return { success: false, error: 'No test result JSON found' };
        }

        const status = (result.status || '').toLowerCase();
        const passed = status === 'passed';

        // Step 2: Configure git author
        try {
            cli_execute_command({ command: 'git config user.name "' + GIT_CONFIG.AUTHOR_NAME + '"' });
            cli_execute_command({ command: 'git config user.email "' + GIT_CONFIG.AUTHOR_EMAIL + '"' });
        } catch (e) {
            console.warn('Failed to configure git author:', e);
        }

        // Step 3: Read current branch
        const branchName = cleanCommandOutput(
            cli_execute_command({ command: 'git branch --show-current' }) || ''
        );
        if (!branchName) {
            return { success: false, error: 'Could not determine current branch' };
        }

        // Guard: refuse to push to main/master
        if (branchName === 'main' || branchName === 'master') {
            return { success: false, error: 'Refusing to commit directly to "' + branchName + '". Expected test/' + ticketKey + ' branch.' };
        }

        console.log('Current branch:', branchName);

        // Step 4: Stage test files only (NOT outputs/)
        try { cli_execute_command({ command: 'git add e2e/tests/' }); } catch (e) {}
        try { cli_execute_command({ command: 'git add e2e/fixtures/' }); } catch (e) {}
        try { cli_execute_command({ command: 'git add e2e/helpers/' }); } catch (e) {}
        try { cli_execute_command({ command: 'git add services/*/e2e/*_test.go' }); } catch (e) {}
        try { cli_execute_command({ command: 'git add testing/' }); } catch (e) {}
        try { cli_execute_command({ command: 'git add src/test/' }); } catch (e) {}

        // Step 5: Check for changes
        const rawStatus = cli_execute_command({ command: 'git status --porcelain' }) || '';
        const statusOutput = cleanCommandOutput(rawStatus);
        const statusLines = statusOutput.split('\n').filter(function(line) {
            var trimmed = line.trim();
            return trimmed &&
                trimmed.indexOf('?? input/') !== 0 &&
                trimmed.indexOf(' M agents') !== 0 &&
                trimmed.indexOf('M agents') !== 0;
        }).join('\n');

        if (!statusLines.trim()) {
            console.log('ℹ️ No test file changes to commit — pushing existing branch');
        } else {
            // Step 6: Commit
            cli_execute_command({
                command: 'git commit -m "' + ticketKey + ' test rework: ' + ticketSummary + '"'
            });
            console.log('✅ Committed rework fix');
        }

        // Step 7: Push
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
            return { success: false, error: 'Branch not found on remote after push' };
        }

        console.log('✅ Pushed to remote branch:', branchName);

        // Step 8: Find PR URL for comment
        let prUrl = null;
        try {
            const listOutput = cleanCommandOutput(
                cli_execute_command({ command: 'gh pr list --head ' + branchName + ' --state open --json url --jq ".[0].url"' }) || ''
            );
            if (listOutput && listOutput.startsWith('https://')) prUrl = listOutput;
        } catch (e) {}

        // Step 9: Post Jira comment
        try {
            const fixSummary = actualParams.response || '';
            let comment = 'h3. 🔧 Test Rework ' + (passed ? 'PASSED' : 'FAILED') + '\n\n';
            if (prUrl) {
                comment += '*Pull Request*: ' + prUrl + '\n';
            }
            comment += '*Local Test Result*: ' + (result.summary || status) + '\n';
            if (result.error) {
                comment += '*Error*: ' + result.error + '\n';
            }
            if (fixSummary) {
                comment += '\n---\n\n' + fixSummary;
            }
            jira_post_comment({ key: ticketKey, comment: comment });
            console.log('✅ Posted Jira comment');
        } catch (e) {
            console.warn('Failed to post Jira comment:', e);
        }

        // Step 10: Move to final status
        if (passed) {
            try {
                jira_move_to_status({ key: ticketKey, statusName: STATUSES.IN_REVIEW_PASSED });
                console.log('✅ Moved', ticketKey, 'to', STATUSES.IN_REVIEW_PASSED);
            } catch (e) {
                console.warn('Failed to move to In Review - Passed:', e);
            }
        } else {
            try {
                jira_move_to_status({ key: ticketKey, statusName: STATUSES.IN_REVIEW_FAILED });
                console.log('✅ Moved', ticketKey, 'to', STATUSES.IN_REVIEW_FAILED);
            } catch (e) {
                console.warn('Failed to move to In Review - Failed:', e);
            }
        }

        // Step 11: Remove WIP and rework trigger labels
        const wipLabel = actualParams.metadata && actualParams.metadata.contextId
            ? actualParams.metadata.contextId + '_wip'
            : 'new_test_ci_rework_wip';
        try { jira_remove_label({ key: ticketKey, label: wipLabel }); } catch (e) {}
        try { jira_remove_label({ key: ticketKey, label: LABELS.NEW_SM_CI_REWORK }); } catch (e) {}
        try { jira_remove_label({ key: ticketKey, label: LABELS.NEW_CI_RETRY }); } catch (e) {}

        const customParams = (actualParams.customParams) ||
            (params.jobParams && params.jobParams.customParams) ||
            (params.customParams);
        const removeLabel = customParams && customParams.removeLabel;
        if (removeLabel) {
            try {
                jira_remove_label({ key: ticketKey, label: removeLabel });
                console.log('✅ Removed SM label:', removeLabel);
            } catch (e) {}
        }

        console.log('✅ Test rework complete —', passed ? 'PASSED' : 'FAILED');

        return {
            success: true,
            status: result.status,
            ticketKey: ticketKey,
            prUrl: prUrl,
            branchName: branchName
        };

    } catch (error) {
        console.error('❌ Error in postTestReworkResults:', error);
        try {
            const key = (params.ticket || (params.jobParams && params.jobParams.ticket) || {}).key;
            if (key) {
                jira_post_comment({
                    key: key,
                    comment: 'h3. ❌ Test Rework Error\n\n{code}' + error.toString() + '{code}'
                });
            }
        } catch (e) {}

        // Release labels on error too
        try {
            const key = (params.ticket || (params.jobParams && params.jobParams.ticket) || {}).key;
            if (key) {
                jira_remove_label({ key: key, label: LABELS.NEW_SM_CI_REWORK });
                jira_remove_label({ key: key, label: LABELS.NEW_CI_RETRY });
            }
        } catch (e) {}

        return { success: false, error: error.toString() };
    }
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { action };
}
