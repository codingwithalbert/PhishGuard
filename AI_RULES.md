# PhishGuard AI Development Rules

## Project
PhishGuard is a cybersecurity awareness and phishing risk assessment platform.

## General Rules
- Follow the existing architecture and specifications.
- Do not invent requirements or scoring methodology.
- Keep changes modular and small.
- Prefer simple, maintainable implementations.
- Do not expose secrets, credentials, tokens, or private data.
- Never commit `.env` files or secrets.

## Security
- Validate all user input.
- Enforce authentication and authorization server-side.
- Enforce object-level authorization.
- Sanitize untrusted content.
- Do not trust client-side scores or permissions.
- Log security-relevant events appropriately.

## Git Safety
- Never force-push.
- Never delete branches without approval.
- Never rewrite published history.
- Never commit secrets.
- Do not automatically commit changes.
- Before recommending a commit:
  1. Run relevant tests.
  2. Check for errors.
  3. Review the Git diff.
  4. Check for accidentally exposed secrets.

## Implementation
- Implement only the requested task.
- Do not rewrite unrelated files.
- Do not add unnecessary dependencies.
- Explain important architectural decisions.
- Add tests for new functionality where practical.

## Definition of Done
A task is complete only when:
- The requested behavior works.
- Relevant tests pass.
- Security requirements are satisfied.
- No secrets are exposed.
- The implementation follows the project architecture.
- Documentation is updated when necessary.