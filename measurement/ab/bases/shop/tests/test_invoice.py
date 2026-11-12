from shop import payments
from shop.customers import add_customer
from shop.invoice import invoice
from shop.orders import create_order


def test_invoice_matches_checkout():
    c = add_customer("Ana", "ana@example.com")
    o = create_order(c.id, [("TEA", 1), ("MUG", 1)])
    payments.capture(o.id)
    inv = invoice(o.id)
    assert inv["lines"] == ["Green tea x1", "Mug x1"]
    assert (inv["tax"], inv["total"]) == (13_600, 183_600)
    assert inv["text"] == "Total 183,600 ₫ (VAT 13,600 ₫)"
