class Inventory:
    RATES = {"SAVE10": 0.10, "SAVE20": 0.20}
    def __init__(self):
        self.items = {}; self.discount = 0
    def add_item(self, name, qty, unit_price): self.items[name] = (qty, unit_price)
    def remove_item(self, name): self.items.pop(name, None)
    def apply_discount(self, code):
        if code not in self.RATES: raise ValueError(f"unknown coupon {code!r}")
        self.discount = self.RATES[code]
    def total_value(self):
        return sum(q * p for q, p in self.items.values()) * (1 - self.discount)
