/**
 * Check CI For Test Cases (JSRunner)
 *
 * For test cases in "CI Pending" status: find the associated test PR,
 * check CI check runs on the head commit, and move the ticket accordingly:
 *   - CI passed → "In Review - Passed" (pr_test_automation_review then reviews,
 *     adds pr_approved, and SM merges the test PR → Done)
 *   - CI failed → "In Rework"
 *   - PR already merged → "Done"
 *
 * Do NOT move green CI straight to "Passed": no SM rule reads that status,
 * so the test PR would never be reviewed or merged.
 */

function hasAnyLabel(labels, names) {
    for (var i = 0; i < names.length; i++) {
        if (labels.indexOf(names[i]) !== -1) return true;
    }
    return false;
}

/**
 * Resolve the target repo for a Test Case.
 * Order: own repo labels → labels inherited from a linked Story/Bug → null.
 * Mirrors getTargetRepo() in retryMergePR.js, but returns null instead of
 * defaulting: a wrong default (ms_front) once moved green-CI tickets whose
 * PR lived on ms_back to In Rework ("No Test PR Found"). null makes the
 * caller probe both repos.
 */
function detectTargetRepo(ticket) {
    var labels = ((ticket.fields && ticket.fields.labels) || []).map(function(l) {
        return String(l).toLowerCase();
    });

    if (hasAnyLabel(labels, ['frontend', 'ui', 'react'])) return 'ms_front';
    if (hasAnyLabel(labels, ['backend', 'api', 'go'])) return 'ms_back';

    // Label propagation (moveToInTesting.js) may have missed — inherit from parent
    if (ticket.fields && ticket.fields.issuelinks) {
        for (var i = 0; i < ticket.fields.issuelinks.length; i++) {
            var link = ticket.fields.issuelinks[i];
            var linkedIssue = link.outwardIssue || link.inwardIssue;
            if (!linkedIssue || !linkedIssue.key) continue;
            var linkedType = (linkedIssue.fields && linkedIssue.fields.issuetype && linkedIssue.fields.issuetype.name) || '';
            if (linkedType !== 'Story' && linkedType !== 'Bug') continue;
            try {
                var parent = jira_get_ticket(linkedIssue.key);
                if (typeof parent === 'string') parent = JSON.parse(parent);
                var parentLabels = ((parent.fields && parent.fields.labels) || []).map(function(l) {
                    return String(l).toLowerCase();
                });
                if (hasAnyLabel(parentLabels, ['frontend', 'ui', 'react'])) return 'ms_front';
                if (hasAnyLabel(parentLabels, ['backend', 'api', 'go'])) return 'ms_back';
            } catch (e) {
                console.warn('  ⚠️ Could not fetch linked issue ' + linkedIssue.key + ' for repo detection: ' + (e.message || e));
            }
        }
    }

    return null;
}

/**
 * Look for the test PR in one repo.
 * Returns { pr, merged:true } | { pr } (open) | { pr, closedUnmerged:true } | null.
 */
function findTestPRInRepo(repo, branchName) {
    var openPRs = github_list_prs({ workspace: 'holodog', repository: repo, state: 'open' }) || [];
    for (var i = 0; i < openPRs.length; i++) {
        if (openPRs[i].head && openPRs[i].head.ref === branchName) {
            return { pr: openPRs[i] };
        }
    }
    var closedPRs = github_list_prs({ workspace: 'holodog', repository: repo, state: 'closed' }) || [];
    for (var j = 0; j < closedPRs.length; j++) {
        if (closedPRs[j].head && closedPRs[j].head.ref === branchName) {
            if (closedPRs[j].merged_at) return { pr: closedPRs[j], merged: true };
            return { pr: closedPRs[j], closedUnmerged: true };
        }
    }
    return null;
}

function action(params) {
    var ticket = params.ticket;
    var ticketKey = ticket && ticket.key ? ticket.key : null;
    if (!ticketKey) {
        console.error('  ❌ No ticket key');
        return { success: false, error: 'No ticket key' };
    }

    console.log('CI Check for Test Case: ' + ticketKey);

    // Target repo from labels propagated from the parent Story/Bug
    // (moveToInTesting.js copies frontend/backend/api/go/ui/react labels onto Test Cases),
    // with inheritance from the linked parent as fallback.
    var detectedRepo = detectTargetRepo(ticket);
    var candidateRepos = detectedRepo ? [detectedRepo] : ['ms_back', 'ms_front'];
    console.log(detectedRepo
        ? 'Target repo: ' + detectedRepo
        : 'Target repo: unknown (no repo labels on ticket or parent) — probing ms_back then ms_front');

    // Find PR on test/{KEY} branch
    var branchName = 'test/' + ticketKey;
    var prInfo = null;
    var prRepo = null;

    try {
        for (var r = 0; r < candidateRepos.length && !prInfo; r++) {
            var repo = candidateRepos[r];
            var found = findTestPRInRepo(repo, branchName);
            if (!found) continue;

            if (found.merged) {
                // Already merged — test code is on master, ticket is terminal
                jira_move_to_status({ key: ticketKey, statusName: 'Done' });
                jira_post_comment({
                    key: ticketKey,
                    comment: 'h3. ✅ CI Check — PR Already Merged\n\nTest PR for branch ' + branchName + ' was already merged. Moved to *Done*.'
                });
                console.log('  ✅ PR already merged → Done');
                return { success: true, action: 'done_already_merged' };
            }

            // Closed-unmerged PR is not a live PR — keep probing other repos
            if (!found.closedUnmerged) {
                prInfo = found.pr;
                prRepo = repo;
                if (!detectedRepo) {
                    console.log('  ℹ️ PR found on fallback repo: ' + repo);
                }
            }
        }
    } catch (e) {
        console.warn('  ⚠️ PR search failed: ' + (e.message || e));
        return { success: false, error: 'PR search failed: ' + (e.message || e) };
    }

    if (!prInfo) {
        // No PR found in any repo — needs re-automation
        jira_move_to_status({ key: ticketKey, statusName: 'In Rework' });
        jira_post_comment({
            key: ticketKey,
            comment: 'h3. ⚠️ CI Check — No Test PR Found\n\nNo test PR found for branch ' + branchName + ' (searched ' + candidateRepos.join(' and ') + '). Ticket needs re-automation. Moved to *In Rework*.'
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
            repository: prRepo,
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

        // All checks passed → hand to the review + merge track
        // (pr_test_automation_review → pr_approved → retry_merge_test merges → Done)
        jira_move_to_status({ key: ticketKey, statusName: 'In Review - Passed' });
        jira_post_comment({
            key: ticketKey,
            comment: 'h3. ✅ CI Check Passed\n\nAll ' + completed.length + ' checks passed.\n\nPR: [PR #' + prInfo.number + '|' + prInfo.html_url + ']\n\nMoved to *In Review - Passed* — automated review and merge follow.'
        });
        console.log('  ✅ All ' + completed.length + ' checks passed → In Review - Passed');
        return { success: true, action: 'passed' };

    } catch (e) {
        console.error('  ❌ CI check failed: ' + (e.message || e));
        return { success: false, error: 'CI check failed: ' + (e.message || e) };
    }
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { action: action };
}
