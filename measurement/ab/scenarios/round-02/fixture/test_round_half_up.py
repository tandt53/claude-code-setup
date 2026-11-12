import unittest

from round_half_up import round_half_up


class RoundTest(unittest.TestCase):
    def test_half_rounds_away_from_zero(self):
        # Reported bug: round() rounds half to even, so 2.5 becomes 2, not 3.
        self.assertEqual(round_half_up(2.5), 3)


if __name__ == "__main__":
    unittest.main()
