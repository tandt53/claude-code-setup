"""Hidden checks for feature-03, one per point of spec.md. Never shown to the agent.

`checks(mod)` gets the agent's imported module and returns {name: bool}.
`CORE` names the unstated case that matters most (spec point 2).
"""

CORE = "unknown_code_raises_valueerror"


def _inv(mod):
    inv = mod.Inventory()
    inv.add_item("apple", 10, 2)
    inv.add_item("pear", 5, 4)
    return inv


def _close(a, b):
    return abs(float(a) - float(b)) < 1e-9


def checks(mod):
    out = {}

    def run(name, fn):
        try:
            out[name] = bool(fn())
        except Exception:
            out[name] = False

    def save10():
        inv = _inv(mod)
        inv.apply_discount("SAVE10")
        return _close(inv.total_value(), 36)

    def save20():
        inv = _inv(mod)
        inv.apply_discount("SAVE20")
        return _close(inv.total_value(), 32)

    def unknown():
        inv = _inv(mod)
        try:
            inv.apply_discount("NOPE")
        except ValueError:
            return True
        return False

    def reapply():
        inv = _inv(mod)
        inv.apply_discount("SAVE10")
        inv.apply_discount("SAVE20")
        return _close(inv.total_value(), 32)

    def empty():
        inv = mod.Inventory()
        a = inv.total_value()
        inv.apply_discount("SAVE10")
        return _close(a, 0) and _close(inv.total_value(), 0)

    def existing():
        inv = _inv(mod)
        ok = _close(inv.total_value(), 40)
        inv.remove_item("apple")
        return ok and _close(inv.total_value(), 20)

    run("save10_is_90pct", save10)
    run("save20_is_80pct", save20)
    run(CORE, unknown)
    run("reapply_replaces_not_stacks", reapply)
    run("empty_inventory_zero", empty)
    run("existing_behaviour_kept", existing)
    return out
