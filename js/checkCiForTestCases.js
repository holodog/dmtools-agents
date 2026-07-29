/**
 * Check CI For Test Cases (JSRunner)
 *
 * For test cases in "CI Pending" status: find the associated test PR,
 * check CI check runs on the head commit, and move the ticket accordingly:
 *   - CI passed → "Passed"
 *   - CI failed → "In Rework"
 */

function action(params) {
    var ticket = params.ticket;
    var ticketKey = ticket && ticket.key ? ticket.key : null;
    if (!ticketKey) {
        console.error('  ❌ No ticket key');
        return { success: false, error: 'No ticket key' };
    }

    console.log('CI Check for Test Case: ' + ticketKey);

    // Target repo from labels propagated from the parent Story/Bug
    // (moveToInTesting.js copies frontend/backend/api/go/ui/react labels onto Test Cases)
    var labels = (ticket.fields && ticket.fields.labels) || [];
    var isBackend = labels.indexOf('backend') !== -1 ||
                    labels.indexOf('api') !== -1 ||
                    labels.indexOf('go') !== -1;
    var REPO = isBackend ? 'ms_back' : 'ms_front';
    console.log('Target repo: ' + REPO);

    // Find PR on test/{KEY} branch
    var branchName = 'test/' + ticketKey;
    var prInfo = null;

    try {
        var openPRs = github_list_prs({ workspace: 'holodog', repository: REPO, state: 'open' }) || [];
        for (var i = 0; i < openPRs.length; i++) {
            if (openPRs[i].head && openPRs[i].head.ref === branchName) {
                prInfo = openPRs[i];
                break;
            }
        }

        if (!prInfo) {
            var closedPRs = github_list_prs({ workspace: 'holodog', repository: REPO, state: 'closed' }) || [];
            for (var i = 0; i < closedPRs.length; i++) {
                if (closedPRs[i].head && closedPRs[i].head.ref === branchName && closedPRs[i].merged_at) {
                    // Already merged — CI must have passed
                    jira_move_to_status({ key: ticketKey, statusName: 'Passed' });
                    jira_post_comment({
                        key: ticketKey,
                        comment: 'h3. ✅ CI Check — PR Already Merged\n\nTest PR for branch ' + branchName + ' was already merged. CI verified. Moved to *Passed*.'
                    });
                    console.log('  ✅ PR already merged → Passed');
                    return { success: true, action: 'passed_already_merged' };
                }
            }
        }
    } catch (e) {
        console.warn('  ⚠️ PR search failed: ' + (e.message || e));
        return { success: false, error: 'PR search failed: ' + (e.message || e) };
    }

    if (!prInfo) {
        // No PR found at all — needs re-automation
        jira_move_to_status({ key: ticketKey, statusName: 'In Rework' });
        jira_post_comment({
            key: ticketKey,
            comment: 'h3. ⚠️ CI Check — No Test PR Found\n\nNo test PR found for branch ' + branchName + '. Ticket needs re-automation. Moved to *In Rework*.'
        });
        console.log('  ⚠️ No PR found → In Rework');
        return { success: true, action: 'rework_no_pr' };
    }

    // Check CI status on head commit
    var headSha = prInfo.head && prInfo.head.sha;
    if (!headSha) {
        console.warn('  ⚠️ No head SHA for PR #' + prInfo.number);
        return { success: false, error: 'No head SHA' };
    }

    try {
        var rawResult = github_get_commit_check_runs({
            workspace: 'holodog',
            repository: REPO,
            commitSha: headSha
        });

        if (typeof rawResult === 'string') {
            try { rawResult = JSON.parse(rawResult); } catch (e) {}
        }

        var checkRuns = Array.isArray(rawResult) ? rawResult
            : (rawResult && rawResult.check_runs ? rawResult.check_runs : []);

        if (!checkRuns || checkRuns.length === 0) {
            console.log('  ⏳ No CI checks found — waiting');
            return { success: true, action: 'waiting_no_checks' };
        }

        var completed = checkRuns.filter(function(c) {
            return c.status === 'completed';
        });

        var stillRunning = checkRuns.filter(function(c) {
            return c.status !== 'completed' && c.status !== 'queued';
        });

        if (stillRunning.length > 0 || completed.length < checkRuns.length) {
            console.log('  ⏳ CI still in progress — waiting');
            return { success: true, action: 'waiting_in_progress' };
        }

        var failed = completed.filter(function(c) {
            return c.conclusion === 'failure' || c.conclusion === 'timed_out' || c.conclusion === 'cancelled';
        });

        if (failed.length > 0) {
            jira_move_to_status({ key: ticketKey, statusName: 'In Rework' });
            var failNames = failed.map(function(c) { return c.name; }).join(', ');
            jira_post_comment({
                key: ticketKey,
                comment: 'h3. ❌ CI Check Failed\n\nFailed checks: ' + failNames + '\n\nPR: [PR #' + prInfo.number + '|' + prInfo.html_url + ']\n\nMoved to *In Rework*.'
            });
            console.log('  ❌ ' + failed.length + ' check(s) failed → In Rework');
            return { success: true, action: 'failed', failedChecks: failNames };
        }

        // All checks passed
        jira_move_to_status({ key: ticketKey, statusName: 'Passed' });
        jira_post_comment({
            key: ticketKey,
            comment: 'h3. ✅ CI Check Passed\n\nAll ' + completed.length + ' checks passed.\n\nPR: [PR #' + prInfo.number + '|' + prInfo.html_url + ']\n\nMoved to *Passed*.'
        });
        console.log('  ✅ All ' + completed.length + ' checks passed → Passed');
        return { success: true, action: 'passed' };

    } catch (e) {
        console.error('  ❌ CI check failed: ' + (e.message || e));
        return { success: false, error: 'CI check failed: ' + (e.message || e) };
    }
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { action: action };
}
