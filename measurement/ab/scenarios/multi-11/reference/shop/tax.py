from shop.money import round_money

VAT_RATE = 0.08


def tax_for(amount, currency="VND"):
    return round_money(amount * VAT_RATE, currency)
