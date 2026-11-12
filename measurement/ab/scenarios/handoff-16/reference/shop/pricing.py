from shop.catalog import unit_price
from shop.money import round_money
from shop.tax import tax_for

COUPONS = {"SAVE10": 0.10, "SAVE20": 0.20}


def subtotal(lines, currency="VND"):
    return round_money(sum(unit_price(sku, currency) * qty for sku, qty in lines), currency)


def discount(amount, coupon, currency="VND"):
    if coupon is None:
        return 0
    if coupon not in COUPONS:
        raise ValueError(f"unknown coupon {coupon!r}")
    return round_money(amount * COUPONS[coupon], currency)


def price(order):
    cur = order.currency
    sub = subtotal(order.lines, cur)
    disc = discount(sub, order.coupon, cur)
    taxable = round_money(sub - disc, cur)
    tax = tax_for(taxable, cur)
    return {"subtotal": sub, "discount": disc, "taxable": taxable, "tax": tax,
            "total": round_money(taxable + tax, cur)}
