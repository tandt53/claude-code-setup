# Task spec: references

Read when the spec skill points here.

## When the expected result is unclear

Where no one can state the exact result, find another reference:
- **current behaviour**, recorded before changing it (characterization tests)
- **another implementation**, old or reference, run on the same inputs
  (differential testing)
- **properties that must always hold**: totals never negative,
  decode(encode(x)) = x, the product of the factors equals the input
  (property-based testing)
- **how outputs must relate** when inputs change in a known way: adding an
  item never lowers the total (metamorphic testing)
- **existing code, docs or tickets** that already answer the question
- **agreed criteria**, for a comparison or a choice
- **a quick draft** the user can look at and judge

Name the reference chosen in the spec. If none exists, say so: the work will
be reported `[unverified: no reference]`, never done.

## Decision records

A decision that is expensive to reverse, or that later work will build on,
also gets a short record: context, decision, consequences, alternatives
rejected and why. It goes in the decision records place (Places,
Defaults). When the project
has no folder for them yet, propose the default location and wait: write no
record and no folder until the user agrees. Once they agree, add that
location to CLAUDE.md, so the question is not asked again. Records are only
added, never edited: a decision that replaces an earlier one gets a new
record pointing back. They outlive the spec, which describes one task.
