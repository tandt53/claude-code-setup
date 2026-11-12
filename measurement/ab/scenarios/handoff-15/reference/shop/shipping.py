"""Shipping fee in VND. Standard 30,000; free from a taxable 500,000 (inclusive);
HG and CB pay 50,000 and never ship free. Express adds 40,000, never free."""
from shop.pricing import price

REMOTE = {"HG", "CB"}


def shipping_fee(order, province, express=False):
    if province in REMOTE:
        fee = 50_000
    else:
        fee = 0 if price(order)["taxable"] >= 500_000 else 30_000
    return fee + (40_000 if express else 0)
