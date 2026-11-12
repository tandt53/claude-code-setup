import unittest

from slugify import slugify


class SlugifyTest(unittest.TestCase):
    def test_punctuation_no_trailing_dash(self):
        # Reported bug: a title ending in punctuation leaves a trailing hyphen.
        self.assertEqual(slugify("Hello, World!"), "hello-world")


if __name__ == "__main__":
    unittest.main()
