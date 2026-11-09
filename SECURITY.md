# Security policy

Vespry handles a Discord session token and private conversations, so security
reports are taken seriously.

## Reporting a vulnerability

Please **do not open a public issue**. Use GitHub's
[private vulnerability report](https://github.com/atelier-sam/vespry/security/advisories/new):
only the maintainer can read it.

Include what you can: the Vespry version (shown in the extension header), the
browser, the steps to reproduce, and what an attacker could obtain.

You will get an answer within a few days. Fixes ship in a new release, and the
advisory is published once users have had time to update (store installs update
on their own).

## Supported versions

Only the latest release receives fixes.

## Scope

In scope: the extension (`src/`), the donation service (`donor-service/`), and
anything that could leak a token, a message, or an identifier off the user's
machine. Out of scope: Discord itself, Stripe, and the policies of the browser
stores.

How Vespry handles data is described in [PRIVACY.en.md](PRIVACY.en.md).
