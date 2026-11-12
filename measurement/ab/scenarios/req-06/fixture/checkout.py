def subtotal(items):
    """Sum of an order's lines. items: list of (unit_price_vnd, quantity)."""
    return sum(price * qty for price, qty in items)


def order_total(items, province):
    """What the customer pays for an order, in VND. province: a two-letter code."""
    return subtotal(items)
