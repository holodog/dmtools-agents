/**
 * Configuration constants for agent scripts
 * Central location for all hardcoded values used across agent workflows
 */

// Jira Issue Types
const ISSUE_TYPES = {
    SUBTASK: 'Subtask',
    TASK: 'Task',
    STORY: 'Story',
    BUG: 'Bug',
    EPIC: 'Epic'
};

// Jira Statuses
const STATUSES = {
    IN_REVIEW: 'In Review',
    PO_REVIEW: 'PO REVIEW',                         // transition name → reaches "PO Review" status
    SOLUTION_ARCHITECTURE: 'SOLUTION ARCHITECTURE', // transition name → reaches "Solution Architecture" status
    READY_FOR_DEVELOPMENT: 'Ready For Development',
    IN_DEVELOPMENT: 'In Development',               // transition name → reaches "In Development" status
    IN_PROGRESS: 'In Progress',                     // transition name → reaches "In Development" on Task/SD tickets
    BLOCKED: 'Blocked',
    TODO: 'To Do',
    DONE: 'Done',
    MERGED: 'Merged',                               // PR merged and ticket complete
    IN_REWORK: 'In Rework',                         // PR review failed, focused fixes needed
    READY_FOR_TESTING: 'Ready For Testing',          // Test cases generated, ready for QA
    PR_READY: 'PR Ready',                            // Tests passed, PR awaiting review
    FAILED: 'Failed',                                // Test automation passed review
    PASSED: 'Passed',                                // Test automation passed review
    IN_REVIEW_PASSED: 'In Review - Passed',          // Test ran and passed, awaiting code review
    CI_PENDING: 'CI Pending',                          // PR created, waiting for CI results
    IN_REVIEW_FAILED: 'In Review - Failed',          // Test ran and failed, awaiting code review
    IN_TESTING: 'In Testing',                        // Test cases generated, automation in progress
    BUG_TO_FIX: 'Bug To Fix'                         // Bug linked/created for this TC, waiting for fix
};

// Jira Priorities
const PRIORITIES = {
    LOW: 'Low',
    MEDIUM: 'Medium',
    HIGH: 'High',
    HIGHEST: 'Highest',
    LOWEST: 'Lowest'
};

// Labels
const LABELS = {
    AI_GENERATED: 'ai_generated',
    AI_QUESTIONS_ASKED: 'ai_questions_asked',
    AI_SOLUTION_DESIGN_CREATED: 'ai_solution_design_created',
    AI_DEVELOPED: 'ai_developed',
    AI_PR_REVIEWED: 'ai_pr_reviewed',
    AI_INTAKE: 'ai_intake',
    QUESTION: 'q',
    SD_CORE: 'sd_core',
    SD_API: 'sd_api',
    SD_UI: 'sd_ui',
    NEEDS_API_IMPLEMENTATION: 'needs_api_implementation',
    NEEDS_CORE_IMPLEMENTATION: 'needs_core_implementation',
    AI_TEST_AUTOMATION: 'ai_test_automation',
    PR_APPROVED: 'pr_approved',              // Added to PR and ticket when AI approves, removed after merge attempt
    // Test automation flow labels
    NEW_SM_TEST_AUTOMATION: 'new_sm_test_automation_triggered',
    NEW_SM_CI_CHECK: 'new_sm_ci_check_triggered',
    NEW_SM_CI_REWORK: 'new_sm_ci_rework_triggered',
    NEW_CI_RETRY: 'new_ci_retry',
    // Cross-repo split (frontend ticket needing backend API work)
    HAS_API_DEPENDENCY: 'has_api_dependency',        // Set by SA on frontend stories needing backend work
    NEEDS_BACKEND: 'needs_backend',                  // Human/BA/intake label on bugs needing backend work
    BACKEND_SPLIT_CREATED: 'backend_split_created',  // Idempotency: paired backend ticket already created
    // Cross-repo split, mirror (backend ticket needing frontend follow-up)
    NEEDS_FRONTEND: 'needs_frontend',                // Set by SA (or human, for bugs) on backend tickets needing UI work
    FRONTEND_SPLIT_CREATED: 'frontend_split_created' // Idempotency: paired frontend ticket already created
};

// Git Configuration
var GIT_CONFIG = {
    AUTHOR_NAME: 'AI Teammate',
    AUTHOR_EMAIL: 'agent.ai.native@gmail.com',
    DEFAULT_ISSUE_TYPE_PREFIX: 'feature'
};

// Get DEFAULT_BASE_BRANCH from environment or global (GraalVM compatible)
(function() {
    var envBranch = null;

    // Method 1: Check for global variable set by workflow (most reliable)
    if (typeof DEFAULT_BASE_BRANCH !== 'undefined' && DEFAULT_BASE_BRANCH) {
        envBranch = DEFAULT_BASE_BRANCH;
    }

    // Method 2: Try GraalVM Java interop for environment variable
    if (envBranch == null) {
        try {
            var System = Java.type('java.lang.System');
            var allEnv = System.getenv();
            if (allEnv != null && !allEnv.isEmpty()) {
                envBranch = System.getenv('DEFAULT_BASE_BRANCH');
            }
        } catch (e) {
            // Java interop not available
        }
    }

    GIT_CONFIG.DEFAULT_BASE_BRANCH = (envBranch != null) ? envBranch : 'main';
})();

// Solution Design Module Prefixes
const MODULE_PREFIXES = {
    CORE: '[SD CORE]',
    API: '[SD API]',
    UI: '[SD UI]'
};

// Module Configuration for Solution Design
const SOLUTION_DESIGN_MODULES = [
    { flag: 'core', prefix: MODULE_PREFIXES.CORE, label: LABELS.SD_CORE },
    { flag: 'api', prefix: MODULE_PREFIXES.API, label: LABELS.SD_API },
    { flag: 'ui', prefix: MODULE_PREFIXES.UI, label: LABELS.SD_UI }
];

// Diagram Defaults
const DIAGRAM_DEFAULTS = {
    API_SEQUENCE: 'sequenceDiagram\n    participant Client\n    participant API\n    Client->>API: Request\n    API-->>Client: Response',
    CORE_GRAPH: 'graph TD\n    A[SD CORE Enhancement] --> B[Technical Implementation]'
};

// Diagram Formatting
const DIAGRAM_FORMAT = {
    MERMAID_WRAPPER_START: '{code:mermaid}\n',
    MERMAID_WRAPPER_END: '\n{code}'
};

// Field Names
const JIRA_FIELDS = {
    DIAGRAMS: 'Diagrams',
    SOLUTION: 'Solution'
};

// Summary Length Constraints
const SUMMARY_MAX_LENGTH = 120;

// Export all configuration
module.exports = {
    ISSUE_TYPES,
    STATUSES,
    PRIORITIES,
    LABELS,
    GIT_CONFIG,
    MODULE_PREFIXES,
    SOLUTION_DESIGN_MODULES,
    DIAGRAM_DEFAULTS,
    DIAGRAM_FORMAT,
    JIRA_FIELDS,
    SUMMARY_MAX_LENGTH
};

