from shop import payments, reports
from shop.customers import add_customer
from shop.orders import create_order
from shop.storage import store


def test_usd_order_rounds_to_cents_and_reports_apart():
    c = add_customer("Al", "al@example.com")
    o = create_order(c.id, [("MUG", 1)], "SAVE10", currency="USD")
    assert payments.capture(o.id) == 4.86
    assert "$4.86" in store.outbox[-1][1]
    assert reports.revenue() == 0 and reports.revenue(currency="USD") == 4.86
