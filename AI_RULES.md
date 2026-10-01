# PhishGuard AI Development Rules

## Project
PhishGuard is a cybersecurity awareness and phishing risk assessment platform.

This is a concise companion to `AGENTS.md`, which contains the detailed
project-specific policy, current V1 roadmap, and approval workflow. This summary
must not weaken stricter applicable project rules.

## General Rules
- Follow the existing architecture and specifications.
- Do not invent requirements or scoring methodology.
- Keep changes modular and small.
- Prefer simple, maintainable implementations.
- Do not expose secrets, credentials, tokens, or private data.
- Never commit `.env` files or secrets.
- Never read `.env` or access secrets to complete a task or make tests run.

## Security
- Validate all user input.
- Enforce authentication and authorization server-side.
- Enforce object-level authorization.
- Sanitize untrusted content.
- Do not trust client-side scores or permissions.
- Log security-relevant events appropriately.
- Preserve sanitized global error diagnostics and query-free audit paths; never
  restore raw error-object or arbitrary query-string logging.

## Git Safety
- Never force-push.
- Never delete branches, rewrite Git history, or use destructive Git commands.
- Never commit secrets.
- Staging, commits, pushes, and deployment each require explicit authorization
  for that specific step under the `AGENTS.md` ChatGPT/user/OpenCode workflow.
  Verify the staged set and commit/status before progressing. Deployment approval
  is separate from commit/push approval; never perform these independently.
- Before recommending a commit:
  1. Run relevant checks within the authorized, known-safe scope.
  2. Check for errors.
  3. Review the Git diff.
  4. Check for accidentally exposed secrets.

## Implementation
- Implement only the requested task.
- Do not rewrite unrelated files.
- Do not add unnecessary dependencies.
- Package installation outside the approved task requires explicit approval.
- Report unrelated findings; do not expand scope or make additional fixes.
- Remaining V1 QA/documentation/release work does not authorize new features;
  optional/V2 ideas require separate approval. Preserve completed UI work.
- Explain important architectural decisions.
- Add tests for new functionality where practical.

## Commands and Verification
- Use Windows PowerShell-compatible commands; do not use `&&` or `||`. Use
  separate commands or semicolons where appropriate.
- Inspect test commands before execution; prefer relevant isolated tests for
  bounded tasks. Live MongoDB, running-API, production, or environment-dependent
  checks require explicit authorization and a known-safe environment.
- Report exact check scope/results and intentional skips. Do not present
  historical evidence as current execution or equate differently scoped counts.
- Review diffs and run `git diff --check`; documentation-only tasks normally do
  not require application tests.
- Do not use subagents unless explicitly requested.

## Definition of Done
A task is complete only when:
- The requested behavior works.
- Relevant tests pass.
- Security requirements are satisfied.
- No secrets are exposed.
- The implementation follows the project architecture.
- Documentation is updated when necessary.
