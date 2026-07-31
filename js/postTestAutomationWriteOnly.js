/**
 * Post Test Automation (Write-Only Flow) — postJSAction for test_case_automation.
 *
 * The agent only WRITES test code + outputs/response.md + outputs/pr_body.md
 * (no test execution, no git — CI runs the tests after the PR is created).
 * This action:
 *   1. Stages everything, commits, pushes the test/{KEY} branch
 *   2. Opens a PR (body from outputs/pr_body.md, fallback outputs/response.md)
 *   3. Moves the ticket to CI Pending — new_test_ci_check resolves the verdict
 *      (CI passed → Passed, CI failed → In Rework)
 *   4. On failure: returns the ticket to Backlog and strips the SM trigger
 *      label so the next SM cycle re-dispatches (self-heal, no stuck tickets)
 */

const gh = require('./common/githubHelpers.js');
const { GIT_CONFIG, STATUSES } = require('./config.js');

const SM_TRIGGER_LABEL = 'sm_test_automation_triggered';

function clean(output) {
    return gh.cleanCommandOutput(output || '');
}

function run(command) {
    return clean(cli_execute_command({ command: command }));
}

function readFile(path) {
    try {
        const content = file_read({ path: path });
        return (content && content.trim()) ? content : null;
    } catch (e) {
        return null;
    }
}

function action(params) {
    var ticket = params.ticket || {};
    var ticketKey = ticket.key;
    if (!ticketKey && params.inputFolderPath) {
        ticketKey = params.inputFolderPath.split('/').pop();
    }
    if (!ticketKey) {
        console.error('❌ No ticket key');
        return { success: false, error: 'No ticket key' };
    }

    var branchName = 'test/' + ticketKey;
    var summary = (ticket.fields && ticket.fields.summary) || ticketKey;

    function selfHealRetry(reason) {
        console.error('❌ Post-processing failed: ' + reason);
        try {
            jira_move_to_status({ key: ticketKey, statusName: 'Backlog' });
        } catch (e) {
            console.warn('Backlog move failed:', e);
        }
        try {
            jira_remove_label({ key: ticketKey, label: SM_TRIGGER_LABEL });
        } catch (e) {}
        // Verify the move landed (jira_move_to_status can silently no-op on
        // invalid transitions) — flag for humans if the ticket is still stuck
        var moved = false;
        try {
            var raw = jira_get_ticket(ticketKey);
            var current = (typeof raw === 'string') ? JSON.parse(raw) : raw;
            moved = current && current.fields && current.fields.status &&
                    current.fields.status.name === 'Backlog';
        } catch (e) {}
        try {
            jira_post_comment({
                key: ticketKey,
                comment: 'h3. ⚠️ Test Automation Post-Processing Failed\n\n' + reason + '\n\n' +
                    (moved
                        ? 'Ticket returned to *Backlog* — the SM will re-dispatch automation next cycle.'
                        : 'Could not move ticket to Backlog automatically — *manual re-dispatch required* ' +
                          '(move to Backlog and remove the `' + SM_TRIGGER_LABEL + '` label).')
            });
        } catch (e) {}
        return { success: false, error: reason, action: moved ? 'retry_scheduled' : 'manual_attention' };
    }

    try {
        console.log('=== Test automation post-processing (write-only flow):', ticketKey, '===');

        var response = readFile('outputs/response.md');
        if (!response) {
            return selfHealRetry('outputs/response.md is missing or empty — the agent did not complete the output contract.');
        }
        var prBody = readFile('outputs/pr_body.md') || response;

        var repoInfo = gh.getGitHubRepoInfo();
        if (!repoInfo) {
            return selfHealRetry('Could not determine the GitHub repository from the git remote.');
        }

        // 1. Stage and check the agent actually wrote test code
        run('git add .');
        var statusOut = run('git status --porcelain');
        if (!statusOut) {
            return selfHealRetry('No files were written by the agent — nothing to commit.');
        }

        // 2. Commit
        run('git config user.name "' + GIT_CONFIG.AUTHOR_NAME + '"');
        run('git config user.email "' + GIT_CONFIG.AUTHOR_EMAIL + '"');
        var commitOut = run('git commit -m "test(' + ticketKey + '): automate test case"');
        console.log('Commit:', commitOut.split('\n')[0]);

        // 3. Push
        var pushOut = run('git push -u origin ' + branchName);
        if (pushOut.indexOf('rejected') !== -1 || pushOut.indexOf('fatal') !== -1) {
            return selfHealRetry('git push failed: ' + pushOut.slice(0, 400));
        }
        console.log('✅ Pushed', branchName);

        // 4. PR — reuse an existing one on this branch (idempotent on retries).
        //    Exact branch match — title-substring matching could reuse an
        //    unrelated feature PR that merely mentions the ticket key.
        var prUrl = null;
        var prNote = '';
        var existing = null;
        try {
            var openPRs = github_list_prs({ workspace: repoInfo.owner, repository: repoInfo.repo, state: 'open' }) || [];
            var branchMatches = openPRs.filter(function(p) {
                return p.head && p.head.ref === branchName;
            });
            existing = branchMatches.length > 0 ? branchMatches[0] : null;
        } catch (e) {
            console.warn('PR lookup failed (will try to create):', e);
        }
        if (existing && existing.html_url) {
            prUrl = existing.html_url;
            prNote = ' (existing PR)';
        } else {
            try {
                file_write({ path: 'outputs/pr_body_final.md', content: prBody });
            } catch (e) {
                return selfHealRetry('Could not write PR body file: ' + (e.message || e));
            }
            var escapedTitle = (ticketKey + ' ' + summary).replace(/"/g, '\\"');
            var prOut = run('gh pr create --title "' + escapedTitle + '"' +
                ' --body-file "outputs/pr_body_final.md"' +
                ' --base ' + GIT_CONFIG.DEFAULT_BASE_BRANCH +
                ' --head ' + branchName);
            var m = prOut.match(/https:\/\/github\.com\/[^\s]+\/pull\/\d+/);
            if (!m) {
                return selfHealRetry('gh pr create failed: ' + prOut.slice(0, 400));
            }
            prUrl = m[0];
        }
        console.log('✅ PR' + prNote + ':', prUrl);

        // 5. Hand off to the CI verdict loop
        jira_move_to_status({ key: ticketKey, statusName: STATUSES.CI_PENDING });
        try {
            jira_post_comment({
                key: ticketKey,
                comment: 'h3. 🚀 Test PR Created\n\n' +
                    'PR' + prNote + ': [' + prUrl + '|' + prUrl + ']\n\n' +
                    'Tests run in CI on the PR; the result is resolved automatically ' +
                    '(*CI Pending* → *Passed* or *In Rework*).'
            });
        } catch (e) {}

        console.log('✅ ' + ticketKey + ' → CI Pending');
        return { success: true, action: 'ci_pending', prUrl: prUrl };

    } catch (error) {
        return selfHealRetry('Post-processing exception: ' + error.toString());
    }
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { action: action };
}
