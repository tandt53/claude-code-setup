"""Products for sale, by SKU."""

PRODUCTS = {
    "TEA": {"name": "Green tea", "price": 50_000},
    "MUG": {"name": "Mug", "price": 120_000},
    "POT": {"name": "Teapot", "price": 350_000},
}


def unit_price(sku):
    if sku not in PRODUCTS:
        raise KeyError(f"unknown SKU {sku!r}")
    return PRODUCTS[sku]["price"]
