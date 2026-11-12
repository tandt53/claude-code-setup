# Places

The default place of each file the work keeps. The Workflow and
Communication rules and the skills name these places by the role in the
first column, never by a path. This table is the one place that maps a role
to a path.

A project's CLAUDE.md or AGENTS.md may map any role differently, and it
wins. It may use its own words: a line `Work records: notes/work/` sets the
work folder, so its task folders go in `notes/work/tasks/`.

## Defaults

| Role | Default |
|---|---|
| work folder | `.work/` at the project root: the git repository root, or the folder the task is about when there is no repository. Never in the home folder; with no project folder, ask where the work belongs |
| task folder | `<work folder>/tasks/<yyyy-mm-dd>-<name>/` |
| map | `<task folder>/map.md`, in a folder with no spec; each slice is its own task folder beside it, `<work folder>/tasks/<yyyy-mm-dd>-<name>-s<n>/` |
| spec | `<task folder>/spec.md` |
| project lessons | `<work folder>/lessons.md`: the project's domain, code and data |
| personal lessons | `~/.claude/lessons.md`: how Claude works, in any project |
| decision records | the folder the project already keeps them in (`docs/adr/`, `docs/decisions/`…). With none: `docs/decisions/NNNN-<name>.md`, proposed first (spec skill) |
| product docs | the folder the project's instructions name for its requirements and product rules (`docs/product/` with the project kit). With none: the project lessons |
| project kit | `~/.claude/project-kit/` |
| message shapes | `~/.claude/prompts/message-shapes.md`: the full shape of a report of T1 and up, and when to draw a diagram; read on demand, never imported |
| project instructions | the project's CLAUDE.md or AGENTS.md. Claude Code fixes these names, so no project maps them |
