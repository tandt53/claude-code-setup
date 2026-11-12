from shop import notifications
from shop.money import round_money
from shop.orders import get_order
from shop.pricing import price
from shop.storage import store


def refund(order_id, amount=None):
    """Refund part or all of what was paid. Returns {'amount', 'tax'}:
    the money returned and the VAT inside it, which finance reverses."""
    order = get_order(order_id)
    if order.status not in ("paid", "partially_refunded"):
        raise ValueError(f"order {order_id} cannot be refunded: {order.status}")
    remaining = order.paid - order.refunded
    if amount is None:
        amount = remaining
    if amount <= 0 or amount > remaining:
        raise ValueError(f"refund must be between 1 and {remaining}")
    p = price(order)
    tax = round_money(p["tax"] * amount / p["total"])
    order.refunded += amount
    order.status = "refunded" if order.refunded == order.paid else "partially_refunded"
    store.emit("refunded", order_id=order_id, amount=amount, tax=tax)
    notifications.send(order.customer_id, "refunded", amount=amount, order_id=order_id)
    return {"amount": amount, "tax": tax}
