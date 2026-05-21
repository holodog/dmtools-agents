/**
 * Post Test Automation Results Action (postJSAction for test_case_automation)
 *
 * HYBRID FLOW (2026-05-21):
 *   AI writes test code → runs tests locally → reads result JSON
 *   → If passed:  stage + commit + push + create PR → move to In Review - Passed
 *   → If failed: stage + commit + push + create PR → move to In Review - Failed
 *   → CI becomes final verification, not primary test executor
 *
 * HOW TO REVERT BACK TO CI-BASED FLOW:
 *   1. In test_case_automation.json, change postJSAction to:
 *        "postJSAction": "agents/js/postNewTestAutomationResults.js"
 *   2. The old CI-based file (postNewTestAutomationResults.js) is unchanged in this repo.
 *      It pushes code → moves to CI Pending → SM checks GitHub Actions CI → rework loop.
 *   3. Optionally restore skipAIProcessing: true in test_case_automation.json so AI
 *      only writes code without running tests locally.
 *   Commit 4c5ce73 (2026-05-21) was the last state using CI-based flow.
 *   Git diff to restore: git show 4c5ce73 -- test_case_automation.json
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
        console.log('Test result status:', parsed.status);
        return parsed;
    } catch (e) {
        console.error('Failed to parse test_automation_result.json:', e);
        return null;
    }
}

function performGitOperations(branchName, commitMessage) {
    try {
        // Clean agents submodule — AI agent may have modified files inside it
        try { cli_execute_command({ command: 'git submodule update --init --recursive --force' }); } catch (e) {}

        // Stage testing/ folder
        try { cli_execute_command({ command: 'git add testing/' }); } catch (e) {}

        // Stage Vitest test files
        try { cli_execute_command({ command: 'git add src/test/' }); } catch (e) {}

        // Stage Playwright E2E test files
        try { cli_execute_command({ command: 'git add e2e/tests/' }); } catch (e) {}

        // Stage any Go e2e test files
        try { cli_execute_command({ command: 'git add services/*/e2e/*_test.go' }); } catch (e) {}

        var rawStatus = cli_execute_command({ command: 'git status --porcelain' }) || '';
        var statusLines = rawStatus.split('\n').filter(function(line) {
            var trimmed = line.trim();
            // Ignore untracked input/ folder and agents submodule dirty content
            return trimmed &&
                trimmed.indexOf('?? input/') !== 0 &&
                trimmed.indexOf(' M agents') !== 0 &&
                trimmed.indexOf('M agents') !== 0;
        }).join('\n');

        if (!statusLines || !statusLines.trim()) {
            console.log('No new changes to commit — checking if test files already exist');
            var existingTests = checkExistingTestFiles();
            if (existingTests.length > 0) {
                console.log('Test files already exist in index: ' + existingTests.join(', '));
                return { success: true, branchName: branchName, noNewCommit: true };
            }
            var remoteBranchCheck = cleanCommandOutput(
                cli_execute_command({ command: 'git ls-remote --heads origin ' + branchName }) || ''
            );
            if (remoteBranchCheck.trim()) {
                return { success: true, branchName: branchName, noNewCommit: true };
            }
            try {
                cli_execute_command({ command: 'git push -u origin ' + branchName + ' --force' });
                return { success: true, branchName: branchName, noNewCommit: true };
            } catch (pushErr) {
                return { success: false, error: 'No test files were written and could not push branch' };
            }
        }

        console.log('Committing...');
        try {
            cli_execute_command({
                command: 'git commit -m "' + commitMessage.replace(/"/g, '\\"') + '"'
            });
        } catch (commitErr) {
            console.warn('Commit failed, checking for existing test files:', commitErr);
            var existingOnFail = checkExistingTestFiles();
            if (existingOnFail.length > 0) {
                console.log('Test files already exist in index: ' + existingOnFail.join(', '));
                return { success: true, branchName: branchName, noNewCommit: true };
            }
            throw commitErr;
        }

        console.log('Pushing to remote...');
        try {
            cli_execute_command({ command: 'git push -u origin ' + branchName });
        } catch (e) {
            cli_execute_command({ command: 'git push -u origin ' + branchName + ' --force' });
        }

        var remoteBranch = cleanCommandOutput(
            cli_execute_command({ command: 'git ls-remote --heads origin ' + branchName }) || ''
        );
        if (!remoteBranch.trim()) {
            throw new Error('Branch not found on remote after push');
        }

        console.log('✅ Git operations completed');
        return { success: true, branchName: branchName };

    } catch (error) {
        console.error('Git operations failed:', error);
        return { success: false, error: error.toString() };
    }
}

function checkExistingTestFiles() {
    var found = [];
    try {
        var raw = cli_execute_command({ command: 'git ls-files e2e/tests/' }) || '';
        raw.split('\n').forEach(function(f) {
            if (f.trim() && f.indexOf('test_MAJESENS-') >= 0 && found.indexOf(f.trim()) === -1) {
                found.push(f.trim());
            }
        });
    } catch (e) {}
    try {
        var raw2 = cli_execute_command({ command: 'git ls-files testing/' }) || '';
        raw2.split('\n').forEach(function(f) {
            if (f.trim() && found.indexOf(f.trim()) === -1) found.push(f.trim());
        });
    } catch (e) {}
    try {
        var raw3 = cli_execute_command({ command: 'git ls-files src/test/' }) || '';
        raw3.split('\n').forEach(function(f) {
            if (f.trim() && found.indexOf(f.trim()) === -1) found.push(f.trim());
        });
    } catch (e) {}
    return found;
}

function createPullRequest(title, branchName) {
    try {
        var escapedTitle = title.replace(/"/g, '\\"').replace(/\n/g, ' ');

        var prBodyFile = readFile('outputs/pr_body.md')
            ? 'outputs/pr_body.md'
            : (readFile('outputs/response.md') ? 'outputs/response.md' : null);

        var prArgs = 'gh pr create --title "' + escapedTitle + '" --base ' + GIT_CONFIG.DEFAULT_BASE_BRANCH + ' --head ' + branchName;
        if (prBodyFile) {
            prArgs += ' --body-file "' + prBodyFile + '"';
        }

        var output = cleanCommandOutput(cli_execute_command({ command: prArgs }) || '');

        var prUrl = null;
        var urlMatch = output.match(/https:\/\/github\.com\/[^\s]+/);
        if (urlMatch) {
            prUrl = urlMatch[0];
        }

        if (!prUrl) {
            var prNumberMatch = output.match(/#(\d+)/);
            if (prNumberMatch) {
                try {
                    var remoteUrl = cleanCommandOutput(
                        cli_execute_command({ command: 'git config --get remote.origin.url' }) || ''
                    );
                    var repoMatch = remoteUrl.match(/github\.com[:/]([^/]+\/[^/.]+)/);
                    if (repoMatch) {
                        prUrl = 'https://github.com/' + repoMatch[1].replace('.git', '') + '/pull/' + prNumberMatch[1];
                    }
                } catch (e) {}
            }
        }

        if (!prUrl) {
            try {
                var listOutput = cleanCommandOutput(
                    cli_execute_command({ command: 'gh pr list --head ' + branchName + ' --json url --jq ".[0].url"' }) || ''
                );
                if (listOutput && listOutput.startsWith('https://')) prUrl = listOutput;
            } catch (e) {}
        }

        console.log('✅ PR created:', prUrl || '(URL not found)');
        return { success: true, prUrl: prUrl };

    } catch (error) {
        console.error('Failed to create PR:', error);
        return { success: false, error: error.toString() };
    }
}

function action(params) {
    try {
        const ticketKey = params.ticket.key;
        const ticketSummary = params.ticket.fields ? params.ticket.fields.summary : ticketKey;
        const jiraComment = params.response || '';

        console.log('=== Processing test automation results for', ticketKey, '===');

        // Step 1: Read structured result (from local test execution by AI agent)
        const result = readResultJson();
        if (!result) {
            jira_post_comment({
                key: ticketKey,
                comment: 'h3. ⚠️ Test Automation Error\n\nCould not read test result JSON. Check workflow logs.'
            });
            return { success: false, error: 'No test result JSON found' };
        }

        const status = (result.status || '').toLowerCase();
        const passed = status === 'passed';
        const blockedByHuman = status === 'blocked_by_human';

        // Step 2: Configure git author
        try {
            cli_execute_command({ command: 'git config user.name "' + GIT_CONFIG.AUTHOR_NAME + '"' });
            cli_execute_command({ command: 'git config user.email "' + GIT_CONFIG.AUTHOR_EMAIL + '"' });
        } catch (e) {
            console.warn('Failed to configure git author:', e);
        }

        // Step 3: Read current branch (set by preCliTestAutomationSetup)
        var rawBranch = cli_execute_command({ command: 'git branch --show-current' }) || '';
        const branchName = cleanCommandOutput(rawBranch);
        if (!branchName) {
            console.warn('Could not determine current branch — skipping git operations');
        }

        // Step 4: Commit + push + create PR
        let prUrl = null;
        let noCodeChanges = false;
        if (branchName) {
            const commitMessage = ticketKey + ' test: automate ' + ticketSummary;
            const gitResult = performGitOperations(branchName, commitMessage);

            if (gitResult.success && !gitResult.noNewCommit) {
                const prTitle = ticketKey + ' ' + ticketSummary;
                const prResult = createPullRequest(prTitle, branchName);
                prUrl = prResult.prUrl;
                if (!prResult.success || !prUrl) {
                    console.error('PR creation failed — resetting ticket to Backlog for retry');
                    try {
                        jira_post_comment({ key: ticketKey, comment: 'h3. ⚠️ PR Creation Failed\n\nTest code was pushed to branch {code}' + branchName + '{code} but the Pull Request could not be created.\n\nTicket moved back to *Backlog* — will be re-processed automatically.\n\nError: ' + (prResult.error || 'unknown') });
                        jira_move_to_status({ key: ticketKey, statusName: STATUSES.TODO });
                    } catch (e) { console.warn('Could not reset to Backlog:', e); }
                    try {
                        const smTriggerLabel = params.jobParams && params.jobParams.customParams && params.jobParams.customParams.removeLabel;
                        if (smTriggerLabel) {
                            jira_remove_label({ key: ticketKey, label: smTriggerLabel });
                            console.log('✅ Removed SM trigger label on PR failure:', smTriggerLabel);
                        }
                    } catch (e) { console.warn('Could not remove SM trigger label:', e); }
                    return { success: false, error: 'PR creation failed: ' + (prResult.error || 'no URL returned') };
                }
            } else if (gitResult.noNewCommit) {
                noCodeChanges = true;
                console.log('ℹ️ No test code changes — skipping PR review, moving ticket directly');
            } else {
                console.warn('Git operations failed:', gitResult.error);
                try {
                    jira_post_comment({ key: ticketKey, comment: 'h3. ⚠️ Git Operations Failed\n\nFailed to commit/push test code: ' + gitResult.error + '\n\nTicket moved back to *Backlog* — will be re-processed automatically.' });
                    jira_move_to_status({ key: ticketKey, statusName: STATUSES.TODO });
                } catch (e) { console.warn('Could not reset to Backlog:', e); }
                try {
                    jira_remove_label({ key: ticketKey, label: 'sm_test_automation_triggered' });
                } catch (e) {}
                return { success: false, error: 'Git operations failed: ' + gitResult.error };
            }
        }

        // Step 5: Post Jira comment
        try {
            let comment = jiraComment || '';
            if (prUrl) {
                comment += '\n\n*Test Branch PR*: ' + prUrl;
            }
            if (noCodeChanges) {
                comment += '\n\nℹ️ _Test code unchanged from previous run._';
            }
            if (comment) {
                jira_post_comment({ key: ticketKey, comment: comment });
                console.log('✅ Posted test result comment to Jira');
            }
        } catch (e) {
            console.warn('Failed to post Jira comment:', e);
        }

        // Step 6: Handle outcome
        // When no code changes, skip "In Review" and move directly to final status
        if (blockedByHuman) {
            var blockedComment = 'h3. 🚫 Test Automation Blocked — Awaiting Human Setup\n\n';
            if (result.blocked_reason) {
                blockedComment += result.blocked_reason + '\n\n';
            }
            if (result.missing && result.missing.length > 0) {
                blockedComment += 'h4. Required setup:\n\n';
                result.missing.forEach(function(item) {
                    blockedComment += '* *' + (item.name || '?') + '*';
                    if (item.description) blockedComment += ': ' + item.description;
                    blockedComment += '\n';
                    if (item.how_to_add) {
                        blockedComment += '{code:bash}' + item.how_to_add + '{code}\n';
                    }
                });
            }
            if (prUrl) {
                blockedComment += '\n*Test Branch PR*: ' + prUrl;
            }
            blockedComment += '\n\nOnce setup is complete, move this ticket back to *Backlog* to trigger re-run.';

            try {
                jira_post_comment({ key: ticketKey, comment: blockedComment });
            } catch (e) { console.warn('Failed to post blocked comment:', e); }

            try {
                jira_move_to_status({ key: ticketKey, statusName: STATUSES.BLOCKED });
            } catch (e) { console.warn('Failed to move to Blocked:', e); }

            const wipLabelBlocked = params.metadata && params.metadata.contextId
                ? params.metadata.contextId + '_wip'
                : 'test_case_automation_wip';
            try { jira_remove_label({ key: ticketKey, label: wipLabelBlocked }); } catch (e) {}

            const smTriggerLabel = params.jobParams && params.jobParams.customParams && params.jobParams.customParams.removeLabel;
            if (smTriggerLabel) {
                try { jira_remove_label({ key: ticketKey, label: smTriggerLabel }); } catch (e) {}
            }

            console.log('🚫 Test', ticketKey, 'blocked by human — awaiting credentials/data');
            return { success: true, status: 'blocked_by_human', ticketKey, prUrl };
        }

        if (passed) {
            // Tests passed locally — push to In Review - Passed for final PR review
            // (CI will run as final verification when PR merges)
            try {
                var passedStatus = noCodeChanges ? STATUSES.PASSED : STATUSES.IN_REVIEW_PASSED;
                jira_move_to_status({ key: ticketKey, statusName: passedStatus });
                console.log('✅ Passed — moved', ticketKey, 'to', passedStatus);
            } catch (e) {
                console.warn('Failed to move to Passed:', e);
            }
        } else {
            // Tests failed locally — move to In Review - Failed for rework
            try {
                var failedStatus = noCodeChanges ? STATUSES.FAILED : STATUSES.IN_REVIEW_FAILED;
                jira_move_to_status({ key: ticketKey, statusName: failedStatus });
                console.log('✅ Failed — moved', ticketKey, 'to', failedStatus);
            } catch (e) {
                console.warn('Failed to move to Failed:', e);
            }
        }

        // Step 7: Add label
        try {
            jira_add_label({ key: ticketKey, label: LABELS.AI_TEST_AUTOMATION });
        } catch (e) {
            console.warn('Failed to add label:', e);
        }

        // Step 8: Remove WIP label
        const wipLabel = params.metadata && params.metadata.contextId
            ? params.metadata.contextId + '_wip'
            : 'test_case_automation_wip';
        try { jira_remove_label({ key: ticketKey, label: wipLabel }); } catch (e) {}

        // Step 9: Remove SM trigger label so ticket can be re-triggered
        const smTriggerLabel = params.jobParams && params.jobParams.customParams && params.jobParams.customParams.removeLabel;
        if (smTriggerLabel) {
            try {
                jira_remove_label({ key: ticketKey, label: smTriggerLabel });
                console.log('✅ Removed SM trigger label:', smTriggerLabel);
            } catch (e) {}
        }

        console.log('✅ Test automation workflow complete:', passed ? 'PASSED' : 'FAILED');

        return {
            success: true,
            status: result.status,
            ticketKey: ticketKey,
            prUrl: prUrl
        };

    } catch (error) {
        console.error('❌ Error in postTestAutomationResults:', error);
        try {
            jira_post_comment({
                key: params.ticket.key,
                comment: 'h3. ❌ Test Automation Error\n\n{code}' + error.toString() + '{code}'
            });
        } catch (e) {}
        try {
            const smTriggerLabel = params.jobParams && params.jobParams.customParams && params.jobParams.customParams.removeLabel;
            if (smTriggerLabel) {
                jira_remove_label({ key: params.ticket.key, label: smTriggerLabel });
                console.log('✅ Removed SM trigger label on error:', smTriggerLabel);
            }
        } catch (e) {}
        return { success: false, error: error.toString() };
    }
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { action };
}
