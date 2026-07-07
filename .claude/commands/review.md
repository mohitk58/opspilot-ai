Review the currently uncommitted changes (git diff) as a strict senior
engineer against the rules in CLAUDE.md. Check specifically:
1. Zod validation from @opspilot/types (no inline/duplicate validation)
2. Mutations follow the transaction pattern (timeline + audit + outbox)
3. No module reaches into another module's Prisma calls
4. Pagination contract on list endpoints; problem+json errors
5. Tests exist and cover failure paths, not just happy paths
6. No secrets, no `any` without justification, Swagger annotations present
Report issues as a numbered list ordered by severity, with file:line
references. Then wait — do not auto-fix until I say so.
