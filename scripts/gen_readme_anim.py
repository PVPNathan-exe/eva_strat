"""Génère les trois animations du README (docs/anim/*.svg) : installation, utilisation, données ; `python scripts/gen_readme_anim.py`.
Animations en CSS pur dans le SVG (une boucle, aucune image, aucun script). Les couleurs reprennent celles de src/styles/tokens.css : un SVG affiché dans un README ne peut pas lire les variables CSS du site."""

import os

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'docs', 'anim')
C = dict(bg='#0e1117', deep='#141822', surface='#1b1f2a', surface2='#232838', border='#2c3242', strong='#3a4256', text='#e6e8ee', soft='#c7ccda',
         muted='#9aa3b8', ok='#35e07a', warn='#ffd166', amber='#ffb454', orange='#ff9f1c', blue='#3d8bff', accent='#6c8cff', danger='#ff3b3b')

FONT = "font-family=\"'Segoe UI', system-ui, -apple-system, sans-serif\""


class Svg:
    def __init__(self, w, h, total, title):
        self.w, self.h, self.T, self.title = w, h, total, title
        self.css, self.body, self.n, self.names = [], [], 0, []

    def anim(self, t_in, t_out=None, dy=8, dx=0, scale=False):
        """Nom de classe d'une apparition en fondu entre t_in et t_out (fin de boucle par défaut), puis disparition avant le redémarrage."""
        self.n += 1
        name = f'a{self.n}'
        self.names.append(name)
        T = self.T
        t_out = T - 0.8 if t_out is None else t_out
        a, b, c = t_in / T * 100, (t_in + 0.5) / T * 100, t_out / T * 100
        d = min((t_out + 0.5) / T * 100, 99.9)
        hide = f'opacity:0;transform:translate({dx}px,{dy}px)'
        show = 'opacity:1;transform:translate(0,0)'
        self.css.append(f'@keyframes {name}{{0%,{a:.2f}%{{{hide}}}{b:.2f}%,{c:.2f}%{{{show}}}{d:.2f}%,100%{{{hide}}}}}.{name}{{opacity:0;animation:{name} {T}s ease-out infinite}}')
        return name

    def move(self, t0, t1, dx, dy=0, t_out=None):
        """Classe d'un élément qui apparaît à t0, glisse de (0,0) à (dx,dy) jusqu'à t1, reste, puis disparaît."""
        self.n += 1
        name = f'm{self.n}'
        self.names.append(name)
        T = self.T
        t_out = T - 0.8 if t_out is None else t_out
        a, b, c = t0 / T * 100, t1 / T * 100, t_out / T * 100
        d = min((t_out + 0.5) / T * 100, 99.9)
        self.css.append(f'@keyframes {name}{{0%,{a:.2f}%{{opacity:0;transform:translate(0,0)}}{min(a + 1.5, b):.2f}%{{opacity:1;transform:translate(0,0)}}{b:.2f}%,{c:.2f}%{{opacity:1;transform:translate({dx}px,{dy}px)}}{d:.2f}%,100%{{opacity:0;transform:translate({dx}px,{dy}px)}}}}.{name}{{opacity:0;animation:{name} {T}s ease-in-out infinite}}')
        return name

    def grow(self, t0, t1, t_out=None):
        """Classe d'une barre qui se remplit (échelle horizontale de 0 à 1) entre t0 et t1, visible jusqu'à t_out."""
        self.n += 1
        name = f'g{self.n}'
        self.names.append(name)
        T = self.T
        t_out = T - 0.8 if t_out is None else t_out
        a, b, c = t0 / T * 100, t1 / T * 100, t_out / T * 100
        d = min((t_out + 0.4) / T * 100, 99.9)
        self.css.append(f'@keyframes {name}{{0%,{a:.2f}%{{opacity:1;transform:scaleX(0)}}{b:.2f}%,{c:.2f}%{{opacity:1;transform:scaleX(1)}}{d:.2f}%,100%{{opacity:0;transform:scaleX(1)}}}}.{name}{{opacity:0;transform-box:fill-box;transform-origin:left center;animation:{name} {T}s ease-in-out infinite}}')
        return name

    def add(self, s):
        self.body.append(s)

    def text(self, x, y, s, size=14, color=None, weight=400, anchor='start', cls=''):
        self.add(f'<text x="{x}" y="{y}" font-size="{size}" fill="{color or C["text"]}" font-weight="{weight}" text-anchor="{anchor}" {FONT}{" class=%s" % chr(34) + cls + chr(34) if cls else ""}>{s}</text>')

    def render(self):
        style = ''.join(self.css)
        blink = f'@keyframes blink{{0%,49%{{opacity:1}}50%,100%{{opacity:0}}}}.cursor{{animation:blink 1s steps(1) infinite}}'
        reduce = '@media (prefers-reduced-motion: reduce){' + ','.join('.' + n for n in self.names) + '{animation:none!important;opacity:1!important;transform:none!important}.cursor{animation:none!important}}'
        return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {self.w} {self.h}" width="{self.w}" role="img" aria-label="{self.title}">'
                f'<title>{self.title}</title><style>{style}{blink}{reduce}</style>'
                f'<rect width="{self.w}" height="{self.h}" rx="10" fill="{C["deep"]}" stroke="{C["border"]}"/>' + ''.join(self.body) + '</svg>')


def badge(s, x, y, n, active=C['accent']):
    s.add(f'<circle cx="{x}" cy="{y}" r="14" fill="{active}"/><text x="{x}" y="{y + 5}" font-size="15" font-weight="700" fill="{C["bg"]}" text-anchor="middle" {FONT}>{n}</text>')


def card(s, x, y, w, h, cls, title, n, color=C['accent']):
    s.add(f'<g class="{cls}"><rect x="{x}" y="{y}" width="{w}" height="{h}" rx="8" fill="{C["surface"]}" stroke="{C["border"]}"/>')
    badge(s, x + 24, y + 26, n, color)
    s.text(x + 46, y + 32, title, 16, C['text'], 600)


# ------------------------------------------------------------------ installation
def installation():
    s = Svg(900, 360, 16, "Installation en trois étapes : installer Node.js et Python, télécharger le projet, lancer npm start")
    c1, c2 = s.anim(0.4), s.anim(3.2)
    card(s, 20, 16, 430, 130, c1, 'Installer Node.js et Python', 1)
    s.text(46, 80, 'Node.js 22 ou plus (version LTS) : nodejs.org', 13, C['soft'])
    s.text(46, 104, 'Python 3.10 ou plus : python.org, case « Add to PATH » cochée', 13, C['soft'])
    s.text(46, 128, 'ffmpeg s\'installe tout seul à l\'étape 3.', 13, C['muted'])
    s.add('</g>')
    card(s, 470, 16, 410, 130, c2, 'Télécharger le projet', 2)
    s.add(f'<g transform="translate(496,64)"><path d="M0 8 h22 l6 8 h40 v44 h-68 z" fill="{C["amber"]}"/><rect x="0" y="22" width="68" height="38" rx="3" fill="{C["orange"]}"/><rect x="30" y="24" width="8" height="30" fill="{C["bg"]}" opacity=".35"/></g>')
    s.text(584, 84, 'Sur GitHub : Code, puis Download ZIP', 13, C['soft'])
    s.text(584, 108, 'Dézippe où tu veux, par exemple', 13, C['soft'])
    s.text(584, 128, 'Documents\\eva_strat', 13, C['ok'], 600)
    s.add('</g>')

    c3 = s.anim(6.2)
    s.add(f'<g class="{c3}"><rect x="20" y="164" width="520" height="182" rx="8" fill="{C["bg"]}" stroke="{C["border"]}"/><rect x="20" y="164" width="520" height="26" rx="8" fill="{C["surface2"]}"/><text x="34" y="182" font-size="12" fill="{C["muted"]}" {FONT}>Terminal ouvert dans le dossier eva_strat (barre d\'adresse de l\'Explorateur : taper cmd)</text></g>')
    k3 = s.anim(6.2)
    s.add(f'<g class="{k3}">')
    badge(s, 566, 186, 3)
    s.text(588, 191, 'Lancer', 16, C['text'], 600)
    s.add('</g>')
    mono = "font-family=\"Consolas, 'Cascadia Mono', monospace\""
    lines = [(7.0, '&gt; npm start', C['ok']), (8.2, '[setup] dépendances npm : ok', C['soft']), (9.2, '[setup] bibliothèques Python : ok', C['soft']), (10.2, '[setup] ffmpeg : ok', C['soft']), (11.2, '[setup] démarrage : http://localhost:5173', C['warn'])]
    for i, (t, txt, col) in enumerate(lines):
        k = s.anim(t, dy=0, dx=-6)
        s.add(f'<text class="{k}" x="36" y="{222 + i * 26}" font-size="14" fill="{col}" {mono}>{txt}</text>')
    s.add(f'<g class="{s.anim(7.0, dy=0)}"><rect class="cursor" x="36" y="{222 + 5 * 26 - 12}" width="9" height="16" fill="{C["soft"]}"/></g>')

    c4 = s.anim(12.2, dy=10)
    s.add(f'<g class="{c4}"><rect x="560" y="212" width="320" height="134" rx="8" fill="{C["surface"]}" stroke="{C["strong"]}"/><rect x="560" y="212" width="320" height="24" rx="8" fill="{C["surface2"]}"/>'
          f'<circle cx="576" cy="224" r="4" fill="{C["danger"]}"/><circle cx="590" cy="224" r="4" fill="{C["warn"]}"/><circle cx="604" cy="224" r="4" fill="{C["ok"]}"/>'
          f'<text x="720" y="228" font-size="11" fill="{C["muted"]}" text-anchor="middle" {FONT}>localhost:5173</text>'
          f'<text x="576" y="262" font-size="14" font-weight="700" fill="{C["danger"]}" {FONT}>EVA Strat</text>'
          f'<g font-size="11" fill="{C["muted"]}" {FONT}><text x="650" y="262">Stratégie</text><text x="710" y="262" fill="{C["text"]}">Analyse</text><text x="765" y="262">Armes</text></g>'
          f'<rect x="576" y="278" width="288" height="52" rx="6" fill="{C["bg"]}"/><text x="720" y="309" font-size="13" fill="{C["ok"]}" text-anchor="middle" {FONT}>Le site s\'ouvre tout seul</text></g>')
    return s.render()


# ------------------------------------------------------------------ utilisation
def utilisation():
    s = Svg(900, 330, 20, "Utiliser le programme : charger une vidéo, détecter les games, vérifier les bornes, analyser, regarder le replay")
    labels = ['Charger la vidéo', 'Détecter les games', 'Vérifier les bornes', 'Analyser', 'Replay et stats']
    step = 3.6
    xs = [90 + 180 * i for i in range(5)]
    s.add(f'<line x1="{xs[0]}" y1="56" x2="{xs[-1]}" y2="56" stroke="{C["border"]}" stroke-width="3"/>')
    for i, x in enumerate(xs):
        on = s.anim(i * step + 0.3, dy=0)
        s.add(f'<circle cx="{x}" cy="56" r="22" fill="{C["surface2"]}" stroke="{C["strong"]}"/><text x="{x}" y="62" font-size="17" font-weight="700" fill="{C["muted"]}" text-anchor="middle" {FONT}>{i + 1}</text>')
        s.add(f'<g class="{on}"><circle cx="{x}" cy="56" r="22" fill="{C["accent"]}"/><text x="{x}" y="62" font-size="17" font-weight="700" fill="{C["bg"]}" text-anchor="middle" {FONT}>{i + 1}</text></g>')
        s.text(x, 106, labels[i], 14, C['soft'], 600, 'middle')
    # panneau du bas : un contenu par étape
    s.add(f'<rect x="20" y="130" width="860" height="180" rx="8" fill="{C["surface"]}" stroke="{C["border"]}"/>')

    def panel(i):
        return s.anim(i * step + 0.3, (i + 1) * step - 0.2, dy=8)

    k = panel(0)
    s.add(f'<g class="{k}"><rect x="50" y="170" width="120" height="34" rx="6" fill="{C["surface2"]}" stroke="{C["strong"]}"/><text x="110" y="192" font-size="13" fill="{C["text"]}" text-anchor="middle" {FONT}>Parcourir…</text>'
          f'<rect x="184" y="170" width="520" height="34" rx="6" fill="{C["bg"]}" stroke="{C["border"]}"/><text x="198" y="192" font-size="13" fill="{C["muted"]}" {FONT}>Colle un chemin .mp4 ou une URL YouTube</text>'
          f'<text x="50" y="250" font-size="13" fill="{C["soft"]}" {FONT}>Onglet Analyse : un fichier .mp4 de ton disque ou un lien YouTube (1080p conseillé).</text></g>')
    k = panel(1)
    s.add(f'<g class="{k}"><rect x="50" y="170" width="170" height="34" rx="6" fill="{C["ok"]}"/><text x="135" y="192" font-size="13" font-weight="700" fill="{C["bg"]}" text-anchor="middle" {FONT}>Détecter les games</text>'
          f'<text x="50" y="250" font-size="13" fill="{C["soft"]}" {FONT}>Le chrono de chaque game est lu : environ 3 minutes pour une vidéo de 83 minutes.</text></g>')
    k = panel(2)
    segs = [(50, 110), (190, 120), (340, 150), (520, 110), (660, 130)]
    bar = ''.join(f'<rect x="{x}" y="178" width="{w}" height="22" fill="{C["ok"]}"/>' for x, w in segs)
    hatch = f'<rect x="{segs[2][0] + 60}" y="178" width="30" height="22" fill="{C["orange"]}"/>'
    s.add(f'<g class="{k}"><rect x="50" y="178" width="740" height="22" fill="{C["surface2"]}"/>{bar}{hatch}'
          f'<text x="50" y="250" font-size="13" fill="{C["soft"]}" {FONT}>Les bandes orange sont les passages incertains à vérifier : déplace les bornes si besoin, puis confirme.</text></g>')
    k = panel(3)
    fill = s.grow(3 * step + 0.9, 4 * step - 0.6, t_out=4 * step - 0.2)
    s.add(f'<g class="{k}"><text x="50" y="190" font-size="13" fill="{C["soft"]}" {FONT}>Analyse détaillée : coche les games, puis « Analyser la sélection »</text>'
          f'<rect x="50" y="204" width="620" height="16" rx="8" fill="{C["bg"]}" stroke="{C["border"]}"/><rect class="{fill}" x="50" y="204" width="620" height="16" rx="8" fill="{C["accent"]}"/>'
          f'<text x="50" y="250" font-size="13" fill="{C["soft"]}" {FONT}>Options, Priorité : basse (PC fluide), normale ou haute (plus rapide si le PC est occupé).</text></g>')
    k = panel(4)
    # replay : un plan et huit joueurs qui bougent
    dots = ''
    orange = [(110, 175, 40, 25), (140, 245, 30, -30), (170, 195, -20, 40), (200, 260, 35, -20)]
    blue = [(330, 170, -45, 30), (300, 250, -30, -35), (270, 200, 25, 40), (240, 265, -25, -25)]
    for (x, y, dx, dy), (bx, by, bdx, bdy) in zip(orange, blue):
        o = s.move(4 * step + 0.4, 4 * step + 2.4, dx, dy, t_out=5 * step - 0.2)
        b = s.move(4 * step + 0.4, 4 * step + 2.4, bdx, bdy, t_out=5 * step - 0.2)
        dots += f'<circle class="{o}" cx="{x}" cy="{y}" r="7" fill="{C["orange"]}"/><circle class="{b}" cx="{bx}" cy="{by}" r="7" fill="{C["blue"]}"/>'
    s.add(f'<g class="{k}"><rect x="90" y="150" width="260" height="130" rx="6" fill="{C["bg"]}" stroke="{C["strong"]}"/>{dots}'
          f'<text x="380" y="190" font-size="13" fill="{C["soft"]}" {FONT}>Le replay rejoue les positions sur le plan,</text><text x="380" y="212" font-size="13" fill="{C["soft"]}" {FONT}>avec les kills, le score de capture et les noms.</text>'
          f'<text x="380" y="250" font-size="13" fill="{C["soft"]}" {FONT}>Onglet Armes : nomme les icônes inconnues.</text></g>')
    return s.render()


# ------------------------------------------------------------------ données
def donnees():
    s = Svg(900, 400, 18, "Réinstaller sans perdre ses données : fermer le site, copier les dossiers de données dans la nouvelle installation, relancer npm start")
    step_labels = [(0.3, '1', 'Ferme le site (ferme la fenêtre du terminal)'), (3.0, '2', 'Copie ces dossiers dans la nouvelle installation'), (10.0, '3', 'Lance « npm start » dans la nouvelle installation'), (13.0, '4', 'Vérifie : tes games sont là')]
    for i, (t, n, txt) in enumerate(step_labels):
        k = s.anim(t, dy=0, dx=-8)
        s.add(f'<g class="{k}">')
        badge(s, 38, 36 + i * 30, n)
        s.add(f'<text x="62" y="{41 + i * 30}" font-size="14" fill="{C["text"]}" {FONT}>{txt}</text></g>')
    # deux installations
    s.add(f'<rect x="20" y="170" width="400" height="210" rx="8" fill="{C["surface"]}" stroke="{C["border"]}"/><text x="36" y="196" font-size="14" font-weight="700" fill="{C["soft"]}" {FONT}>Ancienne installation</text>')
    s.add(f'<rect x="480" y="170" width="400" height="210" rx="8" fill="none" stroke="{C["strong"]}" stroke-dasharray="6 5"/><text x="496" y="196" font-size="14" font-weight="700" fill="{C["soft"]}" {FONT}>Nouvelle installation</text>')
    items = [('data', 'ta base et ton cache', C['ok']), ('analysis\\weapon_icons', 'noms et images des armes', C['accent']), ('analysis\\map_masks et map_*.json', 'si tu as fait « Appliquer »', C['amber'])]
    for i, (name, note, col) in enumerate(items):
        y = 214 + i * 54
        folder = f'<path d="M0 6 h14 l4 6 h26 v28 h-44 z" fill="{col}"/><text x="56" y="18" font-size="13" font-weight="600" fill="{C["text"]}" {FONT}>{name}</text><text x="56" y="36" font-size="12" fill="{C["muted"]}" {FONT}>{note}</text>'
        s.add(f'<g transform="translate(36,{y})" opacity=".35">{folder}</g>')
        s.add(f'<g transform="translate(36,{y})"><g class="{s.move(3.4 + i * 1.8, 6.6 + i * 1.8, 460, 0, t_out=17.2)}">{folder}</g></g>')
    done = s.anim(15.0, dy=6)
    s.add(f'<g class="{done}"><circle cx="560" cy="124" r="16" fill="{C["ok"]}"/><path d="M552 124 l6 7 l11 -14" fill="none" stroke="{C["bg"]}" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round"/><text x="588" y="129" font-size="14" fill="{C["ok"]}" {FONT}>Tes games et tes réglages sont là</text></g>')
    s.add(f'<g class="{s.anim(10.4, dy=0)}"><rect x="520" y="42" width="340" height="34" rx="6" fill="{C["bg"]}" stroke="{C["border"]}"/><text x="534" y="64" font-size="14" fill="{C["ok"]}" font-family="Consolas, monospace">&gt; npm start</text></g>')
    return s.render()


if __name__ == '__main__':
    os.makedirs(OUT, exist_ok=True)
    for name, fn in (('installation', installation), ('utilisation', utilisation), ('donnees', donnees)):
        with open(os.path.join(OUT, name + '.svg'), 'w', encoding='utf-8', newline='') as f:
            f.write(fn())
        print(name, os.path.getsize(os.path.join(OUT, name + '.svg')), 'octets')
