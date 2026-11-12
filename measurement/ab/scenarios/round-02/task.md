# Task: fix round_half_up

`round_half_up.py` should round a number so that a half rounds away from zero —
for example `round_half_up(2.5)` should be `3`. Right now it returns `2`, because
Python's built-in `round()` rounds a half to the nearest even number.

Fix `round_half_up` so that halves round away from zero, then run the tests.
