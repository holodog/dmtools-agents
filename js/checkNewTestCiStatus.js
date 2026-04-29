/**
 * Check New Test CI Status (localExecution for new CI-based test automation)
 *
 * For each Test Case in "CI Pending" status:
 * 1. Find open PR on test/{KEY} branch
 * 2. Check PR head commit CI status via github_get_commit_check_runs
 * 3. Handle outcomes:
 *    - Still pending/in_progress → skip (check next SM Agent cycle)
 *    - All passed → add pr_approved label → SM Agent merges via retry_merge_test
 *    - Failed → write ci_failures.md → add new_ci_retry label → move to In Rework
 * 4. Remove ci_check_triggered label
 * 5. Post Jira comment with CI result
 */

const { GIT_CONFIG, STATUSES, LABELS } = require('./config.js');
const gh = require('./common/githubHelpers.js');

function cleanCommandOutput(output) {
    if (!output) return '';
    return output.split('\n').filter(function(line) {
        return line.indexOf('Script started') === -1 &&
               line.indexOf('Script done') === -1 &&
               line.indexOf('COMMAND=') === -1 &&
               line.indexOf('COMMAND_EXIT_CODE=') === -1;
    }).join('\n').trim();
}

function getGitHubRepoInfo() {
    try {
        var remoteUrl = cleanCommandOutput(
            cli_execute_command({ command: 'git config --get remote.origin.url' }) || ''
        );
        var match = remoteUrl.match(/github\.com[:/]([^/]+)\/([^/.]+)/);
        if (!match) return null;
        return { owner: match[1], repo: match[2].replace('.git', '') };
    } catch (e) {
        return null;
    }
}

function findOpenPRForBranch(owner, repo, branchName) {
    try {
        var openPRs = github_list_prs({ workspace: owner, repository: repo, state: 'open' });
        var match = openPRs.filter(function(pr) {
            return pr.head && pr.head.ref && pr.head.ref === branchName;
        });
        return match.length > 0 ? match[0] : null;
    } catch (e) {
        console.warn('Failed to list PRs:', e.message || e);
        return null;
    }
}

/**
 * Get PR check runs status for a commit SHA.
 * Returns { total, pending, passed, failed, checks: [] }
 */
function getCIStatus(owner, repo, commitSha) {
    try {
        var rawResult = github_get_commit_check_runs({
            workspace: owner,
            repository: repo,
            commitSha: commitSha
        });

        if (typeof rawResult === 'string') {
            try { rawResult = JSON.parse(rawResult); } catch (e) {}
        }

        var checkRuns = Array.isArray(rawResult) ? rawResult
            : (rawResult && rawResult.check_runs ? rawResult.check_runs : []);

        if (!checkRuns || !checkRuns.length) {
            console.log('No CI checks found for commit');
            return { total: 0, pending: 0, passed: 0, failed: 0, checks: [] };
        }

        var pending = checkRuns.filter(function(c) {
            return !c.conclusion || c.conclusion === 'in_progress' || c.conclusion === 'queued';
        });
        var passed = checkRuns.filter(function(c) {
            return c.conclusion === 'success';
        });
        var failed = checkRuns.filter(function(c) {
            return c.conclusion === 'failure' || c.conclusion === 'timed_out' || c.conclusion === 'cancelled';
        });

        return {
            total: checkRuns.length,
            pending: pending.length,
            passed: passed.length,
            failed: failed.length,
            checks: checkRuns
        };
    } catch (e) {
        console.warn('Failed to get CI status:', e.message || e);
        return null;
    }
}

function action(params) {
    try {
        var actualParams = params.ticket ? params : (params.jobParams || params);
        var ticket = actualParams.ticket;
        var ticketKey = ticket.key;

        console.log('=== Checking CI status for', ticketKey, '===');

        // Remove the ci_check_triggered label
        try { jira_remove_label({ key: ticketKey, label: LABELS.NEW_SM_CI_CHECK }); } catch (e) {}

        // Get full ticket for labels
        var fullTicket;
        try {
            var ticketRaw = jira_get_ticket(ticketKey);
            fullTicket = (typeof ticketRaw === 'string') ? JSON.parse(ticketRaw) : ticketRaw;
        } catch (e) {
            console.error('Failed to fetch ticket:', e);
            return { success: false, error: 'Failed to fetch ticket' };
        }

        // Get GitHub repo info from ticket labels
        var labels = (fullTicket.fields && fullTicket.fields.labels) ? fullTicket.fields.labels : [];
        var targetRepo = 'root';
        if (labels.indexOf('frontend') !== -1 || labels.indexOf('ui') !== -1 || labels.indexOf('react') !== -1) {
            targetRepo = 'frontend';
        } else if (labels.indexOf('backend') !== -1 || labels.indexOf('api') !== -1 || labels.indexOf('go') !== -1) {
            targetRepo = 'backend';
        }

        // For Test Cases, inherit from linked story if no repo label
        if (targetRepo === 'root') {
            var issueType = (fullTicket.fields && fullTicket.fields.issuetype && fullTicket.fields.issuetype.name) || '';
            if (issueType === 'Test Case' && fullTicket.fields && fullTicket.fields.issuelinks) {
                for (var i = 0; i < fullTicket.fields.issuelinks.length; i++) {
                    var link = fullTicket.fields.issuelinks[i];
                    var linkedIssue = link.outwardIssue || link.inwardIssue;
                    if (linkedIssue && linkedIssue.key) {
                        var linkedType = (linkedIssue.fields && linkedIssue.fields.issuetype && linkedIssue.fields.issuetype.name) || '';
                        if (linkedType === 'Story' || linkedType === 'Bug') {
                            try {
                                var parentTicket = jira_get_ticket(linkedIssue.key);
                                if (typeof parentTicket === 'string') parentTicket = JSON.parse(parentTicket);
                                var parentLabels = (parentTicket.fields && parentTicket.fields.labels) || [];
                                if (parentLabels.indexOf('frontend') !== -1 || parentLabels.indexOf('ui') !== -1 || parentLabels.indexOf('react') !== -1) {
                                    targetRepo = 'frontend';
                                } else if (parentLabels.indexOf('backend') !== -1 || parentLabels.indexOf('api') !== -1 || parentLabels.indexOf('go') !== -1) {
                                    targetRepo = 'backend';
                                }
                            } catch (e) {
                                console.warn('Could not fetch parent ticket:', e);
                            }
                        }
                    }
                }
            }
        }

        var owner, repo;
        if (targetRepo === 'frontend') {
            owner = 'holodog'; repo = 'ms_front';
        } else if (targetRepo === 'backend') {
            owner = 'holodog'; repo = 'ms_back';
        } else {
            owner = 'holodog'; repo = 'ms_root';
        }

        console.log('Target repo:', owner + '/' + repo);

        // Find open PR on test/{KEY} branch
        var branchName = 'test/' + ticketKey;
        var pr = findOpenPRForBranch(owner, repo, branchName);

        if (!pr) {
            console.warn('No open PR found for branch', branchName);
            jira_post_comment({
                key: ticketKey,
                comment: 'h3. ⚠️ CI Status Check — No PR Found\n\nNo open PR found for branch {code}' + branchName + '{code}.\n\nPlease check if test code was pushed correctly.'
            });
            return { success: true, action: 'no_pr', ticketKey: ticketKey };
        }

        console.log('Found PR #' + pr.number);

        // Get PR details to get head SHA
        var prDetails;
        try {
            prDetails = github_get_pr({
                workspace: owner,
                repository: repo,
                pullRequestId: String(pr.number)
            });
        } catch (e) {
            console.error('Failed to get PR details:', e);
            return { success: false, error: 'Failed to get PR details' };
        }

        var headSha = prDetails.head && prDetails.head.sha;
        if (!headSha) {
            console.warn('No head SHA in PR details');
            return { success: true, action: 'no_sha', ticketKey: ticketKey };
        }

        console.log('PR head SHA:', headSha.substring(0, 8));

        // Get CI status
        var ciStatus = getCIStatus(owner, repo, headSha);

        if (!ciStatus) {
            console.warn('Failed to get CI status, skipping');
            return { success: true, action: 'check_failed', ticketKey: ticketKey };
        }

        console.log('CI status:', JSON.stringify({
            total: ciStatus.total,
            pending: ciStatus.pending,
            passed: ciStatus.passed,
            failed: ciStatus.failed
        }));

        // Handle outcomes
        if (ciStatus.pending > 0 && ciStatus.failed === 0) {
            // CI still running — skip, check next cycle
            console.log('CI still in progress, skipping');
            jira_post_comment({
                key: ticketKey,
                comment: 'h3. CI Still Running\n\nPR #' + prDetails.number + ' CI checks are still in progress.\n' +
                    ciStatus.pending + ' check(s) pending, ' + ciStatus.passed + ' passed so far.\n\n' +
                    '_Will check again on next SM Agent cycle._'
            });
            return { success: true, action: 'pending', ticketKey: ticketKey };
        }

        if (ciStatus.failed === 0 && ciStatus.passed > 0) {
            // All passed — add pr_approved label, move to In Review - Passed → SM Agent will merge
            console.log('All CI checks passed — approving');
            try {
                jira_add_label({ key: ticketKey, label: LABELS.PR_APPROVED });
                console.log('✅ Added pr_approved label');
            } catch (e) {
                console.warn('Failed to add pr_approved label:', e);
            }

            try {
                jira_move_to_status({ key: ticketKey, statusName: STATUSES.IN_REVIEW_PASSED });
                console.log('✅ Moved to In Review - Passed');
            } catch (e) {
                console.warn('Failed to move to In Review - Passed:', e);
            }

            jira_post_comment({
                key: ticketKey,
                comment: 'h3. ✅ CI Passed — PR Approved\n\n' +
                    'All ' + ciStatus.passed + ' CI check(s) passed on PR #' + prDetails.number + '.\n\n' +
                    '*Pull Request*: ' + prDetails.html_url + '\n\n' +
                    'SM Agent will merge this PR on next cycle.'
            });
            return { success: true, action: 'approved', ticketKey: ticketKey };
        }

        if (ciStatus.failed > 0) {
            // CI failed — write ci_failures.md, move to In Rework, add retry label
            console.log('CI failed — triggering rework');

            // Use detectFailedChecks from githubHelpers to write ci_failures.md to a temp location
            // Since this is a local execution (no repo cloned), we can't use detectFailedChecks directly
            // Instead, we fetch logs manually and write them

            var md = '# ⚠️ CI Check(s) Failed — Fix Test\n\n';
            md += ciStatus.failed + ' check(s) failed on PR #' + prDetails.number + ' (commit `' + headSha.substring(0, 8) + '`):\n\n';

            var failedCheckDetails = ciStatus.checks.filter(function(c) {
                return c.conclusion === 'failure' || c.conclusion === 'timed_out' || c.conclusion === 'cancelled';
            });

            failedCheckDetails.forEach(function(check) {
                md += '## ❌ ' + check.name + '\n\n';
                md += '- **Conclusion**: ' + check.conclusion + '\n';
                if (check.details_url) {
                    md += '- **Details**: ' + check.details_url + '\n';
                }
                md += '\n';

                // Try to fetch job logs
                var jobIdMatch = check.details_url && check.details_url.match(/\/jobs?\/(\d+)/);
                if (jobIdMatch) {
                    try {
                        var rawLogs = github_get_job_logs({
                            workspace: owner,
                            repository: repo,
                            jobId: jobIdMatch[1]
                        });
                        var logs = rawLogs;
                        if (typeof rawLogs === 'string') {
                            try {
                                var parsed = JSON.parse(rawLogs);
                                if (parsed && parsed.result) logs = parsed.result;
                            } catch (e) {}
                        }
                        if (logs) {
                            var lines = logs.split('\n');
                            var snippet = lines.slice(-150).join('\n');
                            md += '**Error log (last 150 lines)**:\n\n```\n' + snippet + '\n```\n\n';
                        }
                    } catch (e) {
                        console.warn('Could not fetch logs for job', jobIdMatch[1], ':', e.message || e);
                    }
                }
            });

            md += '---\n\n## Resolution\n\n';
            md += '1. Fix the test based on the CI error logs above\n';
            md += '2. Push the fix to branch `' + branchName + '`\n';
            md += '3. CI will re-run automatically\n';

            jira_post_comment({
                key: ticketKey,
                comment: 'h3. ❌ CI Failed — Rework Needed\n\n' +
                    ciStatus.failed + ' CI check(s) failed on PR #' + prDetails.number + '.\n\n' +
                    'Details will be written to ci_failures.md when rework agent starts.\n\n' +
                    '*Pull Request*: ' + prDetails.html_url
            });

            // Add retry label and move to In Rework
            try {
                jira_add_label({ key: ticketKey, label: LABELS.NEW_CI_RETRY });
                console.log('✅ Added new_ci_retry label');
            } catch (e) {
                console.warn('Failed to add new_ci_retry label:', e);
            }

            try {
                jira_move_to_status({ key: ticketKey, statusName: STATUSES.IN_REWORK });
                console.log('✅ Moved to In Rework');
            } catch (e) {
                console.warn('Failed to move to In Rework:', e);
            }

            return { success: true, action: 'rework', ticketKey: ticketKey };
        }

        // Fallback — CI checks exist but status unclear
        console.log('Unclear CI status, skipping');
        jira_post_comment({
            key: ticketKey,
            comment: 'h3. CI Status Unclear\n\n' +
                ciStatus.total + ' checks found: ' + ciStatus.passed + ' passed, ' + ciStatus.failed + ' failed, ' + ciStatus.pending + ' pending.\n\n' +
                '_Manual review recommended._'
        });

        return { success: true, action: 'unclear', ticketKey: ticketKey };

    } catch (error) {
        console.error('❌ Error in checkNewTestCiStatus:', error);
        try {
            var key = (params.ticket || (params.jobParams && params.jobParams.ticket) || {}).key;
            if (key) {
                jira_post_comment({
                    key: key,
                    comment: 'h3. ❌ CI Status Check Error\n\n{code}' + error.toString() + '{code}'
                });
            }
        } catch (e) {}
        return { success: false, error: error.toString() };
    }
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { action };
}
