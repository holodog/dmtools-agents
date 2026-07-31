/**
 * Post Test Rework Results — postJSAction for pr_test_automation_rework.
 *
 * Write-only flow (mirrors postTestAutomationWriteOnly.js): the agent only
 * edits test code + writes outputs/response.md + outputs/pr_body.md.
 * This action:
 *   1. Stages the changes, commits, pushes to the existing test/{KEY} branch
 *      (push triggers CI on the open test PR)
 *   2. Posts outputs/pr_body.md as a PR comment
 *   3. Moves the ticket to CI Pending (new_test_ci_check resolves the verdict)
 *   4. ALWAYS removes sm_test_rework_triggered (customParams.removeLabel
 *      contract) so the SM can re-dispatch if CI fails again
 *   5. On failure: comment + label removed → automatic retry next SM cycle
 */

const gh = require('./common/githubHelpers.js');
const { GIT_CONFIG, STATUSES } = require('./config.js');

const REWORK_LABEL = 'sm_test_rework_triggered';

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

function stripReworkLabel(ticketKey) {
    try {
        jira_remove_label({ key: ticketKey, label: REWORK_LABEL });
    } catch (e) {}
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

    function failWithComment(reason) {
        console.error('❌ Rework post-processing failed: ' + reason);
        // Label removed regardless → SM re-dispatches rework next cycle
        stripReworkLabel(ticketKey);
        try {
            jira_post_comment({
                key: ticketKey,
                comment: 'h3. ⚠️ Test Rework Post-Processing Failed\n\n' + reason +
                    '\n\nRework will be re-dispatched automatically next SM cycle.'
            });
        } catch (e) {}
        return { success: false, error: reason, action: 'retry_scheduled' };
    }

    try {
        console.log('=== Test rework post-processing (write-only flow):', ticketKey, '===');

        var response = readFile('outputs/response.md');
        if (!response) {
            return failWithComment('outputs/response.md is missing or empty — the agent did not complete the output contract.');
        }
        var prBody = readFile('outputs/pr_body.md') || response;

        var repoInfo = gh.getGitHubRepoInfo();
        if (!repoInfo) {
            return failWithComment('Could not determine the GitHub repository from the git remote.');
        }

        // 1. Stage; commit + push only when something changed
        run('git add .');
        var statusOut = run('git status --porcelain');
        var pushed = false;
        if (statusOut) {
            run('git config user.name "' + GIT_CONFIG.AUTHOR_NAME + '"');
            run('git config user.email "' + GIT_CONFIG.AUTHOR_EMAIL + '"');
            run('git commit -m "test(' + ticketKey + '): fix test (rework)"');
            var pushOut = run('git push origin ' + branchName);
            if (pushOut.indexOf('rejected') !== -1 || pushOut.indexOf('fatal') !== -1) {
                return failWithComment('git push failed: ' + pushOut.slice(0, 400));
            }
            pushed = true;
            console.log('✅ Pushed fixes to', branchName);
        } else {
            console.log('ℹ️ No file changes — CI will re-verify the current code');
        }

        // 2. PR comment with the rework summary
        var pr = null;
        try {
            pr = gh.findPRForTicket(repoInfo.owner, repoInfo.repo, ticketKey);
        } catch (e) {
            console.warn('PR lookup failed:', e);
        }
        if (pr && pr.number) {
            try {
                file_write({ path: 'outputs/rework_comment.md', content: prBody });
                run('gh pr comment ' + pr.number + ' --body-file "outputs/rework_comment.md"');
            } catch (e) {
                console.warn('PR comment failed (non-fatal):', e);
            }
        }

        // 3. Hand off to the CI verdict loop (push already re-triggered CI;
        //    no-change case re-verifies the existing commit)
        jira_move_to_status({ key: ticketKey, statusName: STATUSES.CI_PENDING });
        stripReworkLabel(ticketKey);
        try {
            jira_post_comment({
                key: ticketKey,
                comment: 'h3. 🔧 Rework Pushed\n\n' +
                    (pushed ? 'Fixes pushed to `' + branchName + '` — CI re-running on the test PR.\n\n' : 'No code changes — CI re-verifying the current commit.\n\n') +
                    'Verdict resolves automatically (*CI Pending* → *Passed* or back to *In Rework*).'
            });
        } catch (e) {}

        console.log('✅ ' + ticketKey + ' → CI Pending');
        return { success: true, action: 'ci_pending', pushed: pushed };

    } catch (error) {
        return failWithComment('Post-processing exception: ' + error.toString());
    }
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { action: action };
}
