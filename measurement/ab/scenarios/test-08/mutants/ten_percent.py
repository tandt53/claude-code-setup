def price_after_discount(price, is_member, coupon=None):
    """Final price of an order, in VND.

    Rules:
    - Members get 5% off orders of 1,000,000 VND or more.
    - Coupon "WELCOME" takes 50,000 VND off, after the member discount.
    - The final price never goes below 0.
    - price must be 0 or more, otherwise ValueError.
    """
    if price < 0:
        raise ValueError("price must be >= 0")
    total = price
    if is_member and price >= 1_000_000:
        total = total * 0.90
    if coupon == "WELCOME":
        total -= 50_000
    return max(total, 0)
