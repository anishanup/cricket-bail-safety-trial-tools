#!/usr/bin/env python
"""
How much extra target does a bail guard give a fielder?

The collar is wider than the stump, so a ball can hit the collar even when it
would have missed the stumps. This measures how much that is worth.

Method. A ball hits an object if the centre of the ball passes within one ball
radius of it. So the target is the outline of the wicket, made larger in every
direction by the radius of the ball. We build that outline for a throw coming
from any angle, then measure the part the bail guard adds and the part the
wicket already had.

    python collar_target_area.py            # the table used on the website
    python collar_target_area.py --all      # every case, including the tests

Everything is in millimetres. No libraries are needed.
"""
import argparse, math

# ---- the wicket, from the Laws of Cricket -------------------------------
WICKET_WIDTH = 228.6      # overall width of the three stumps, 9 in
STUMP_HEIGHT = 711.0      # above the ground, 28 in
STUMP_DIA = 35.0          # the Laws allow 34.9 to 38.1
BAIL_ABOVE = 12.7         # a bail may not sit more than 0.5 in above the stumps
BAIL_DIA = 13.0           # seen end on, from square
BALL_RADIUS = 36.0        # a cricket ball is about 72 mm across
LEGAL_MAX_STUMP = 38.1    # the widest stump the Laws allow, 1.5 in

# ---- the bail guard, from "Making a Bail Guard Package" ------------------
COLLAR_BORE = 44.0        # silicone hose, 44 mm inside
COLLAR_WALL = 5.0         # 4 ply wall, so 54 mm outside
COLLAR_TALL = 15.0        # cut to weigh 14 g
STOPPER_DIA = 43.7        # Danco rubber washer, 1 23/32 in outside
STOPPER_TALL = 4.8        # 3/16 in
STOPPER_GAP = 95.8        # the top stopper sits about 3 in above the collar
COLLAR_BASE = 250.0       # height of the bottom stopper; any value away from
                          # the ends gives the same answer


def strip(y, centre, half_width, z_low, z_high, r=BALL_RADIUS):
    """Heights at which a ball centred sideways at y can touch this rectangle.

    The rectangle is the flat outline of a part: a stump, a bail, the collar.
    Return (low, high), or None if the ball passes by without touching.
    """
    clear = abs(y - centre) - half_width
    if clear >= r:
        return None
    reach = r if clear <= 0 else math.sqrt(r * r - clear * clear)
    return (z_low - reach, z_high + reach)


def merge(pieces):
    """Join overlapping height ranges. Returns (total height, joined ranges)."""
    pieces = sorted(p for p in pieces if p)
    if not pieces:
        return 0.0, []
    joined = [list(pieces[0])]
    for low, high in pieces[1:]:
        if low <= joined[-1][1]:
            joined[-1][1] = max(joined[-1][1], high)
        else:
            joined.append([low, high])
    return sum(h - l for l, h in joined), joined


def only_in_first(extra, already):
    """Height covered by the bail guard that the wicket did not cover."""
    total = 0.0
    for low, high in extra:
        overlap = [(max(low, l), min(high, h)) for l, h in already
                   if min(high, h) > max(low, l)]
        total += (high - low) - merge(overlap)[0]
    return total


def measure(angle=0.0, stump_dia=STUMP_DIA, collar_outside=None, collar_lean=None,
            collar_along=None, collar_tall=None,
            stoppers=True, stopper_outside=STOPPER_DIA, bail_above=BAIL_ABOVE,
            step=0.02, by_side=False):
    """Target area of the wicket, and the extra area the bail guard adds.

    angle          0 is a throw along the line of the stumps (from square),
                   90 degrees is a throw down the pitch.
    collar_lean    how far the collar sits off centre. The bore is wider than
                   the stump, so it can rest against one side.
    collar_along   width of the collar along the line of the stumps, outside to
                   outside. Leave it out for a round collar. Set it to make an
                   oval collar: thin towards the bowler and the keeper, wider
                   towards the other two stumps, which hide it.
    Returns (wicket area, extra area) in square millimetres.
    """
    if collar_outside is None:
        collar_outside = COLLAR_BORE + 2 * COLLAR_WALL
    if collar_lean is None:
        collar_lean = max(0.0, (COLLAR_BORE - stump_dia) / 2)

    stump_r = stump_dia / 2
    outer_stump = (WICKET_WIDTH - stump_dia) / 2       # centre of the outside stumps
    sin_a, cos_a = math.sin(angle), math.cos(angle)

    # Seen from the throw, the collar leans across the line of sight by this much.
    # Leaning square to the stumps is the worst case, so that is what we use.
    collar_at = collar_lean * cos_a

    # An oval collar. Its half width across the line of sight is the projection
    # of the oval: sqrt(a^2 sin^2 + b^2 cos^2), with a along the line of the
    # stumps and b towards the bowler and the keeper.
    b_half = collar_outside / 2
    a_half = b_half if collar_along is None else collar_along / 2
    collar_half = math.sqrt((a_half * sin_a) ** 2 + (b_half * cos_a) ** 2)

    collar_low = COLLAR_BASE + STOPPER_TALL
    collar_high = collar_low + (COLLAR_TALL if collar_tall is None else collar_tall)

    wicket_area = extra_far = extra_near = 0.0
    y = -260.0
    while y < 260.0:
        wicket, guard = [], []

        for x in (-outer_stump, 0.0, outer_stump):
            piece = strip(y, -x * sin_a, stump_r, 0.0, STUMP_HEIGHT)
            if piece:
                wicket.append(piece)

        if bail_above > 0:                              # the bails, on top
            half = (WICKET_WIDTH * abs(cos_a) + BAIL_DIA * abs(sin_a)) / 2
            piece = strip(y, 0.0, half, STUMP_HEIGHT, STUMP_HEIGHT + bail_above)
            if piece:
                wicket.append(piece)

        if collar_half > stump_r:
            piece = strip(y, collar_at, collar_half, collar_low, collar_high)
            if piece:
                guard.append(piece)

        if stoppers:
            for base in (COLLAR_BASE, COLLAR_BASE + STOPPER_GAP):
                piece = strip(y, 0.0, stopper_outside / 2, base, base + STOPPER_TALL)
                if piece:
                    guard.append(piece)

        covered, wicket_ranges = merge(wicket)
        _, guard_ranges = merge(guard)
        wicket_area += covered * step
        added = only_in_first(guard_ranges, wicket_ranges) * step
        if y >= 0:
            extra_far += added
        else:
            extra_near += added
        y += step

    if by_side:
        return wicket_area, extra_far, extra_near
    return wicket_area, extra_far + extra_near


def average_over_all_angles(steps=61, step=0.2, **kw):
    """Extra area as a share of the target, averaged over every direction.

    A quarter turn is enough: the wicket looks the same in the other three.
    """
    extra = target = 0.0
    for i in range(steps):
        angle = math.pi / 2 * i / (steps - 1)
        area, added = measure(angle=angle, step=step, **kw)
        target += area
        extra += added
    return extra / target * 100


def window(collar_outside=None, stump_dia=STUMP_DIA, collar_lean=None):
    """Angle either side of the line of the stumps where the collar shows at all.

    Outside this angle the outside stumps are wider apart, in the view, than
    the collar is, so the collar is hidden and adds nothing.
    """
    if collar_outside is None:
        collar_outside = COLLAR_BORE + 2 * COLLAR_WALL
    if collar_lean is None:
        collar_lean = max(0.0, (COLLAR_BORE - stump_dia) / 2)
    outer_stump = (WICKET_WIDTH - stump_dia) / 2
    reach = collar_outside / 2 + collar_lean - stump_dia / 2
    return math.degrees(math.asin(min(1.0, reach / outer_stump)))


def share_at_distance(metres, collar_outside=None, stump_dia=STUMP_DIA):
    """Extra width a fielder gets at this distance, against a very long throw.

    A near fielder sees the nearest stump as bigger, so it hides more of the
    collar. Returns the extra width on one side, in millimetres.
    """
    if collar_outside is None:
        collar_outside = COLLAR_BORE + 2 * COLLAR_WALL
    outer_stump = (WICKET_WIDTH - stump_dia) / 2
    reach_collar = collar_outside / 2 + BALL_RADIUS
    reach_stump = stump_dia / 2 + BALL_RADIUS
    d = metres * 1000.0
    return reach_collar - reach_stump / (1 - outer_stump / d)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--all", action="store_true", help="print every case")
    args = ap.parse_args()

    print("Target seen by a throw from square, in square millimetres")
    with_bails, _ = measure(stoppers=False, collar_outside=STUMP_DIA)
    no_bails, _ = measure(stoppers=False, collar_outside=STUMP_DIA, bail_above=0)
    print(f"   stumps only            {no_bails:>9,.0f}")
    print(f"   stumps and bails       {with_bails:>9,.0f}   (the figure we use)")

    print("\nHow much the bail guard adds")
    print(f"{'':49}{'from square':>13}{'all angles':>12}")
    cases = [
        ("worst case: 34.9 mm stump, collar to one side", dict(stump_dia=34.9)),
        ("normal case: 35 mm stump, collar centred", dict(collar_lean=0.0)),
        ("35 mm stump, collar to one side", dict()),
        ("thickest legal stump, 38.1 mm, centred", dict(stump_dia=38.1, collar_lean=0.0)),
        ("factory made, 37.9 mm on a 34.9 mm stump, legal",
         dict(stump_dia=34.9, collar_outside=37.9, collar_lean=0.5,
              stopper_outside=37.9)),
        ("factory made, all parts 38 mm outside",
         dict(collar_outside=38.0, collar_lean=0.5, stopper_outside=38.0)),
        ("factory made, 1 mm wall, round, 2 g",
         dict(collar_outside=37.4, collar_lean=0.2, stopper_outside=37.4)),
        ("factory made, 1 mm wall, oval 60 mm wide, 14 g",
         dict(collar_outside=37.4, collar_along=60.0, collar_lean=0.2,
              stopper_outside=37.4)),
        ("factory made, 0.5 mm wall, round, 1 g",
         dict(collar_outside=36.4, collar_lean=0.2, stopper_outside=36.4)),
    ]
    for label, kw in cases:
        area, extra = measure(**kw)
        share = average_over_all_angles(**kw)
        print(f"   {label:<46}{extra / area * 100:>12.2f}%{share:>11.3f}%")

    print("\nWhat the Laws already allow between two legal wickets")
    thin, _ = measure(stump_dia=34.9, stoppers=False, collar_outside=34.9)
    thick, _ = measure(stump_dia=38.1, stoppers=False, collar_outside=38.1)
    print(f"   34.9 mm stumps         {thin:>9,.0f}")
    print(f"   38.1 mm stumps         {thick:>9,.0f}")
    print(f"   difference             {(thick - thin) / thin * 100:>9.2f}%")

    if not args.all:
        return

    print("\nAngle either side of the line of the stumps where the collar shows")
    print(f"   collar centred                    {window(collar_lean=0.0):>5.2f} degrees")
    print(f"   collar resting to one side        {window():>5.2f} degrees")
    print(f"   factory made, 38 mm outside       {window(collar_outside=38.0, collar_lean=0.5):>5.2f} degrees")
    print("\n   Note: a stopper is 43.7 mm outside, wider than the collar bore, so")
    print("   the factory made rows above make the stoppers to the same size too.")

    print("\nOnce fitted, treat the collar as part of the stump.")
    print("   Then the outside must stay within 38.1 mm, the widest legal stump.")
    print("   A 1 mm wall collar, so outside = stump + gap + 2 mm:")
    print(f"{'stump':>10}{'gap':>7}{'outside':>10}   within 38.1 mm?")
    for stump, gap in ((34.9, 1.0), (34.9, 0.4), (35.0, 1.0), (35.7, 0.4),
                       (36.0, 1.0), (38.1, 1.0)):
        out = stump + gap + 2.0
        verdict = (f"yes, {LEGAL_MAX_STUMP - out:.1f} mm spare" if out <= LEGAL_MAX_STUMP
                   else f"no, over by {out - LEGAL_MAX_STUMP:.1f} mm")
        print(f"{stump:>9.1f}{gap:>7.1f}{out:>10.1f}   {verdict}")
    for gap in (0.4, 1.0):
        print(f"   with a {gap:.1f} mm gap it fits a stump up to "
              f"{LEGAL_MAX_STUMP - gap - 2.0:.1f} mm")
    print("   so the stumps and the device have to be made for each other")

    print("\nAn oval collar carries weight for free")
    print("   1 mm wall towards the bowler and the keeper, and wider along the")
    print("   line of the stumps, where the other two stumps hide it.")
    print(f"{'':32}{'weight':>8}{'from square':>13}{'all angles':>12}")
    for along in (37.4, 50.0, 60.0, 70.0):
        kw = dict(collar_outside=37.4, collar_along=along, collar_lean=0.2,
                  stopper_outside=37.4)
        area, extra = measure(**kw)
        ring = math.pi * (along / 2) * (37.4 / 2) - math.pi * (35.4 / 2) ** 2
        grams = ring * COLLAR_TALL * 1.2e-3        # silicone, 1.2 g per cm3
        print(f"   {along:>5.1f} mm wide along the stumps  {grams:>6.1f} g"
              f"{extra / area * 100:>12.2f}%{average_over_all_angles(**kw):>11.3f}%")
    clear = 2 * ((WICKET_WIDTH - STUMP_DIA) / 2 - STUMP_DIA / 2)
    print(f"   it can be {clear:.0f} mm wide before it touches an outside stump")

    print("\nWhich side of the stumps the extra falls on, collar to one side")
    area, far, near = measure(by_side=True)
    print(f"   bowler's side          {far:>9,.0f} sq mm")
    print(f"   keeper's side          {near:>9,.0f} sq mm")

    print("\nA near fielder gets less, because the first stump hides more")
    for m in (2, 5, 10, 15, 30):
        w = share_at_distance(m)
        print(f"   {m:>2} m away              {w:>6.2f} mm   ({w / share_at_distance(1e6) * 100:>5.1f}%)")


if __name__ == "__main__":
    main()
