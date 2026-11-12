class Order:
    """An order and how much of what was paid has been refunded, in VND."""

    def __init__(self, paid):
        self.paid = paid
        self.refunded = 0


def refund(order, amount=None):
    """Refund part or all of an order. Returns the amount refunded.

    With no amount, refunds whatever has not been refunded yet.
    """
    if amount is None:
        amount = order.paid - order.refunded
    if amount <= 0:
        raise ValueError("refund amount must be positive")
    order.refunded += amount
    return amount
