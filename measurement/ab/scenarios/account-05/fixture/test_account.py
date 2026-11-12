import unittest

from account import Account


class AccountTest(unittest.TestCase):
    def test_deposit(self):
        acc = Account()
        acc.deposit(100)
        acc.deposit(50)
        self.assertEqual(acc.balance, 150)


if __name__ == "__main__":
    unittest.main()
