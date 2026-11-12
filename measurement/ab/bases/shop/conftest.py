import pytest

from shop.storage import store


@pytest.fixture(autouse=True)
def fresh_store():
    store.reset()
    yield
    store.reset()
