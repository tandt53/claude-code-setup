# Task: fix the slugify bug

`slugify.py` turns a title into a URL slug. There is a bug: a title that ends
in punctuation produces a trailing hyphen. For example `slugify("Hello, World!")`
returns `"hello-world-"` instead of `"hello-world"`.

Fix `slugify` so leading and trailing hyphens never appear in the result, then
run the tests.
