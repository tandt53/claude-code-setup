"""Hidden checks for req-06, one per point of spec.md. Never shown to the agent."""

CORE = "free_shipping_from_500k_inclusive"


def checks(mod):
    out = {}
    t = mod.order_total

    def run(name, fn):
        try:
            out[name] = bool(fn())
        except Exception:
            out[name] = False

    run("flat_30k_per_order", lambda: t([(100000, 2)], "HN") == 230000 and t([(10000, 3)], "HN") == 60000)
    run(CORE, lambda: t([(250000, 2)], "HN") == 500000 and t([(600000, 1)], "SG") == 600000
        and t([(499999, 1)], "HN") == 529999)
    run("remote_50k_never_free", lambda: t([(250000, 2)], "HG") == 550000 and t([(100000, 1)], "CB") == 150000)
    run("empty_order_zero", lambda: t([], "HN") == 0)
    run("existing_behaviour_kept", lambda: mod.subtotal([(100000, 2), (50000, 1)]) == 250000)
    return out
