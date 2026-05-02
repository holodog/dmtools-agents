/**
 * SM Health Monitor (localExecution)
 *
 * Scan tickets with triggered labels.
 * Flag if stale > 12h.
 */

function action(params) {
    var ticket = params.ticket;
    var ticketKey = ticket.key;
    var labels = (ticket.fields && ticket.fields.labels) ? ticket.fields.labels : [];

    var triggeredLabels = labels.filter(function(l) {
        return l.indexOf('_triggered') !== -1;
    });

    if (triggeredLabels.length === 0) return { success: true, processed: false };

    if (labels.indexOf('sm_automation_stuck') !== -1) {
        return { success: true, processed: false };
    }

    console.log('=== Monitoring Health for', ticketKey, '===');
    
    var updatedStr = ticket.fields.updated;
    var updatedDate = new Date(updatedStr);
    var now = new Date();
    var diffMs = now.getTime() - updatedDate.getTime();
    var diffHours = diffMs / (1000 * 60 * 60);

    console.log('    Last updated:', updatedStr, '(' + diffHours.toFixed(1) + 'h ago)');

    if (diffHours < 12) {
        console.log('    Not stale yet.');
        return { success: true, processed: false };
    }

    console.log('    ⚠️ TICKET IS STALE');

    try {
        jira_add_label({ key: ticketKey, label: 'sm_automation_stuck' });
    } catch (e) {
        console.warn('    Failed label:', e.message || e);
    }

    var comment = 'h3. ⚠️ SM Agent Health Alert\n\n' +
        'Ticket stuck in automation loop.\n\n' +
        '* *Issue*: Trigger labels present, no update for *' + diffHours.toFixed(1) + ' hours*.\n' +
        '* *Triggered Label(s)*: ' + triggeredLabels.map(function(l) { return '{code}' + l + '{code}'; }).join(', ') + '\n' +
        '* *Status*: ' + (ticket.fields.status ? ticket.fields.status.name : 'Unknown') + '\n\n' +
        'Check [GitHub Action logs|https://github.com/holodog/ms_root/actions].';

    try {
        jira_post_comment({ key: ticketKey, comment: comment });
        console.log('    ✅ Posted alert');
    } catch (e) {
        console.warn('    Failed comment:', e.message || e);
    }

    return { success: true, processed: true, staleHours: diffHours };
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { action: action };
}
