/**
 * Move To In Testing Action (postJSAction for test_cases_generator)
 * Moves the ticket to "In Testing" status after test cases are generated.
 */

const { STATUSES } = require('./config.js');

function action(params) {
    try {
        const ticketKey = params.ticket ? params.ticket.key : null;
        if (!ticketKey) {
            return { success: false, error: 'No ticket key found in params' };
        }

        console.log('Moving ' + ticketKey + ' to ' + STATUSES.IN_TESTING);

        jira_move_to_status({
            key: ticketKey,
            statusName: STATUSES.IN_TESTING
        });

        console.log('✅ ' + ticketKey + ' moved to ' + STATUSES.IN_TESTING);

        return {
            success: true,
            message: ticketKey + ' moved to ' + STATUSES.IN_TESTING
        };

    } catch (error) {
        console.error('❌ Error in moveToInTesting:', error);
        return { success: false, error: error.toString() };
    }
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { action };
}
