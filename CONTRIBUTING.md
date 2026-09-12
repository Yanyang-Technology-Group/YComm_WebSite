# Contributing to YComm

YComm is licensed under the **GNU Affero General Public License v3.0 (or later)**.
By contributing you keep the community ownership promise: everyone who runs or
modifies the site owes their changes back in source form.

## Developer Certificate of Origin (DCO)

This project uses the **DCO**, not a CLA. Every commit must carry a
`Signed-off-by` trailer confirming you are entitled to submit the change under
AGPL-3.0-or-later:

```text
Signed-off-by: Your Name <you@example.com>
```

The sign-off states this (verbatim from developercertificate.org):

> By making a contribution to this project, I certify that:
> (a) The contribution was created in whole or in part by me and I have the
>     right to submit it under the open source license indicated in the file; or
> (b) The contribution is based upon previous work that, to the best of my
>     knowledge, is covered under an appropriate open source license and I have
>     the right under that license to submit that work with modifications; or
> (c) The contribution was provided directly to me by some other person who
>     certified (a) or (b) and I have not modified it.
> (d) I understand and agree that this project and the contribution are public
>     and that a record of the contribution (including all personal information
>     I submit with it, including my sign-off) is maintained indefinitely.

Practical rules:

- Configure git once: `git config --global user.name "Your Name"` and
  `git config --global user.email you@example.com`.
- Commit with `git commit -s` — that appends the trailer automatically.
- CI rejects pushes with unsigned commits (DCO check step).

## Development setup

```bash
npm install            # uses npm workspaces; PGlite means no DB install needed
npm run dev            # Next.js dev server on http://localhost:3000
npm run db:generate    # regenerate migrations after schema changes
npm run db:migrate     # apply migrations to your local PGlite
npm run db:seed        # bootstrap boards/categories/settings
npm run verify         # lint + typecheck + test + license gate
```

## Architectural rules (enforced by ESLint, do not bypass)

- Dependencies run strictly one way: `web → api → domain packages → kernel/db`.
- Only `@ycomm/db` may touch the database. The web layer imports `@ycomm/api`
  and nothing deeper.
- Packages never import `next` or `hono`.
- A hidden access check that "works" is a regression: capability checks go
  through the access package, period.

See `docs/ARCHITECTURE.md` for the full picture.