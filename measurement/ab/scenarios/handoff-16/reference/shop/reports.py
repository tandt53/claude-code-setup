"""Finance reports, one currency at a time (VND by default): never add dollars to dong."""
from shop.storage import store


def revenue(orders=None, currency="VND"):
    orders = store.orders.values() if orders is None else orders
    return sum(o.paid - o.refunded for o in orders if o.currency == currency)


def tax_collected(currency="VND"):
    from shop.orders import get_order
    from shop.pricing import price
    total = 0
    for kind, ev in store.events:
        if kind not in ("paid", "refunded"):
            continue
        order = get_order(ev["order_id"])
        if order.currency != currency:
            continue
        total += price(order)["tax"] if kind == "paid" else -ev["tax"]
    return total


def revenue_by_customer(currency="VND"):
    """Revenue per customer id, in one currency (VND by default)."""
    out = {}
    for o in store.orders.values():
        if o.currency == currency:
            out[o.customer_id] = out.get(o.customer_id, 0) + o.paid - o.refunded
    return out
