/**
 * Post PR Review Comments Action
 * PostJSAction that:
 * 1. Reads outputs/pr_review.json with structured review data
 * 2. Posts general review comment to GitHub PR using github_add_pr_comment
 * 3. Posts inline code comments to GitHub PR using github_add_inline_comment
 * 4. Posts Jira-formatted review to Jira ticket (from responseMdContent or response.md)
 * 5. Updates ticket status based on review outcome
 * 6. Adds labels to indicate review completion
 */

const { LABELS, STATUSES } = require('./config.js');

/**
 * Parse response.md when pr_review.json is missing.
 * Extracts recommendation + issue counts from text patterns.
 * @param {string} content - response.md content
 * @returns {Object|null} Partial review data or null
 */
function parseResponseMd(content) {
    if (!content) return null;

    // Extract recommendation from patterns like:
    // "RECOMMENDATION: REQUEST_CHANGES", "Verdict: APPROVE", "🚨 BLOCKED"
    var recommendation = null;
    var recMatch = content.match(/(?:RECOMMENDATION|VERDICT|RECOMMENDATION\s*[:=]?)\s*[:=]?\s*(APPROVE|REQUEST_CHANGES|BLOCK|APPROVED)/i);
    if (recMatch) {
        recommendation = recMatch[1].toUpperCase().replace(/^APPROVED$/, 'APPROVE');
    } else if (/BLOCKED|BLOCK\b/.test(content.toUpperCase())) {
        recommendation = 'BLOCK';
    } else if (/REQUEST_CHANGES|CHANGES REQUESTED/.test(content.toUpperCase())) {
        recommendation = 'REQUEST_CHANGES';
    } else if (/APPROVE|APPROVED/.test(content.toUpperCase())) {
        recommendation = 'APPROVE';
    }

    // Extract issue counts - Jira wiki format: *Blocking Issues Count*: N
    var blockingMatch = content.match(/(?:BLOCKING|🚨)[^\\n]*?Count[^\\n]*?(\d+)/i) || content.match(/Blocking Issues.*?(\d+)/i);
    var blocking = parseInt(blockingMatch ? blockingMatch[1] : 0, 10) || 0;
    var importantMatch = content.match(/(?:IMPORTANT|⚠️)[^\\n]*?Count[^\\n]*?(\d+)/i) || content.match(/Important Issues.*?(\d+)/i);
    var important = parseInt(importantMatch ? importantMatch[1] : 0, 10) || 0;
    var suggestionsMatch = content.match(/(?:SUGGESTION[S]?|💡)[^\\n]*?Count[^\\n]*?(\d+)/i) || content.match(/Suggestions.*?(\d+)/i);
    var suggestions = parseInt(suggestionsMatch ? suggestionsMatch[1] : 0, 10) || 0;

    if (!recommendation) return null;

    return {
        recommendation: recommendation,
        summary: 'Parsed from response.md (AI did not produce structured JSON)',
        generalComment: null,
        inlineComments: [],
        resolvedThreadIds: [],
        issueCounts: { blocking: blocking, important: important, suggestions: suggestions }
    };
}

/**
 * Normalize review data to support both old (file-path refs) and new (inline strings) JSON formats.
 * Old format: generalComment = "outputs/pr_review_general.md", comment = "outputs/pr_review_comments/comment-1.md"
 * New format: generalCommentContent = "...", commentContent = "..."
 */
function normalizeReviewData(reviewData) {
    var data = Object.assign({}, reviewData);

    // Normalize general comment: prefer generalCommentContent (inline string), fall back to reading file
    if (data.generalCommentContent) {
        data._resolvedGeneralComment = data.generalCommentContent;
    } else if (data.generalComment) {
        try {
            data._resolvedGeneralComment = file_read({ path: data.generalComment });
        } catch (e) {
            console.warn('Could not read generalComment file:', data.generalComment);
            data._resolvedGeneralComment = '';
        }
    }

    // Normalize inline comments: prefer commentContent, fall back to reading file
    if (data.inlineComments && Array.isArray(data.inlineComments)) {
        data.inlineComments = data.inlineComments.map(function(c) {
            var normalized = Object.assign({}, c);
            if (normalized.commentContent) {
                normalized._resolvedComment = normalized.commentContent;
            } else if (normalized.comment) {
                try {
                    normalized._resolvedComment = file_read({ path: normalized.comment });
                } catch (e) {
                    console.warn('Could not read comment file:', normalized.comment);
                    normalized._resolvedComment = '';
                }
            }
            return normalized;
        });
    }

    return data;
}

/**
 * Read and parse outputs/pr_review.json
 * Falls back to parsing response.md if JSON is missing/empty.
 * @returns {Object|null} Parsed review data or null on error
 */
function readReviewJson() {
    try {
        const raw = file_read({ path: 'outputs/pr_review.json' });
        if (!raw || raw.trim() === '') {
            console.warn('outputs/pr_review.json is empty');
        } else {
            const parsed = JSON.parse(raw);
            console.log('Parsed pr_review.json:', JSON.stringify(parsed, null, 2));
            return parsed;
        }
    } catch (error) {
        console.warn('Failed to read/parse outputs/pr_review.json:', error.message || error);
    }

    // Fallback: parse response.md
    console.warn('Falling back to response.md parsing');
    try {
        const responseContent = file_read({ path: 'outputs/response.md' });
        const parsed = parseResponseMd(responseContent);
        if (parsed) {
            console.log('Parsed from response.md:', JSON.stringify(parsed, null, 2));
            return parsed;
        }
    } catch (e) {
        console.warn('Could not read response.md:', e.message || e);
    }

    return null;
}

/**
 * Read markdown file content
 * @param {string} filePath - Path to markdown file
 * @returns {string} File content or empty string on error
 */
function readMarkdownFile(filePath) {
    if (!filePath) {
        return '';
    }
    try {
        const content = file_read({ path: filePath });
        if (content && content.trim() !== '') {
            return content;
        }
    } catch (error) {
        console.warn('Could not read file ' + filePath + ':', error);
    }
    return '';
}

/**
 * Extract owner and repo from git remote URL
 * @returns {Object|null} {owner, repo} or null on error
 */
function getGitHubRepoInfo() {
    try {
        const rawOutput = cli_execute_command({
            command: 'git config --get remote.origin.url'
        }) || '';

        // cli_execute_command may append shell wrapper lines (Script done, COMMAND_EXIT_CODE=...)
        // Take only the first non-empty line that looks like a URL
        const remoteUrl = rawOutput.split('\n')
            .map(function(l) { return l.trim(); })
            .filter(function(l) { return l.indexOf('github.com') !== -1; })[0] || '';

        // Parse GitHub URL (https://github.com/owner/repo.git or git@github.com:owner/repo.git)
        const match = remoteUrl.match(/github\.com[:/]([^/]+)\/([^/.?\s]+)/);
        if (!match) {
            console.error('Could not parse GitHub URL from:', remoteUrl);
            return null;
        }

        const owner = match[1];
        const repo = match[2].replace('.git', '');

        console.log('GitHub repo:', owner + '/' + repo);
        return { owner: owner, repo: repo };

    } catch (error) {
        console.error('Failed to get GitHub repo info:', error);
        return null;
    }
}

/**
 * Find PR associated with ticket using DMTools GitHub MCP tools
 * Searches for open PRs and filters by ticket key in title or branch
 *
 * @param {string} workspace - GitHub owner/organization
 * @param {string} repository - GitHub repository name
 * @param {string} ticketKey - Jira ticket key
 * @returns {Object|null} PR object or null
 */
function findPRForTicket(workspace, repository, ticketKey) {
    try {
        console.log('Searching for PR related to', ticketKey);

        // Get open PRs using MCP tool (returns JavaScript Array directly)
        const openPRs = github_list_prs({
            workspace: workspace,
            repository: repository,
            state: 'open'
        });

        console.log('Found', openPRs.length, 'open PRs');

        // Filter PRs by ticket key in title or branch
        const matchingPRs = openPRs.filter(function(pr) {
            const titleMatch = pr.title && pr.title.indexOf(ticketKey) !== -1;
            const branchMatch = pr.head && pr.head.ref && pr.head.ref.indexOf(ticketKey) !== -1;
            return titleMatch || branchMatch;
        });

        if (matchingPRs.length === 0) {
            console.log('No open PRs found mentioning', ticketKey);
            return null;
        }

        console.log('Found matching PR:', matchingPRs[0].number);
        return matchingPRs[0];

    } catch (error) {
        console.error('Error finding PR:', error);
        return null;
    }
}

/**
 * Post general review comment to GitHub PR using DMTools MCP tool
 * @param {string} workspace - GitHub owner/organization
 * @param {string} repository - GitHub repository name
 * @param {number} pullRequestId - PR number
 * @param {string} comment - General comment content (already resolved)
 * @returns {boolean} Success status
 */
function postGeneralComment(workspace, repository, pullRequestId, comment) {
    if (!comment) {
        console.warn('No general comment content provided');
        return false;
    }

    try {
        console.log('Posting general review comment to PR #' + pullRequestId);

        github_add_pr_comment({
            workspace: workspace,
            repository: repository,
            pullRequestId: String(pullRequestId),
            text: comment
        });

        console.log('✅ Posted general review comment');
        return true;

    } catch (error) {
        console.error('Failed to post general comment:', error);
        return false;
    }
}

/**
 * Post inline code review comment to GitHub PR using DMTools MCP tool
 * @param {string} workspace - GitHub owner/organization
 * @param {string} repository - GitHub repository name
 * @param {number} pullRequestId - PR number
 * @param {Object} inlineComment - Inline comment data
 * @returns {boolean} Success status
 */
function postInlineComment(workspace, repository, pullRequestId, inlineComment) {
    var comment = inlineComment._resolvedComment || '';
    if (!comment) {
        console.warn('No comment content for inline comment on ' + inlineComment.file);
        return false;
    }

    try {
        console.log('Posting inline comment on ' + inlineComment.file + ':' + inlineComment.line);

        var params = {
            workspace: workspace,
            repository: repository,
            pullRequestId: String(pullRequestId),
            path: inlineComment.file,
            line: String(inlineComment.line),
            text: comment
        };

        if (inlineComment.startLine) {
            params.startLine = String(inlineComment.startLine);
        }
        if (inlineComment.side) {
            params.side = inlineComment.side;
        }

        github_add_inline_comment(params);

        console.log('✅ Posted inline comment on ' + inlineComment.file + ':' + inlineComment.line);
        return true;

    } catch (error) {
        console.error('Failed to post inline comment on ' + inlineComment.file + ':', error);
        return false;
    }
}

/**
 * Resolve previously-raised review threads that were fully fixed in this rework.
 * @param {string} workspace
 * @param {string} repository
 * @param {number} pullRequestId
 * @param {string[]} resolvedThreadIds - GraphQL node IDs from pr_review.json.resolvedThreadIds
 */
function resolveApprovedThreads(workspace, repository, pullRequestId, resolvedThreadIds) {
    if (!resolvedThreadIds || resolvedThreadIds.length === 0) return;
    console.log('Resolving ' + resolvedThreadIds.length + ' fixed review thread(s)...');
    resolvedThreadIds.forEach(function(threadId) {
        try {
            github_resolve_pr_thread({
                workspace: workspace,
                repository: repository,
                pullRequestId: String(pullRequestId),
                threadId: threadId
            });
            console.log('✅ Resolved thread', threadId);
        } catch (e) {
            console.warn('Failed to resolve thread ' + threadId + ':', e.message || e);
        }
    });
}

/**
 * Merge GitHub PR using DMTools MCP tool github_merge_pr
 * @param {string} workspace - GitHub owner/organization
 * @param {string} repository - GitHub repository name
 * @param {number} pullRequestId - PR number
 * @returns {boolean} Success status
 */
function mergePR(workspace, repository, pullRequestId) {
    try {
        console.log('Merging PR #' + pullRequestId + ' via github_merge_pr...');

        github_merge_pr({
            workspace: workspace,
            repository: repository,
            pullRequestId: String(pullRequestId),
            mergeMethod: 'squash'
        });

        console.log('✅ PR #' + pullRequestId + ' merged successfully');
        return true;

    } catch (error) {
        console.warn('First merge attempt failed (likely conflict) — trying auto-update branch:', error);

        // Auto-fix: merge latest main into the branch and retry
        try {
            try { cli_execute_command({ command: 'git fetch --unshallow' }); } catch (e) {}
            cli_execute_command({ command: 'git fetch origin' });
            cli_execute_command({ command: 'git merge origin/main --no-edit' });
            cli_execute_command({ command: 'git push origin HEAD' });
            console.log('✅ Auto-merged main into branch — retrying PR merge');

            github_merge_pr({
                workspace: workspace,
                repository: repository,
                pullRequestId: String(pullRequestId),
                mergeMethod: 'squash'
            });

            console.log('✅ PR #' + pullRequestId + ' merged after auto-update');
            return true;
        } catch (retryErr) {
            console.error('Auto-update + retry also failed — real conflict needs rework:', retryErr);
            return false;
        }
    }
}

/**
 * Post review results to Jira ticket
 * @param {string} ticketKey - Ticket key
 * @param {string} reviewContent - Review content (from responseMdContent or response.md file)
 * @param {Object} reviewData - Parsed pr_review.json data
 * @param {string} prUrl - PR URL
 * @param {boolean} merged - Whether PR was merged
 * @param {boolean} usedFallback - Whether fallback parsing was used
 */
function postReviewToJira(ticketKey, reviewContent, reviewData, prUrl, merged, usedFallback) {
    try {
        let comment = 'h2. 🔍 Automated PR Review Completed\n\n';

        // Fallback warning
        if (usedFallback) {
            comment += '{panel:bgColor=#FFF7E6|borderColor=#FF8B00}⚠️ *Structured output missing* — AI did not produce pr_review.json. Results parsed from response.md or defaulted. Verify findings manually.{panel}\n\n';
        }

        // Add outcome badge
        // Normalize: LLM sometimes returns "APPROVED" instead of "APPROVE"
        const recommendation = (reviewData.recommendation || reviewData.verdict || 'REQUEST_CHANGES').replace(/^APPROVED$/, 'APPROVE');
        if (merged) {
            comment += '{panel:bgColor=#E3FCEF|borderColor=#00875A}✅ *APPROVED & MERGED* - PR has been merged successfully{panel}\n\n';
        } else if (recommendation === 'APPROVE') {
            comment += '{panel:bgColor=#FFF7E6|borderColor=#FF8B00}⚠️ *APPROVED — MERGE CONFLICT* - Review passed but PR could not be merged automatically. Please resolve conflicts and re-push.{panel}\n\n';
        } else if (recommendation === 'BLOCK') {
            comment += '{panel:bgColor=#FFEBE6|borderColor=#DE350B}🚨 *BLOCKED* - Critical issues must be fixed before merge{panel}\n\n';
        } else {
            comment += '{panel:bgColor=#FFF7E6|borderColor=#FF991F}⚠️ *CHANGES REQUESTED* - Issues found, ticket returned to In Rework{panel}\n\n';
        }

        // Add issue summary
        const issueCounts = reviewData.issueCounts || { blocking: 0, important: 0, suggestions: 0 };
        comment += 'h3. Issue Summary\n';
        comment += '* 🚨 Blocking Issues: *' + issueCounts.blocking + '*\n';
        comment += '* ⚠️ Important Issues: *' + issueCounts.important + '*\n';
        comment += '* 💡 Suggestions: *' + issueCounts.suggestions + '*\n\n';

        if (prUrl) {
            comment += 'h3. Pull Request\n';
            comment += '[View PR on GitHub|' + prUrl + ']\n\n';
        }

        // Add full review content from response.md
        comment += 'h3. Detailed Review\n\n';
        comment += reviewContent + '\n\n';

        comment += '----\n';
        comment += '_Generated by AI Code Reviewer with focus on security, code quality, and OOP principles_';

        jira_post_comment({
            key: ticketKey,
            comment: comment
        });

        console.log('✅ Posted review results to Jira ticket', ticketKey);

    } catch (error) {
        console.error('Failed to post review to Jira:', error);
    }
}

/**
 * Main action function
 * Posts review results to GitHub and Jira, updates ticket
 *
 * @param {Object} params - Parameters from Teammate job
 * @param {Object} params.ticket - Jira ticket object
 * @param {string} params.response - Jira-formatted review from outputs/response.md
 * @param {string} params.inputFolderPath - Path to input folder
 * @returns {Object} Result object
 */
function action(params) {
    try {
        const ticketKey = params.ticket.key;

        console.log('=== Processing PR review results for', ticketKey, '===');

        // Step 1: Read structured review data (with response.md fallback)
        var reviewData = readReviewJson();
        var usedFallback = false;
        if (!reviewData) {
            // Hard fallback: default to REQUEST_CHANGES with empty findings
            console.error('Even response.md parsing failed — defaulting to REQUEST_CHANGES');
            usedFallback = true;
            reviewData = {
                recommendation: 'REQUEST_CHANGES',
                summary: 'AI review completed but produced no structured output. Manual review required.',
                generalComment: null,
                generalCommentContent: null,
                inlineComments: [],
                resolvedThreadIds: [],
                issueCounts: { blocking: 0, important: 0, suggestions: 0 },
                responseMdContent: null
            };
        }
        if (usedFallback || (reviewData.summary && reviewData.summary.indexOf('Parsed from response.md') !== -1)) {
            usedFallback = true;
            console.warn('Using fallback review data — AI did not produce pr_review.json');
        }

        // Normalize: resolve file paths to inline content (supports both old and new JSON formats)
        reviewData = normalizeReviewData(reviewData);

        console.log('Review recommendation:', reviewData.recommendation);
        console.log('Issue counts:', JSON.stringify(reviewData.issueCounts));

        // Get Jira review content: prefer responseMdContent (inline), fall back to params.response
        var jiraReview = reviewData.responseMdContent || params.response || '';

        // Step 2: Extract PR info from input folder or find PR using MCP
        let prNumber = null;
        let prUrl = null;

        // Try to get repo info first as it's needed for finding PR
        const repoInfo = getGitHubRepoInfo();
        if (!repoInfo) {
            console.warn('Could not get GitHub repo info - skipping GitHub comments');
        }

        try {
            // First try to read from input/pr_info.md (if exists)
            const inputFolder = params.inputFolderPath || ('input/' + ticketKey);
            const prInfo = file_read({
                path: inputFolder + '/pr_info.md'
            });

            if (prInfo) {
                // Extract PR number and URL — format: - **PR #**: 13
                const numberMatch = prInfo.match(/\*\*PR #\*\*:\s*(\d+)/);
                const urlMatch = prInfo.match(/\*\*URL\*\*:\s*(https:\/\/[^\s]+)/);

                if (numberMatch) {
                    prNumber = parseInt(numberMatch[1], 10);
                }
                if (urlMatch) {
                    prUrl = urlMatch[1];
                }
                console.log('Found PR info in input folder: #' + prNumber);
            }
        } catch (error) {
            console.warn('Could not read PR info from input folder:', error);
        }

        // Fallback: If no PR number found, search for PR using MCP tools
        if (!prNumber && repoInfo) {
            console.log('PR number not found in input folder, searching GitHub...');
            const pr = findPRForTicket(repoInfo.owner, repoInfo.repo, ticketKey);
            if (pr) {
                prNumber = pr.number;
                prUrl = pr.html_url;
                console.log('Found PR via GitHub search: #' + prNumber);
            } else {
                console.warn('Could not find PR for ticket', ticketKey);
            }
        } else if (!prNumber) {
             console.warn('PR number not found and cannot search without repo info');
        }

        // Step 3: Get GitHub repo info (already done above)

        // Normalize: LLM sometimes returns "APPROVED" instead of "APPROVE"
        const recommendation = (reviewData.recommendation || reviewData.verdict || 'REQUEST_CHANGES').replace(/^APPROVED$/, 'APPROVE');

        // Block approval when AI returned open issues — prevents approving code with known problems
        const issueCounts = reviewData.issueCounts || { blocking: 0, important: 0, suggestions: 0 };
        const hasOpenIssues = (issueCounts.blocking || 0) > 0 || (issueCounts.important || 0) > 0 || (issueCounts.suggestions || 0) > 0;
        const isApproved = recommendation === 'APPROVE' && !hasOpenIssues;

        if (recommendation === 'APPROVE' && hasOpenIssues) {
            console.warn('⚠️ Agent returned APPROVE but there are open issues (blocking=' + issueCounts.blocking + ', important=' + issueCounts.important + ', suggestions=' + issueCounts.suggestions + '). Overriding to REQUEST_CHANGES.');
        }

        let merged = false;

        // Step 4: Post all comments to GitHub PR (always, regardless of outcome)
        if (prNumber && repoInfo) {
            console.log('Posting review to GitHub PR #' + prNumber + ' (recommendation: ' + recommendation + ')');

            // Post general comment
            if (reviewData._resolvedGeneralComment) {
                postGeneralComment(repoInfo.owner, repoInfo.repo, prNumber, reviewData._resolvedGeneralComment);
            }

            // Post inline comments
            if (reviewData.inlineComments && Array.isArray(reviewData.inlineComments) && reviewData.inlineComments.length > 0) {
                console.log('Posting ' + reviewData.inlineComments.length + ' inline comments');

                reviewData.inlineComments.forEach(function(inlineComment, index) {
                    console.log('Processing inline comment ' + (index + 1) + '/' + reviewData.inlineComments.length);
                    postInlineComment(repoInfo.owner, repoInfo.repo, prNumber, inlineComment);
                });
            }

            // Resolve threads that were fully fixed in this rework
            resolveApprovedThreads(repoInfo.owner, repoInfo.repo, prNumber, reviewData.resolvedThreadIds);

            console.log('✅ Posted all review comments to GitHub PR');

            // Step 5: Two-state outcome
            if (isApproved) {
                // STATE 1: APPROVE → label PR and Jira ticket; SM will retry merge when CI passes
                try {
                    github_add_pr_label({
                        workspace: repoInfo.owner,
                        repository: repoInfo.repo,
                        pullRequestId: String(prNumber),
                        label: LABELS.PR_APPROVED
                    });
                    console.log('✅ Added pr_approved label to GitHub PR #' + prNumber);
                } catch (labelErr) {
                    console.warn('Failed to add pr_approved label to GitHub PR:', labelErr);
                }
            } else {
                // STATE 2: REQUEST_CHANGES / BLOCK → do NOT merge
                console.log('PR has issues (' + recommendation + ') - will NOT merge, returning ticket to In Development');
            }

        } else {
            console.warn('No PR number or repo info - skipping GitHub comments and merge');
        }

        // Step 6: Post review to Jira ticket
        postReviewToJira(ticketKey, jiraReview, reviewData, prUrl, merged, usedFallback);

        // Step 7: Update ticket status based on outcome
        try {
            if (isApproved) {
                // Approved → add pr_approved label to Jira and stay in In Review for SM retry-merge
                jira_add_label({
                    key: ticketKey,
                    label: LABELS.PR_APPROVED
                });
                console.log('✅ Added pr_approved label to Jira ticket — SM will retry merge');
            } else {
                // Has issues → move to In Rework for focused fixes
                jira_move_to_status({
                    key: ticketKey,
                    statusName: STATUSES.IN_REWORK
                });
                console.log('✅ Ticket moved to In Rework');

                // Clear rework idempotency label so SM picks up immediately
                try {
                    jira_remove_label({ key: ticketKey, label: 'sm_story_rework_triggered' });
                    console.log('✅ Cleared sm_story_rework_triggered for immediate SM pickup');
                } catch (e) {}
            }
        } catch (statusError) {
            console.warn('Could not update ticket status/label:', statusError);
        }

        // Step 8: Add review label
        try {
            jira_add_label({
                key: ticketKey,
                label: LABELS.AI_PR_REVIEWED
            });
        } catch (error) {
            console.warn('Failed to add ai_pr_reviewed label:', error);
        }

        // Step 9: Remove WIP label if present
        const wipLabel = params.metadata && params.metadata.contextId
            ? params.metadata.contextId + '_wip'
            : 'pr_review_wip';

        try {
            jira_remove_label({
                key: ticketKey,
                label: wipLabel
            });
            console.log('Removed WIP label:', wipLabel);
        } catch (error) {
            console.warn('Failed to remove WIP label:', error);
        }

        // Step 10: Remove SM idempotency label (via customParams)
        const customParams = params.jobParams && params.jobParams.customParams;
        const removeLabel = customParams && customParams.removeLabel;
        if (removeLabel) {
            try {
                jira_remove_label({ key: ticketKey, label: removeLabel });
                console.log('✅ Removed SM label:', removeLabel);
            } catch (e) {}
        }

        // Step 11: Assign back to initiator
        try {
            if (params.initiator) {
                jira_assign_ticket_to({
                    key: ticketKey,
                    accountId: params.initiator
                });
                console.log('✅ Assigned ticket back to initiator');
            }
        } catch (error) {
            console.warn('Failed to assign ticket:', error);
        }

        console.log('✅ PR review workflow completed:', isApproved ? 'MERGED' : 'CHANGES REQUESTED');

        return {
            success: true,
            message: isApproved ? 'PR approved and merged' : 'Changes requested, ticket returned to In Development',
            recommendation: recommendation,
            issueCounts: reviewData.issueCounts,
            githubCommentsPosted: !!(prNumber && repoInfo),
            merged: merged
        };

    } catch (error) {
        console.error('❌ Error in postPRReviewComments:', error);

        // Try to post error to Jira
        try {
            if (params && params.ticket && params.ticket.key) {
                jira_post_comment({
                    key: params.ticket.key,
                    comment: 'h3. ❌ PR Review Error\n\n' +
                        '{code}' + error.toString() + '{code}\n\n' +
                        'Please check the workflow logs for details.'
                });
            }
        } catch (commentError) {
            console.error('Failed to post error comment:', commentError);
        }

        return {
            success: false,
            error: error.toString()
        };
    }
}

// Export for dmtools standalone execution
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { action };
}
