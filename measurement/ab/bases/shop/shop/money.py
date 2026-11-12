"""Money helpers. All amounts are VND, whole dong."""


def round_money(amount):
    """Round to whole dong, half up."""
    return int(amount + 0.5) if amount >= 0 else -int(-amount + 0.5)


def fmt(amount):
    """Format for customers: 12500 -> '12,500 ₫'."""
    return f"{round_money(amount):,} ₫"
