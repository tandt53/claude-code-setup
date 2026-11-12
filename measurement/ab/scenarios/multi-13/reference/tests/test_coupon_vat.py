from shop import payments, refunds, reports
from shop.customers import add_customer
from shop.invoice import invoice
from shop.orders import create_order


def coupon_order():
    c = add_customer("Ana", "ana@example.com")
    o = create_order(c.id, [("POT", 1)], "SAVE10")
    payments.capture(o.id)
    return o


def test_invoice_vat_matches_checkout_with_coupon():
    assert invoice(coupon_order().id)["tax"] == 25_200


def test_refund_reverses_the_vat_charged():
    o = coupon_order()
    assert refunds.refund(o.id)["tax"] == 25_200
    assert reports.tax_collected() == 0
