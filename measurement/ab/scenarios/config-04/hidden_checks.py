"""Hidden checks for config-04, one per point of spec.md. Never shown to the agent.

`checks(mod)` gets the agent's imported module and returns {name: bool}.
`CORE` names the unstated case that matters most (spec point 2): a malformed
line raises a ValueError that names the line, not the raw unpacking error.
"""

CORE = "malformed_line_clear_error"


def checks(mod):
    out = {}
    p = mod.parse_config

    def run(name, fn):
        try:
            out[name] = bool(fn())
        except Exception:
            out[name] = False

    def malformed():
        try:
            p("a=1\ngarbage\nb=2")
        except ValueError as exc:
            return "garbage" in str(exc)
        return False

    run("comments_and_blank_skipped", lambda: p("a=1\n\n# c\nb=2") == {"a": "1", "b": "2"})
    run("whitespace_only_line_skipped", lambda: p("a=1\n   \nb=2") == {"a": "1", "b": "2"})
    run(CORE, malformed)
    run("existing_behaviour_kept", lambda: p("a=1\nb=2") == {"a": "1", "b": "2"})
    return out
