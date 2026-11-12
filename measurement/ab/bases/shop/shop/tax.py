"""VAT."""
from shop.money import round_money

VAT_RATE = 0.08


def tax_for(amount):
    """VAT on a taxable amount (after discounts)."""
    return round_money(amount * VAT_RATE)
