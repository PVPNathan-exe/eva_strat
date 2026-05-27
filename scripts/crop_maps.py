"""Rogne les minimaps EVA Strat et uniformise les marqueurs A-E.

Sortie dans src/assets/maps/cropped/. Les originaux ne sont pas modifies.
Les boites de rognage sont affinees iterativement (relire la sortie -> ajuster).
"""
import os
from PIL import Image

SRC = os.path.join("src", "assets", "maps")
OUT = os.path.join(SRC, "cropped")
os.makedirs(OUT, exist_ok=True)

# Boite de rognage (left, top, right, bottom) ; None = copie telle quelle.
CROP = {
    "Horizon.png": None,
    "Outlaw.jpg": (35, 430, 1405, 1800),
    "Engine.png": (230, 55, 1652, 870),
    "Atlantis.png": (295, 115, 1612, 832),
    "Lunar_Outpost.png": (410, 20, 2271, 1008),
    "Helios_Station.png": (45, 270, 1035, 790),
    "Artefact.png": (115, 180, 965, 850),
    "Polaris.png": (40, 215, 1040, 800),
    "Silva.png": (130, 195, 955, 845),
    "The_Cliff.png": (40, 250, 1040, 805),
    "Ceres.png": (40, 243, 1040, 778),
}

# Images dont le marqueur central "A" (et autres) est jaune/dore : on desature
# vers du gris. Restreint a la zone centrale (fractions L,T,R,B de l'image rognee)
# pour ne PAS toucher les zones de spawn orange/jaune des bords.
RECOLOR_CENTER = {
    "Silva.png": (0.40, 0.30, 0.60, 0.70),
    "Ceres.png": (0.40, 0.25, 0.60, 0.75),
    "The_Cliff.png": (0.40, 0.05, 0.60, 0.45),
    "Polaris.png": (0.42, 0.30, 0.58, 0.70),
    "Artefact.png": (0.42, 0.30, 0.58, 0.70),
    "Helios_Station.png": (0.42, 0.35, 0.58, 0.65),
    "Artefact.png": (0.42, 0.30, 0.58, 0.70),
}


def is_yellow(r, g, b):
    """Jaune/dore du marqueur (fill clair ET bordure doree sombre).

    Test relatif : R et G nettement au-dessus du B (teinte jaune), ce qui attrape
    aussi les pixels olive sombres de la bordure. Les marqueurs verts (R faible) et
    le sol gris (R~G~B) ne sont pas touches."""
    return (g - b) > 20 and (r - b) > 15 and b < 170


def desaturate_center(img, frac):
    img = img.convert("RGB")
    w, h = img.size
    l = int(frac[0] * w); t = int(frac[1] * h)
    rr = int(frac[2] * w); bb = int(frac[3] * h)
    px = img.load()
    n = 0
    for y in range(t, bb):
        for x in range(l, rr):
            r, g, b = px[x, y]
            if is_yellow(r, g, b):
                lum = int(0.299 * r + 0.587 * g + 0.114 * b)
                px[x, y] = (lum, lum, lum)
                n += 1
    return img, n


def main():
    for name, box in CROP.items():
        src_path = os.path.join(SRC, name)
        if not os.path.exists(src_path):
            print(f"SKIP (introuvable): {name}")
            continue
        img = Image.open(src_path)
        if box is not None:
            img = img.crop(box)
        recolored = 0
        if name in RECOLOR_CENTER:
            img, recolored = desaturate_center(img, RECOLOR_CENTER[name])
        out_path = os.path.join(OUT, name)
        img.save(out_path)
        print(f"OK {name} -> {img.size}  (pixels recolores: {recolored})")


if __name__ == "__main__":
    main()
