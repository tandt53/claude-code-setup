import re


def slugify(text):
    """Turn a title into a URL slug: lowercase, words joined by single hyphens."""
    text = text.lower().strip()
    text = re.sub(r"[^a-z0-9]+", "-", text)
    return text
