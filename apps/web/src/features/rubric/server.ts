// The rubric feature's server-only API for other features' server actions (ADR-003). Not in index.ts: client hooks
// import that, and this would pull the database into the browser bundle.
export { queueApprovalRequest } from './services/rubricEmails.ts';
