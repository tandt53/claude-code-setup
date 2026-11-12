class Account:
    """A bank account that tracks a running balance."""

    def __init__(self):
        self.balance = 0

    def deposit(self, amount):
        self.balance += amount
