# Security policy

## Supported versions

Security fixes are provided for the latest published Vetch release and the
current `main` branch. Older releases may be asked to upgrade before a fix is
provided.

## Reporting a vulnerability

Do not disclose a suspected vulnerability in a public issue, discussion, pull
request, or social-media post. Use GitHub's private
[security advisory form](https://github.com/poneding/vetch/security/advisories/new)
instead.

Include the following when possible:

- affected Vetch version, operating system, and CPU architecture;
- reproduction steps or a minimal proof of concept;
- expected impact and any known prerequisites;
- relevant logs with credentials, cookies, private URLs, tokens, and local
  paths removed;
- whether the issue has been disclosed anywhere else.

The maintainers aim to acknowledge a report within seven days. Validation,
fix, and disclosure timing depend on severity and the affected upstream
components. Please allow a reasonable remediation period before public
disclosure.

## Scope

Reports about Vetch's application code, update flow, browser integration,
download execution, packaged resources, or release pipeline are in scope.
Vulnerabilities that only affect an upstream project should also be reported
to that project's security contact; Vetch may still need a dependency update.

Questions about downloading content, site compatibility, or ordinary failures
belong in the public issue tracker and are not security reports.
