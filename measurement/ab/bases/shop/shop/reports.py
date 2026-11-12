"""Finance reports."""
from shop.storage import store


def revenue(orders=None):
    """Money kept: paid minus refunded, over all orders."""
    orders = store.orders.values() if orders is None else orders
    return sum(o.paid - o.refunded for o in orders)


def tax_collected():
    """VAT collected minus VAT reversed by refunds, from the event log."""
    paid_tax = 0
    from shop.orders import get_order
    from shop.pricing import price
    for kind, ev in store.events:
        if kind == "paid":
            paid_tax += price(get_order(ev["order_id"]))["tax"]
        elif kind == "refunded":
            paid_tax -= ev["tax"]
    return paid_tax
