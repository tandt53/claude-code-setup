"""Hidden checks for multi-12, one per point of spec.md. Never shown to the agent."""

CORE = "refund_takes_points_back"


def checks_ctx(ctx):
    store = ctx.imp("shop.storage").store
    customers, orders = ctx.imp("shop.customers"), ctx.imp("shop.orders")
    payments, refunds = ctx.imp("shop.payments"), ctx.imp("shop.refunds")
    names = ("earn_one_per_10k_taxable", "earned_at_capture_not_creation", CORE,
             "balance_sums_orders_zero_for_none", "existing_tests_unchanged")
    try:
        bal = ctx.imp("shop.loyalty").points_balance
    except Exception:  # no shop/loyalty.py, or no points_balance: nothing to check
        return {n: False for n in names}
    out = {}

    def run(name, fn):
        store.reset()
        try:
            out[name] = bool(fn())
        except Exception:
            out[name] = False

    def setup(lines=(("TEA", 2),), coupon=None, pay=True):
        c = customers.add_customer("Ana", "ana@example.com")
        o = orders.create_order(c.id, list(lines), coupon)
        if pay:
            payments.capture(o.id)
        return c, o

    def rule():
        c, _ = setup()
        c2, _ = setup([("POT", 1)], "SAVE10")
        return bal(c.id) == 10 and bal(c2.id) == 31

    def when():
        c, o = setup(pay=False)
        before = bal(c.id)
        payments.capture(o.id)
        return before == 0 and bal(c.id) == 10

    def refund_back():
        c, o = setup()
        refunds.refund(o.id, 54_000)
        half = bal(c.id)
        refunds.refund(o.id)
        return half == 5 and bal(c.id) == 0

    def sums():
        c = customers.add_customer("Bo", "bo@example.com")
        for lines in ([("TEA", 2)], [("MUG", 1)]):
            payments.capture(orders.create_order(c.id, lines).id)
        none = customers.add_customer("Cy", "cy@example.com")
        return bal(c.id) == 22 and bal(none.id) == 0

    run("earn_one_per_10k_taxable", rule)
    run("earned_at_capture_not_creation", when)
    run(CORE, refund_back)
    run("balance_sums_orders_zero_for_none", sums)
    run("existing_tests_unchanged", lambda: ctx.run_tests_with({})["passed"])
    return out
