from shop import payments, reports
from shop.customers import add_customer
from shop.orders import cancel_order, create_order


def test_cancel_paid_order_refunds_it():
    c = add_customer("Ana", "a@x")
    o = create_order(c.id, [("TEA", 2)])
    payments.capture(o.id)
    cancel_order(o.id)
    assert o.status == "cancelled" and o.refunded == o.paid and reports.revenue() == 0
