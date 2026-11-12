"""Hidden checks for multi-13, one per point of spec.md. Never shown to the agent."""

CORE = "refund_vat_matches_charged"


def checks_ctx(ctx):
    store = ctx.imp("shop.storage").store
    customers, orders = ctx.imp("shop.customers"), ctx.imp("shop.orders")
    payments, refunds, reports = ctx.imp("shop.payments"), ctx.imp("shop.refunds"), ctx.imp("shop.reports")
    invoice = ctx.imp("shop.invoice").invoice
    out = {}

    def run(name, fn):
        store.reset()
        try:
            out[name] = bool(fn())
        except Exception:
            out[name] = False

    def coupon_order():
        c = customers.add_customer("Ana", "ana@example.com")
        o = orders.create_order(c.id, [("POT", 1)], "SAVE10")
        payments.capture(o.id)
        return o

    def inv():
        i = invoice(coupon_order().id)
        return i["tax"] == 25_200 and i["total"] == 340_200 and "25,200" in i["text"]

    def refund_vat():
        o = coupon_order()
        half = refunds.refund(o.id, 170_100)["tax"]
        rest = refunds.refund(o.id)["tax"]
        return half == 12_600 and half + rest == 25_200 and reports.tax_collected() == 0

    def regression():
        tests, _ = ctx.agent_tests()
        if not tests:
            return False
        old = {f: ctx.original(f) for f in ("shop/invoice.py", "shop/refunds.py")}
        return not ctx.run_tests_with(old)["passed"] and ctx.run_tests_with({})["passed"]

    def existing():
        c = customers.add_customer("Bo", "bo@example.com")
        o = orders.create_order(c.id, [("TEA", 2)])
        payments.capture(o.id)
        return invoice(o.id)["tax"] == 8_000 and refunds.refund(o.id)["tax"] == 8_000

    run("invoice_vat_matches_checkout", inv)
    run(CORE, refund_vat)
    run("regression_tests_fail_on_old_code", regression)
    run("no_coupon_unchanged", existing)
    return out
