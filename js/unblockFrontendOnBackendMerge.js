/**
 * Unblock Frontend on Backend Merge — postJSAction for unblock_frontend agent.
 *
 * Runs on every SM cycle for each Story/Bug in "Blocked" status carrying the
 * backend_split_created label (created by the crossRepoGuard in smAgent.js).
 * - If any linked backend Story (labels backend/api/go) is not yet Merged/Done → wait.
 * - If all linked backend blockers are Merged/Done → move the ticket back to
 *   "Ready For Development" and clear the split/lock labels so the development
 *   dispatch rules pick it up again.
 */

const { STATUSES, LABELS } = require('./config.js');

function action(params) {
    const ticketKey = params.ticket && params.ticket.key;

    try {
        if (!ticketKey) throw new Error('params.ticket.key is missing');
        console.log('=== Unblock check for', ticketKey, '===');

        // Any backend blocker still active?
        const activeBlockers = jira_search_by_jql({
            jql: 'issue in linkedIssues("' + ticketKey + '") AND issuetype = Story' +
                 ' AND labels in ("backend","api","go") AND status NOT IN ("Merged","Done")',
            maxResults: 1
        }) || [];

        if (activeBlockers.length > 0) {
            console.log('Backend blocker still active — waiting for next cycle');
            return { success: true, action: 'waiting', ticketKey };
        }

        // Sanity: at least one merged/done backend blocker must exist
        const mergedBlockers = jira_search_by_jql({
            jql: 'issue in linkedIssues("' + ticketKey + '") AND issuetype = Story' +
                 ' AND labels in ("backend","api","go") AND status IN ("Merged","Done")',
            maxResults: 1
        }) || [];

        if (mergedBlockers.length === 0) {
            console.log('No backend blockers linked at all — waiting for next cycle');
            return { success: true, action: 'no_blockers', ticketKey };
        }

        console.log('All backend blockers merged — unblocking', ticketKey);

        jira_move_to_status({
            key: ticketKey,
            statusName: STATUSES.READY_FOR_DEVELOPMENT
        });

        // Clear labels so dev dispatch rules re-pick the ticket:
        // - backend_split_created: removes it from this rule's JQL and the guard's step 5
        // - sm_*_development_triggered: dev rules' skipIfLabel would otherwise swallow it
        [
            LABELS.BACKEND_SPLIT_CREATED,
            'sm_story_development_triggered',
            'sm_bug_development_triggered'
        ].forEach(function(label) {
            try {
                jira_remove_label({ key: ticketKey, label: label });
            } catch (e) {
                console.warn('Failed to remove label ' + label + ':', e);
            }
        });

        jira_post_comment({
            key: ticketKey,
            comment: 'h3. ✅ Backend API Implementation Complete\n\n' +
                'All blocking backend tickets are merged. ' +
                'This ticket has been moved back to *Ready For Development* ' +
                'and will be dispatched to ms_front in the next SM cycle.'
        });

        console.log('✅', ticketKey, 'unblocked');
        return { success: true, action: 'unblocked', ticketKey };

    } catch (error) {
        console.error('❌ Error in unblockFrontendOnBackendMerge:', error);
        return { success: false, error: error.toString() };
    }
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { action };
}
