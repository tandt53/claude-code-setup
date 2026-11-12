import unittest

from config import parse_config


class ConfigTest(unittest.TestCase):
    def test_basic(self):
        self.assertEqual(parse_config("a=1\nb=2"), {"a": "1", "b": "2"})


if __name__ == "__main__":
    unittest.main()
