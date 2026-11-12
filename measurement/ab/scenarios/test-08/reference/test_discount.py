import unittest

from discount import price_after_discount as p


class DiscountTest(unittest.TestCase):
    def test_member_at_threshold_gets_5pct(self):
        self.assertEqual(p(1_000_000, True), 950_000)

    def test_member_below_threshold(self):
        self.assertEqual(p(999_999, True), 999_999)

    def test_non_member_no_discount(self):
        self.assertEqual(p(2_000_000, False), 2_000_000)

    def test_coupon_after_member_discount(self):
        self.assertEqual(p(2_000_000, True, "WELCOME"), 1_850_000)

    def test_never_below_zero(self):
        self.assertEqual(p(10_000, False, "WELCOME"), 0)

    def test_negative_price_raises(self):
        with self.assertRaises(ValueError):
            p(-1, False)
