"""Hidden checks for handoff-14, run after both sessions.
The core: session one's rules still hold once session two added spending."""

CORE = "session_one_rules_hold_with_spending"


def checks_ctx(ctx):
    store = ctx.imp("shop.storage").store
    customers, orders = ctx.imp("shop.customers"), ctx.imp("shop.orders")
    payments, refunds = ctx.imp("shop.payments"), ctx.imp("shop.refunds")
    names = ("earned_at_capture_one_per_10k", "refund_takes_points_back", "redeem_value_and_multiples",
             "redeem_not_more_than_balance", CORE, "existing_tests_unchanged")
    try:
        loyalty = ctx.imp("shop.loyalty")
        bal, redeem = loyalty.points_balance, loyalty.redeem_points
    except Exception:
        return {n: False for n in names}
    out = {}

    def run(name, fn):
        store.reset()
        try:
            out[name] = bool(fn())
        except Exception:
            out[name] = False

    def order(c, lines, pay=True):
        o = orders.create_order(c.id, lines)
        if pay:
            payments.capture(o.id)
        return o

    def earned():
        c = customers.add_customer("Ana", "a@x")
        o = order(c, [("TEA", 2)], pay=False)
        before = bal(c.id)
        payments.capture(o.id)
        return before == 0 and bal(c.id) == 10

    def refund_back():
        c = customers.add_customer("Ana", "a@x")
        o = order(c, [("TEA", 2)])
        refunds.refund(o.id, 54_000)
        return bal(c.id) == 5

    def value():
        c = customers.add_customer("Ana", "a@x")
        order(c, [("POT", 3)])                        # taxable 1,050,000 -> 105 points
        v = redeem(c.id, 100)
        try:
            redeem(c.id, 5)
            return False
        except ValueError:
            pass
        return v == 10_000 and bal(c.id) == 5

    def capped():
        c = customers.add_customer("Ana", "a@x")
        order(c, [("POT", 3)])
        try:
            redeem(c.id, 200)
            return False
        except ValueError:
            return bal(c.id) == 105

    def interplay():
        c = customers.add_customer("Ana", "a@x")
        o = order(c, [("POT", 3)])
        redeem(c.id, 100)                              # 5 left
        refunds.refund(o.id)                           # the 105 earned are taken back
        return bal(c.id) == 0                          # never negative

    run("earned_at_capture_one_per_10k", earned)
    run("refund_takes_points_back", refund_back)
    run("redeem_value_and_multiples", value)
    run("redeem_not_more_than_balance", capped)
    run(CORE, interplay)
    run("existing_tests_unchanged", lambda: ctx.run_tests_with({})["passed"])
    return out
