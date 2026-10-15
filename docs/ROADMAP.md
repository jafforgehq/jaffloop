# Roadmap

Also shown inside the app (What's new, Roadmap tab). Plans change. Nothing here is a promise.

## Next

- Monday and Friday reviews: Jaffloop supplies the facts over MCP, Claude writes the review. Optional Jira, Confluence and Outlook context stays on Claude's side; the app never talks to them.
- Alias map per person (email, Jira handle) so reviews match people correctly.
- Capture nudges after meetings and at end of day: "what did you promise?" with one-tap people chips. No calendar access.
- Said-log check before a 1:1: what you told someone versus what you did.

## Later

- Growth and feedback thread per person for review and promotion evidence.
- Optional database encryption.
- Import and export as Markdown and CSV.
- Shortcuts actions and a `jaffloop://` URL scheme.

## Open decisions

- License: which parts are open (MCP server, data format) and which stay paid.
- Whether updates should ever install without asking. Today they download in the background and ask before restarting.

## Keeping this in sync

The in-app copy lives in `src/renderer/releases-data.ts`. When you ship a version: add its entry there and to `docs/CHANGELOG.md`, bump `version` in `package.json` (the MCP server and the About page read it), then release.
