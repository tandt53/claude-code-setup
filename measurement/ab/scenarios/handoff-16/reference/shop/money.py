"""Money helpers. VND in whole dong; USD in cents."""

DIGITS = {"VND": 0, "USD": 2}


def round_money(amount, currency="VND"):
    """Round half up to the currency's smallest unit."""
    scale = 10 ** DIGITS[currency]
    v = int(abs(amount) * scale + 0.5) / scale
    v = -v if amount < 0 else v
    return int(v) if DIGITS[currency] == 0 else v


def fmt(amount, currency="VND"):
    if currency == "USD":
        return f"${round_money(amount, 'USD'):,.2f}"
    return f"{round_money(amount):,} ₫"
