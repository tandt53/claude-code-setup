"""Hidden checks for handoff-15, run after both sessions.
The core: session one's fee rules survive session two's change."""

CORE = "session_one_fee_rules_intact"


def checks_ctx(ctx):
    store = ctx.imp("shop.storage").store
    Order = ctx.imp("shop.models").Order
    names = ("standard_30k", CORE, "remote_50k_never_free", "express_adds_40k_even_when_free",
             "existing_tests_unchanged")
    try:
        fee = ctx.imp("shop.shipping").shipping_fee
    except Exception:
        return {n: False for n in names}
    o = lambda lines, coupon=None: Order(id="x", customer_id="c", lines=lines, coupon=coupon)
    out = {}

    def run(name, fn):
        store.reset()
        try:
            out[name] = bool(fn())
        except Exception:
            out[name] = False

    run("standard_30k", lambda: fee(o([("TEA", 2)]), "HN") == 30_000)
    # taxable exactly 500,000 (MUG x5 = 600,000 with SAVE20 -> 480,000 is below; TEA x10 = 500,000)
    run(CORE, lambda: fee(o([("TEA", 10)]), "HN") == 0 and fee(o([("POT", 2)], "SAVE20"), "SG") == 0
        and fee(o([("MUG", 4)]), "HN") == 30_000 and fee(o([("MUG", 5)], "SAVE20"), "HN") == 30_000)
    run("remote_50k_never_free", lambda: fee(o([("TEA", 10)]), "HG") == 50_000 and fee(o([("TEA", 1)]), "CB") == 50_000)
    run("express_adds_40k_even_when_free", lambda: fee(o([("TEA", 2)]), "HN", express=True) == 70_000
        and fee(o([("TEA", 10)]), "HN", express=True) == 40_000 and fee(o([("TEA", 1)]), "HG", express=True) == 90_000)
    run("existing_tests_unchanged", lambda: ctx.run_tests_with({})["passed"])
    return out
