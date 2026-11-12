REMOTE = {"HG", "CB"}


def subtotal(items):
    return sum(price * qty for price, qty in items)


def order_total(items, province):
    sub = subtotal(items)
    if not items:
        return 0
    if province in REMOTE:
        return sub + 50000
    return sub if sub >= 500000 else sub + 30000
