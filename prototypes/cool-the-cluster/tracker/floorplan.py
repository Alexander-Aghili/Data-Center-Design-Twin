"""Render a hall design's floor plan as inline SVG (used by explainer.html and demo/).

    python3 floorplan.py > floorplan.svg      # the tracked hall in hall_design.json
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from hall import SPEC, load_design  # noqa: E402

S = 44.0                                  # px per metre
PADX, PADY = 70, 34
H_LEN = SPEC["hall"]["hall_length_m"]     # 11.2 m along a row -> SVG y
DEPTH = 15.6                              # across rows -> SVG x
W, HT = PADX + DEPTH * S + 30, PADY + H_LEN * S + 40


def X(ym):
    return PADX + ym * S


def Y(xm):
    return PADY + xm * S


def render(ctx, containment=None, highlight=()):
    """SVG for a validated design context. highlight: rack ids to outline (tracker findings)."""
    cont = containment if containment is not None else ctx["containment"]
    out = [f'<svg viewBox="0 0 {W:.0f} {HT:.0f}" role="img" aria-label="Floor plan: six rows of racks, '
           f'hot aisles, CDUs and CRAH walls" class="fp">']
    aisles = [("cold", 0.0, None), ("hot", 2.4, 0), ("cold", 4.8, None), ("hot", 7.2, 1),
              ("cold", 9.6, None), ("hot", 12.0, 2), ("cold", 14.4, None)]
    for kind, y0, idx in aisles:
        out.append(f'<rect class="aisle-{kind}" x="{X(y0):.1f}" y="{Y(0):.1f}" width="{1.2*S:.1f}" height="{H_LEN*S:.1f}"/>')
        contained = kind == "hot" and cont[idx]
        if contained:
            out.append(f'<rect class="contain" x="{X(y0):.1f}" y="{Y(0.25):.1f}" width="{1.2*S:.1f}" height="{(H_LEN-0.5)*S:.1f}"/>')
        lbl = ("hot aisle · contained" if contained else "hot aisle · open") if kind == "hot" else "cold aisle"
        out.append(f'<text class="aisle-lbl {kind}" transform="translate({X(y0+0.6)+4:.1f},{Y(H_LEN/2):.1f}) rotate(-90)" '
                   f'text-anchor="middle">{lbl}</text>')
    for xm in (0.0, H_LEN):
        out.append(f'<line class="crah" x1="{X(0):.1f}" y1="{Y(xm):.1f}" x2="{X(DEPTH):.1f}" y2="{Y(xm):.1f}"/>')
    out.append(f'<text class="cap" x="{X(0):.1f}" y="{Y(0)-10:.1f}">CRAH wall · cool air supply</text>')
    out.append(f'<text class="cap" x="{X(0):.1f}" y="{Y(H_LEN)+22:.1f}">CRAH wall · cool air supply</text>')
    kind = {}
    for j, racks in ctx["job_racks"].items():
        for g in racks:
            kind[g] = j
    for n in ctx["spine_ids"]:
        kind[n] = "spine"
    for s in ctx["stor_ids"]:
        kind[s] = "storage"
    for (c, r) in [tuple(b) for b in SPEC["hall"]["blocked_slots"]]:
        xm = SPEC["hall"]["x_offset_m"] + 0.6 * c
        yc = SPEC["hall"]["row_center_y_m"][r]
        out.append(f'<rect class="blocked" x="{X(yc-0.6)+2:.1f}" y="{Y(xm)+1.5:.1f}" width="{1.2*S-4:.1f}" height="{0.6*S-3:.1f}"/>')
    for rid, (c, r) in ctx["pos"].items():
        xm = SPEC["hall"]["x_offset_m"] + 0.6 * c
        yc = SPEC["hall"]["row_center_y_m"][r]
        hl = " hl" if rid in highlight else ""
        out.append(f'<g class="rack k-{kind[rid]}{hl}"><rect x="{X(yc-0.6)+2:.1f}" y="{Y(xm)+1.5:.1f}" '
                   f'width="{1.2*S-4:.1f}" height="{0.6*S-3:.1f}" rx="2"/>'
                   f'<text x="{X(yc):.1f}" y="{Y(xm+0.3)+4:.1f}" text-anchor="middle">{rid}</text></g>')
    for k, cd in SPEC["cdus"].items():
        cx, cy = X(cd["y_m"]), Y(cd["x_m"])
        out.append(f'<g class="cdu"><rect x="{cx-22:.1f}" y="{cy-12:.1f}" width="44" height="24" rx="3"/>'
                   f'<text x="{cx:.1f}" y="{cy+4:.1f}" text-anchor="middle">{k}</text></g>')
    for r, yc in enumerate(SPEC["hall"]["row_center_y_m"]):
        out.append(f'<text class="cap" x="{X(yc):.1f}" y="{HT-8:.1f}" text-anchor="middle">row {r}</text>')
    out.append(f'<text class="cap" x="8" y="{Y(H_LEN/2):.1f}" transform="rotate(-90 14 {Y(H_LEN/2):.1f})" '
               f'text-anchor="middle">11.2 m along each row</text>')
    out.append("</svg>")
    return "\n".join(out)


if __name__ == "__main__":
    _, ctx = load_design()
    print(render(ctx))
