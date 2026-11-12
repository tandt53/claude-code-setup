class Inventory:
    """A tiny inventory: named items, each a (quantity, unit_price)."""

    def __init__(self):
        self.items = {}

    def add_item(self, name, qty, unit_price):
        self.items[name] = (qty, unit_price)

    def remove_item(self, name):
        self.items.pop(name, None)

    def total_value(self):
        return sum(qty * price for qty, price in self.items.values())
