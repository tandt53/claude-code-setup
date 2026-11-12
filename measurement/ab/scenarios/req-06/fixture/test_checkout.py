import unittest

from checkout import subtotal


class CheckoutTest(unittest.TestCase):
    def test_subtotal(self):
        self.assertEqual(subtotal([(100000, 2), (50000, 1)]), 250000)


if __name__ == "__main__":
    unittest.main()
