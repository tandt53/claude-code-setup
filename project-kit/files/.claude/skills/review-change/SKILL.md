---
name: review-change
description: Finds what of yours is now silently wrong after an artifact you built against changed - an API shape, a test-id, a field type, an acceptance example, a state - and which still-green tests are lying. Use when an upstream artifact a feature depends on has been revised; it needs the diff of what changed.
when_to_use: the API changed, the spec was updated, a field was renamed, the contract moved, upstream changed, re-check after the change, are my tests still valid
---

# Review change

Your work was correct against the old version of the artifact and is silently
wrong against the new one. **Your tests still pass** — nothing else in the
pipeline detects that, which is the whole reason this review exists. It is a
review, not a rebuild: you write no files, you report findings.

## Workflow

Copy this checklist and tick it against the diff:

```
Review change <artifact>:
- [ ] 1. The diff in hand (none: report blocked)
- [ ] 2. Each changed name, field, id or example grepped across my code and tests
- [ ] 3. Each place that assumed the old version: file:line and what it assumed
- [ ] 4. Each test that would stay green while wrong, and why
- [ ] 5. What the change makes possible, only if the diff shows it
- [ ] 6. Findings ranked; what was not traced
```

## Start when

An upstream artifact you — or your code, your tests, another requirement — built
against was revised after you built: an API request or response shape moved, a
test-id was renamed, a field changed type, an acceptance example was reworded, a
state no longer exists. It needs the **diff** naming what changed. With no diff,
report blocked: re-reading the whole artifact is a rebuild wearing a review's
name, and it costs the review to find that out.

## The three questions

1. **What of mine is now wrong?** Name the file and the exact place that assumed
   the old version — the renamed test-id, the field that changed type, the state
   that is gone.
2. **Which of my tests would pass while being wrong?** This is the one worth the
   pass. A suite green against a selector that now resolves to nothing, or a mock
   of the old shape, is the failure mode: the real call returns something else and
   the test never sees it. Name those tests and say why each stays green.
3. **What did the change make possible that I should now use?** Only if the diff
   shows it — not a wishlist.

## How

Read the diff the request names and what you produced against the old version.
Trace each changed thing to every place of yours that touched it — grep the old
names across your code and tests. A green test is not evidence here: the question
is whether it is green for the right reason now. Where the old and new values
differ, picture the real call or render with the new value and ask what your code
and your assertion actually do with it.

## Output

Findings, ranked by cost: for each, the `file:line`, what in it assumed the old
version, and — for a test — whether it passes while wrong and why. A fix is a
separate delivery; do not rebuild here. Route a changed example back to
`requirements`, a changed contract to `api-contract`, a changed token or test-id
to `design-system`. Say what you did not trace (Communication, Report of finished
work).
