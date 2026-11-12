---
name: visual-review
description: Review a rendered UI - a screen, a mockup, a built page - for visual defects the way a person sees them, by naming what the render claims about itself and turning each suspicion into a measurement, never an estimate. Use only on a task that touches UI directly (layout, spacing, a screen built or changed); skip it for non-visual work.
---

# Visual review — reading a render

How to think in front of a picture. A measuring instrument (the project's UI
driver, e.g. `playwright-cli`, or a visual-check tool the project ships) answers
questions about a render; it judges nothing. Someone has to ask the questions
and say what the numbers mean — that is this skill. Load it only when the task
is about what a screen looks like; most tasks are not.

## Start when

There is a rendered UI to judge — a screen, a mockup, a built page — and a
measuring instrument (the project's UI driver, or a visual-check tool) is
available. No render, or a non-visual task → this does not apply; a render you can
only photograph → say so and leave suspicions as questions.

## The split

- **What is not in the picture is the tool's.** An accessible name, whether a
  hidden control is still reachable, which element takes the tap, an id the
  build never renders — none of that is visible, so looking will never find it.
  Those are sweeps the instrument runs (`../qa-foundations/SKILL.md` accessibility/contract
  cases).
- **What is in the picture is yours.** Whether two things that should relate do,
  whether a group reads as one group, whether the screen still works with the
  keyboard up — those are about intent, and intent is in no element tree. You
  can see it; a script cannot.
- **You never read numbers off an image.** You are good at noticing something is
  off and bad at saying by how much; the instrument is the reverse. So every
  finding ends in a measurement you did not estimate.

The instrument differs per platform (a browser driver for web, the mobile
driver for a device); the reasoning does not. All it needs is a screenshot and a
tree of elements with their boxes and ids. Where no tree is available — a screen
you can only photograph — say so, write your suspicions as questions for the
owner with the render attached, and never promote an unmeasured guess to a
finding.

## 1. Say what you see, before you know what it should be

Write two or three sentences describing the render as someone who has never seen
the product: what you notice first, what belongs with what, what you would tap.
**Do not open the spec or the mockup yet.** This is the step most worth not
skipping: an agent that knows what it drew sees what it intended, and the
intention paints over the defect. Then read the spec or mockup and name every
difference. A difference you can explain is not a finding; one you cannot is.

## 2. Name the claims the render makes, then test them

Every render claims things about itself: *these four are one group · this
element repeats · these share a column · this is tappable and that is not.*
Write the claims down from the picture in front of you, **not from a checklist**
— a fixed list finds only what its author already met and is blind to whatever
this product does differently. For each claim: does the image keep it? Two
illustrations (not the list):

- **Repetition is the strongest claim and cheapest to test.** Anything appearing
  more than once asserts its instances are identical; the odd one out is the
  "looks off but I can't say why" defect. Compare instances against each other,
  not against page coordinates — two cards in different containers share internal
  spacing, not absolute position.
- **A group is claimed by space, not borders.** The gap between groups must be
  clearly larger than the gap inside them, or the eye merges them (a list that
  reads as a paragraph, a label that looks attached to the wrong field). There is
  no correct number — it is a comparison.

## 3. Turn each suspicion into a measurement

A suspicion is not a finding, and a number estimated from a picture is worse than
none — wrong with authority. For each doubted claim, name the elements, measure
them with the instrument, report what came back. **Measure relative to the
container, not the page**: repeated components live in different containers, so
their offsets inside their own card or row have every reason to agree and the one
that does not is the defect; reach for absolute coordinates only for things that
truly share one container. **Report the refuted ones too** — "the three titles
looked uneven; measured, all at 40px" is the evidence the pass actually ran. A
selector that matches nothing measures nothing; the tool saying so is not
agreement.

## 4. Ask what the render is not showing

One screen, one content length, one moment. What covers this at runtime that the
mockup does not draw (work it from the platform this ships on, not a list)? What
lengths will it really see — the longest real name, the empty list, the number
with four more digits, the paragraph-long error, the translation half again as
long? Say which you can answer from this render and which you cannot. One you
cannot answer is a state that should have been drawn — a finding about the state
list, not the pixels.

## What a finding looks like

The file, where in it, the claim that broke, and the number:

> `task-list-mobile-empty.png`, card block: the cards claim to be one repeated
> component, but the title in card 3 sits 19px from the edge where the other
> three sit at 16px. Measured, not estimated.

**"It feels cramped" is not a finding.** If you cannot name the claim that broke,
you are describing taste — put it under questions, or attach the render and let
the human judge.

## The honest zero

A pass that found nothing is worth something only if it could have found
something. Say which claims you tested and what you measured. Nobody is graded on
finding zero; a report of four passes and no findings, on a screen the owner then
rejects on sight, is the exact failure this skill exists to prevent. Report in
the finished-work shape (Communication, Report of finished work).
