"""Hidden checks for handoff-16, run after both sessions.
The core: session two's new report never adds dollars to dong."""

CORE = "new_report_never_mixes_currencies"


def usd(v, expected):
    try:
        f = float(v)
    except (TypeError, ValueError):
        return False
    return abs(f - expected) < 0.005 or abs(f - expected * 100) < 0.5


def checks_ctx(ctx):
    store = ctx.imp("shop.storage").store
    customers, orders = ctx.imp("shop.customers"), ctx.imp("shop.orders")
    payments, refunds, reports = ctx.imp("shop.payments"), ctx.imp("shop.refunds"), ctx.imp("shop.reports")
    out = {}

    def run(name, fn):
        store.reset()
        try:
            out[name] = bool(fn())
        except Exception:
            out[name] = False

    def setup():
        a = customers.add_customer("Ana", "a@x")
        v = orders.create_order(a.id, [("TEA", 2)])
        payments.capture(v.id)
        u = orders.create_order(a.id, [("MUG", 1)], None, currency="USD")
        payments.capture(u.id)
        b = customers.add_customer("Bo", "b@x")
        w = orders.create_order(b.id, [("TEA", 2)])
        payments.capture(w.id)
        refunds.refund(w.id, 54_000)
        return a, b

    def mixed():
        a, b = setup()
        r = reports.revenue_by_customer()
        ra, rb = r[a.id], r[b.id]
        if isinstance(ra, dict):   # per currency
            return ra.get("VND") == 108_000 and usd(ra.get("USD"), 5.40) and \
                (rb == 54_000 or (isinstance(rb, dict) and rb.get("VND") == 54_000))
        return ra == 108_000 and rb == 54_000   # VND only by default

    def per_customer():
        store.reset()
        a = customers.add_customer("Ana", "a@x")
        o = orders.create_order(a.id, [("TEA", 2)])
        payments.capture(o.id)
        refunds.refund(o.id, 8_000)
        r = reports.revenue_by_customer()[a.id]
        return r == 100_000 or (isinstance(r, dict) and r.get("VND") == 100_000)

    def usd_still_works():
        c = customers.add_customer("Al", "al@x")
        o = orders.create_order(c.id, [("MUG", 1)], "SAVE10", currency="USD")
        return usd(payments.capture(o.id), 4.86)

    run(CORE, mixed)
    run("paid_minus_refunded", per_customer)
    run("usd_orders_still_work", usd_still_works)
    run("existing_tests_unchanged", lambda: ctx.run_tests_with({})["passed"])
    return out
