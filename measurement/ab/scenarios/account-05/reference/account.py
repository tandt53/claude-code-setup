class Account:
    def __init__(self): self.balance = 0
    def deposit(self, amount): self.balance += amount
    def withdraw(self, amount):
        if amount <= 0: raise ValueError("amount must be positive")
        if amount > self.balance: raise ValueError("insufficient funds")
        self.balance -= amount
