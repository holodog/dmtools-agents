/**
 * Post New Test Automation Results Action (postJSAction for new_test_case_automation)
 * Simplified version — AI agent writes test code only (no local test execution).
 * After coding agent finishes:
 * 1. Stages test files, commits, pushes, creates PR
 * 2. Posts Jira comment (PR link + CI pending)
 * 3. Moves ticket to "CI Pending" (waiting for GitHub Actions CI)
 * 4. Removes WIP label
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

function performGitOperations(branchName, commitMessage) {
    try {
        // Stage testing/ folder
        try { cli_execute_command({ command: 'git add testing/' }); } catch (e) {}

        // Stage Vitest test files
        try { cli_execute_command({ command: 'git add src/test/' }); } catch (e) {}

        // Stage Playwright E2E test files
        try { cli_execute_command({ command: 'git add e2e/tests/' }); } catch (e) {}

        // Stage any Go e2e test files
        try { cli_execute_command({ command: 'git add services/*/e2e/*_test.go' }); } catch (e) {}

        var rawStatus = cli_execute_command({ command: 'git status --porcelain' }) || '';
        var statusOutput = cleanCommandOutput(rawStatus);

        if (!statusOutput || !statusOutput.trim()) {
            console.warn('No new changes to commit in testing/');
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
        cli_execute_command({
            command: 'git commit -m "' + commitMessage.replace(/"/g, '\\"') + '"'
        });

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
        var ticketKey = params.ticket.key;
        var ticketSummary = params.ticket.fields ? params.ticket.fields.summary : ticketKey;
        var projectKey = ticketKey.split('-')[0];
        var jiraComment = params.response || '';

        console.log('=== Processing new test automation results for', ticketKey, '===');

        // Step 1: Configure git
        try {
            cli_execute_command({ command: 'git config user.name "' + GIT_CONFIG.AUTHOR_NAME + '"' });
            cli_execute_command({ command: 'git config user.email "' + GIT_CONFIG.AUTHOR_EMAIL + '"' });
        } catch (e) {}

        // Step 2: Read current branch
        var rawBranch = cli_execute_command({ command: 'git branch --show-current' }) || '';
        var branchName = cleanCommandOutput(rawBranch);
        if (!branchName) {
            console.warn('Could not determine current branch — skipping git operations');
        }

        // Step 3: Commit + push + create PR
        var prUrl = null;
        var noCodeChanges = false;
        if (branchName) {
            var commitMessage = ticketKey + ' test: automate ' + ticketSummary;
            var gitResult = performGitOperations(branchName, commitMessage);

            if (gitResult.success && !gitResult.noNewCommit) {
                var prTitle = ticketKey + ' ' + ticketSummary;
                var prResult = createPullRequest(prTitle, branchName);
                prUrl = prResult.prUrl;

                if (!prResult.success || !prUrl) {
                    console.error('PR creation failed — resetting ticket to Backlog for retry');
                    try {
                        jira_post_comment({
                            key: ticketKey,
                            comment: 'h3. ⚠️ PR Creation Failed\n\nTest code was pushed to branch {code}' + branchName + '{code} but PR could not be created.\n\nError: ' + (prResult.error || 'unknown')
                        });
                        jira_move_to_status({ key: ticketKey, statusName: STATUSES.TODO });
                    } catch (e) { console.warn('Could not reset to Backlog:', e); }
                    // Remove WIP and trigger labels
                    var wipLabel = params.metadata && params.metadata.contextId
                        ? params.metadata.contextId + '_wip'
                        : 'new_test_case_automation_wip';
                    try { jira_remove_label({ key: ticketKey, label: wipLabel }); } catch (e) {}
                    try { jira_remove_label({ key: ticketKey, label: LABELS.NEW_SM_TEST_AUTOMATION }); } catch (e) {}
                    return { success: false, error: 'PR creation failed: ' + (prResult.error || 'no URL') };
                }
            } else if (gitResult.noNewCommit) {
                noCodeChanges = true;
                console.log('ℹ️ No test code changes — skipping PR creation');
            } else {
                console.error('Git operations failed:', gitResult.error);
                try {
                    jira_post_comment({
                        key: ticketKey,
                        comment: 'h3. ⚠️ Git Operations Failed\n\n' + gitResult.error
                    });
                    jira_move_to_status({ key: ticketKey, statusName: STATUSES.TODO });
                } catch (e) { console.warn('Could not reset to Backlog:', e); }
                try {
                    var wipLabel2 = params.metadata && params.metadata.contextId
                        ? params.metadata.contextId + '_wip'
                        : 'new_test_case_automation_wip';
                    jira_remove_label({ key: ticketKey, label: wipLabel2 });
                } catch (e) {}
                return { success: false, error: 'Git operations failed: ' + gitResult.error };
            }
        }

        // Step 4: Post Jira comment
        try {
            var comment = 'h3. 🤖 Test Automation — PR Created\n\n';
            if (prUrl) {
                comment += '*Pull Request*: ' + prUrl + '\n';
            }
            if (noCodeChanges) {
                comment += '\nℹ️ _Test code unchanged from previous run._\n';
            }
            comment += '\nCI is running on the PR — results will be posted automatically.\n';

            if (jiraComment) {
                comment += '\n---\n\n' + jiraComment;
            }

            jira_post_comment({ key: ticketKey, comment: comment });
            console.log('✅ Posted Jira comment');
        } catch (e) {
            console.warn('Failed to post Jira comment:', e);
        }

        // Step 5: Move to CI Pending
        try {
            jira_move_to_status({ key: ticketKey, statusName: STATUSES.CI_PENDING });
            console.log('✅ Moved', ticketKey, 'to', STATUSES.CI_PENDING);
        } catch (e) {
            console.warn('Failed to move to CI Pending:', e);
        }

        // Step 6: Remove WIP label
        var wipLabel = params.metadata && params.metadata.contextId
            ? params.metadata.contextId + '_wip'
            : 'new_test_case_automation_wip';
        try { jira_remove_label({ key: ticketKey, label: wipLabel }); } catch (e) {}

        // Step 7: Remove SM trigger label
        try { jira_remove_label({ key: ticketKey, label: LABELS.NEW_SM_TEST_AUTOMATION }); } catch (e) {}

        // Step 8: Add AI test automation label
        try { jira_add_label({ key: ticketKey, label: LABELS.AI_TEST_AUTOMATION }); } catch (e) {}

        console.log('✅ New test automation complete — CI Pending, PR:', prUrl || 'none');

        return {
            success: true,
            status: 'ci_pending',
            ticketKey: ticketKey,
            prUrl: prUrl,
            branchName: branchName
        };

    } catch (error) {
        console.error('❌ Error in new postTestAutomationResults:', error);
        try {
            jira_post_comment({
                key: params.ticket.key,
                comment: 'h3. ❌ Test Automation Error\n\n{code}' + error.toString() + '{code}'
            });
        } catch (e) {}
        return { success: false, error: error.toString() };
    }
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { action };
}
