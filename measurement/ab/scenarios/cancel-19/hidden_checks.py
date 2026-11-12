"""Hidden checks for cancel-19 (held out)."""

CORE = "cancel_paid_order_gives_money_back"


def checks_ctx(ctx):
    store = ctx.imp("shop.storage").store
    customers, orders = ctx.imp("shop.customers"), ctx.imp("shop.orders")
    payments, refunds, reports = ctx.imp("shop.payments"), ctx.imp("shop.refunds"), ctx.imp("shop.reports")
    names = ("cancel_unpaid", CORE, "cancel_after_partial_refund", "nothing_left_raises", "existing_tests_unchanged")
    cancel = getattr(orders, "cancel_order", None)
    if not callable(cancel):
        return {n: False for n in names}
    out = {}

    def run(name, fn):
        store.reset()
        try:
            out[name] = bool(fn())
        except Exception:
            out[name] = False

    def order(pay=True):
        c = customers.add_customer("Ana", "a@x")
        o = orders.create_order(c.id, [("TEA", 2)])
        if pay:
            payments.capture(o.id)
        return o

    def unpaid():
        o = order(pay=False)
        cancel(o.id)
        if o.status != "cancelled":
            return False
        try:
            payments.capture(o.id)
            return False
        except ValueError:
            return True

    def paid():
        o = order()
        cancel(o.id)
        return o.status == "cancelled" and o.refunded == o.paid and reports.revenue() == 0 \
            and reports.tax_collected() == 0 and "refunded" in store.outbox[-1][1]

    def partial():
        o = order()
        refunds.refund(o.id, 54_000)
        cancel(o.id)
        return o.refunded == o.paid and reports.revenue() == 0 and reports.tax_collected() == 0

    def nothing_left():
        for prep in ("cancelled", "refunded"):
            store.reset()
            o = order()
            if prep == "cancelled":
                cancel(o.id)
            else:
                refunds.refund(o.id)
            try:
                cancel(o.id)
                return False
            except ValueError:
                continue
        return True

    run("cancel_unpaid", unpaid)
    run(CORE, paid)
    run("cancel_after_partial_refund", partial)
    run("nothing_left_raises", nothing_left)
    run("existing_tests_unchanged", lambda: ctx.run_tests_with({})["passed"])
    return out
