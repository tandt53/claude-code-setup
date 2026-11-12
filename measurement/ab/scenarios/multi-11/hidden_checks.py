"""Hidden checks for multi-11, one per point of spec.md. Never shown to the agent.
USD amounts may be floats, Decimals or integer cents: all three are accepted."""

CORE = "reports_never_mix_currencies"


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
    pricing = ctx.imp("shop.pricing")
    out = {}

    def run(name, fn):
        store.reset()
        try:
            out[name] = bool(fn())
        except Exception:
            out[name] = False

    def usd_order(lines=(("MUG", 1),), coupon=None):
        c = customers.add_customer("Al", "al@example.com")
        return orders.create_order(c.id, list(lines), coupon, currency="USD")

    def priced():
        p = pricing.price(usd_order(coupon="SAVE10"))
        return usd(p["discount"], 0.50) and usd(p["tax"], 0.36) and usd(p["total"], 4.86)

    def paid_usd():
        o = usd_order()
        return usd(payments.capture(o.id), 5.40) and usd(o.paid, 5.40)

    def message():
        o = usd_order()
        payments.capture(o.id)
        return "$5.40" in store.outbox[-1][1] and "₫" not in store.outbox[-1][1]

    def reports_ok():
        c = customers.add_customer("Ana", "ana@example.com")
        v = orders.create_order(c.id, [("TEA", 2)])
        payments.capture(v.id)
        u = usd_order()
        payments.capture(u.id)
        rev, tax = reports.revenue(), reports.tax_collected()
        if isinstance(rev, dict):
            return rev.get("VND") == 108_000 and usd(rev.get("USD"), 5.40) and \
                (not isinstance(tax, dict) or (tax.get("VND") == 8_000 and usd(tax.get("USD"), 0.40)))
        return rev == 108_000 and (tax == 8_000 or (isinstance(tax, dict) and tax.get("VND") == 8_000))

    def refund_usd():
        o = usd_order()
        payments.capture(o.id)
        try:  # twice what was paid, in whatever unit the run stores (dollars or cents)
            refunds.refund(o.id, o.paid * 2)
            return False
        except ValueError:
            pass
        r = refunds.refund(o.id)
        return usd(r["amount"], 5.40) and usd(r["tax"], 0.40)

    def vnd_unchanged():
        c = customers.add_customer("Ana", "ana@example.com")
        o = orders.create_order(c.id, [("POT", 1)], "SAVE10")
        return pricing.price(o)["total"] == 340_200 and payments.capture(o.id) == 340_200 \
            and store.outbox[-1][1].endswith("340,200 ₫ for order O2.") and ctx.run_tests_with({})["passed"]

    run("usd_order_priced_in_cents", priced)
    run("usd_capture", paid_usd)
    run("usd_message_format", message)
    run(CORE, reports_ok)
    run("usd_refund_capped_and_rounded", refund_usd)
    run("vnd_and_existing_tests_unchanged", vnd_unchanged)
    return out
