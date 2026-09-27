# How much extra target does a bail guard give a fielder?

A fair question about the bail guard: the collar is wider than the stump, so
does it make the wicket easier to hit? This is the full working behind the
short answer on the
[website FAQ](https://cricketbailguard.org/faq.html#target).

Short answer: a little, and only from a few angles. From square it adds 1.24%
in the worst case. Averaged over every direction a throw can come from, it
adds 0.03%. A stump may legally be 34.9 mm or 38.1 mm wide, and that
difference alone changes the target by 2.28%. So the worst case is about half
of what the Laws already allow between two legal wickets.

## Run it

```
python collar_target_area.py          # the table used on the website
python collar_target_area.py --all    # every case, including the checks
```

Python 3 only. No libraries needed. Every length is in millimetres.

## What "target" means here

A ball hits an object if the centre of the ball passes within one ball radius
of it. So the target is not the wicket itself. It is the outline of the wicket
made bigger in every direction by the radius of the ball, 36 mm.

The script builds that outline for a throw coming from a given direction, then
splits it into two parts: the part the stumps and bails already covered, and
the extra part the bail guard adds. Only the extra part counts.

This matters, because the collar sits on the middle stump, low down. The
stumps and the bails already cover most of what the collar would cover. Doing
the shape properly, instead of treating the collar as a rectangle, is the
difference between a right answer and one that is far too big.

## The parts and the numbers used

From the Laws of Cricket:

| | |
|---|---|
| Wicket width | 228.6 mm (9 in) |
| Stump height | 711 mm (28 in) |
| Stump diameter | 35 mm (the Laws allow 34.9 to 38.1) |
| Bail above the stumps | 12.7 mm, the most the Laws allow |
| Ball | about 72 mm across, so a radius of 36 mm |

From our own parts list:

| | |
|---|---|
| Collar | silicone hose, 44 mm inside, 5 mm wall, so 54 mm outside |
| Collar height | 15 mm, cut to weigh 14 g |
| Stopper | Danco rubber washer, 43.7 mm outside, 4.8 mm high |
| Gap between stoppers | about 95.8 mm |

Two things to be clear about:

1. The bails sit 12.7 mm above the stumps, the highest the Laws allow. The
   bails are at the top and the collar is low down, so the bails do not hide
   the collar. They only make the wicket a bigger target, which makes the
   extra a smaller share of it. So this choice helps our number a little. With
   the bails left out, the worst case is +1.49% instead of +1.24%.
2. The collar bore is 44 mm and the stump is 35 mm, so the collar can rest
   against one side instead of sitting centred. We treat that lean as square
   to the stumps, which is the worst direction. This choice works against our
   number, which is what we want.

## Results

Target seen by a throw from square, in square millimetres:

| | |
|---|---|
| Stumps only | 82,668 |
| Stumps and bails | 99,869 (the figure we use) |

How much the bail guard adds:

| Case | From square | All directions |
|---|---|---|
| Worst case: 34.9 mm stump, collar to one side | +1.24% | +0.026% |
| Normal case: 35 mm stump, collar centred | +1.17% | +0.020% |
| 35 mm stump, collar to one side | +1.22% | +0.025% |
| Thickest legal stump, 38.1 mm, centred | +0.84% | +0.013% |
| Factory made, 37.9 mm on a 34.9 mm stump, legal pair | +0.16% | +0.001% |
| Factory made, all parts 38 mm outside | +0.16% | +0.001% |
| Factory made, 1 mm wall, round, 2 g | +0.12% | +0.001% |
| Factory made, 1 mm wall, oval 60 mm wide, 14 g | +0.12% | +0.001% |
| Factory made, 0.5 mm wall, round, 1 g | +0.06% | +0.001% |

What the Laws already allow between two legal wickets:

| | |
|---|---|
| 34.9 mm stumps | 99,798 |
| 38.1 mm stumps | 102,073 |
| Difference | 2.28% |

## Why "all directions" is so much smaller

The collar only helps when the throw comes close to the line of the stumps.
From any other direction the two outside stumps are further apart, in the
view, than the collar is wide, so the collar is hidden behind them and adds
nothing at all.

| | Angle either side of the line of the stumps |
|---|---|
| Collar centred | 5.63 degrees |
| Collar resting to one side | 8.32 degrees |
| Custom made, 38 mm outside | 1.18 degrees |

Even in the worst case, 8.32 degrees out of 90 is about 9% of the directions
a throw can come from. For more than 90% of them the collar makes no
difference.

At the striker's end those directions are square leg and point. At the
bowler's end they are around mid off and mid on, which sit close to square of
those stumps.

## A near fielder gets less

A throw from close up sees the near stump as bigger, so it hides more of the
collar. What counts is where the fielder throws from, not where they were
standing, because they may run in before throwing. The figures above are for a
throw from deep. Extra width on one side:

| Distance | Extra width | Share of the deep figure |
|---|---|---|
| 2 m | 6.78 mm | 71% |
| 5 m | 8.44 mm | 89% |
| 10 m | 8.98 mm | 95% |
| 15 m | 9.15 mm | 96% |
| 30 m | 9.33 mm | 98% |

## Which side of the stumps the extra falls on

With the collar resting against one side, the extra is not shared evenly:

| | |
|---|---|
| Bowler's side | 889 sq mm |
| Keeper's side | 332 sq mm |

Both sides are usable. A fielder at square leg can hit either. The side the
collar leans towards gives more, because the rest of the collar is tucked
behind the stump.

## Factory made

The collar has to slide up the stump, so it must be wider than the stump. Ours
is a length of hose bought off the shelf. Factory made in a hard slippery
material it can have a thin wall.

On a 35 mm stump, 0.2 mm clearance each side, so a 35.4 mm bore:

| Wall | Outside | Stands out each side | From square | All directions |
|---|---|---|---|---|
| 5 mm (as built, 44 mm bore) | 54 mm | 9.5 mm | +1.22% | +0.025% |
| 2 mm | 39.4 mm | 2.2 mm | +0.26% | +0.002% |
| 1 mm | 37.4 mm | 1.2 mm | +0.12% | +0.001% |
| 0.5 mm | 36.4 mm | 0.7 mm | +0.06% | +0.001% |

The stoppers are made to the same size in each row. The stopper we buy today is
43.7 mm outside, wider than the collar bore, so a thinner collar on its own
would not help.

It can never be exactly zero. Any width past the stump is extra target, so zero
needs a collar the same size as the stump, which cannot slide.

| Collar outside, on a 35 mm stump | From square |
|---|---|
| 38 mm (1 mm gap, 1 mm wall) | +0.157% |
| 37 mm | +0.094% |
| 36 mm | +0.041% |
| 35.4 mm | +0.014% |
| 35 mm (the stump itself) | 0.000% |

## Within the legal stump width

A stump may be 34.9 mm to 38.1 mm. A collar outside 38.1 mm or less is inside
that range, so the wicket is never wider than a legal wicket can already be. A
collar is not a stump, so the Laws set no width limit for it, but this removes
the excess to argue about.

The stumps and the collar have to be specified together. A 1 mm wall collar is
`stump + gap + 2 mm` on the outside:

| Stump | Gap | Collar outside | Within 38.1 mm? |
|---|---|---|---|
| 34.9 mm | 1.0 mm | 37.9 mm | yes, 0.2 mm spare |
| 34.9 mm | 0.4 mm | 37.3 mm | yes, 0.8 mm spare |
| 35.0 mm | 1.0 mm | 38.0 mm | yes, 0.1 mm spare |
| 35.7 mm | 0.4 mm | 38.1 mm | at the limit |
| 36.0 mm | 1.0 mm | 39.0 mm | no, over by 0.9 mm |
| 38.1 mm | 1.0 mm | 41.1 mm | no, over by 3.0 mm |

With a 1 mm gap it fits a stump up to 35.1 mm, with a 0.4 mm gap up to 35.7 mm.

The pair we publish is 34.9 mm stumps with a 37.9 mm collar:

| | Target from square |
|---|---|
| Thinnest legal wicket, 34.9 mm stumps | 99,798 sq mm |
| 34.9 mm stumps with a 37.9 mm collar | 99,959 sq mm |
| Thickest legal wicket, 38.1 mm stumps | 102,073 sq mm |

That is 2,114 sq mm smaller than a wicket of the thickest legal stumps, and
0.16% above the thinnest legal wicket, where the two legal wickets differ by
2.28%.

## Where to put the weight

The collar's own weight keeps both threads taut. Our collar is 14 g. A 1 mm
silicone wall 15 mm tall is only 2 g, and reaching 14 g that way would need it
101 mm tall, which does not fit between the two stoppers.

The weight can go sideways instead. Make the collar an oval: thin towards the
bowler and the keeper, wider towards the other two stumps, which hide it.

| Width along the stumps | Weight in silicone | From square | All directions |
|---|---|---|---|
| 37.4 mm (a round collar) | 2.1 g | +0.12% | +0.001% |
| 50 mm | 8.7 g | +0.12% | +0.001% |
| 60 mm | 14.0 g | +0.12% | +0.001% |
| 70 mm | 19.3 g | +0.12% | +0.001% |

The extra target does not change at all. Checked angle by angle, the extra area
is 119 sq mm at 0 degrees and exactly 0 from 1 degree onward, at every width.

It can be 159 mm wide before it touches an outside stump. A denser material
needs less width for the same weight: 56 mm in acetal, 48 mm in PTFE.

Whatever the number is, it is the same for both teams. Both bat and both field
at the same wicket, with the same collar on it.

## The code

`collar_target_area.py`, about 250 lines, one file.

- `strip()` is the core of it. For a ball passing at a given sideways
  position, it returns the range of heights at which the ball can touch one
  rectangular part. That is where the ball radius is added, and it is added
  correctly around the corners rather than as a rectangle.
- `merge()` joins overlapping height ranges so nothing is counted twice.
- `only_in_first()` keeps the part of the bail guard's coverage that the
  stumps and bails did not already cover.
- `measure()` sweeps across the wicket in 0.02 mm steps and adds it all up.
- `average_over_all_angles()` repeats that over a quarter turn. A quarter is
  enough, because the wicket looks the same in the other three.
- `window()` gives the angle beyond which the collar is hidden.
- `share_at_distance()` gives the near fielder figures.
