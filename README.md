# EVA Strat

Planificateur tactique pour le jeu **EVA** (inspiré de [evabattleplan.com](https://evabattleplan.com/fr)).

En tant qu'admin tu peux :

- importer une **image de plan** d'une carte (sert de fond) ;
- **dessiner des murs** par-dessus *(à venir)* ;
- gérer plusieurs **étages** (jusqu'à 3 niveaux, reliés par ascenseurs) ;
- afficher une **vision joueur en cône** qui bute sur les murs *(à venir)* ;
- déplacer les **joueurs** entre les étages *(à venir)* ;
- **sauvegarder** la config (murs + étages) par carte — auto dans le navigateur + export/import JSON — pour ne pas tout refaire.

## Stack

- [Vite](https://vite.dev/) + React + TypeScript
- [Konva](https://konvajs.org/) / `react-konva` — canvas interactif
- [Zustand](https://github.com/pmndrs/zustand) — état global + persistance `localStorage`

## Démarrer

```bash
npm install
npm run dev      # serveur de dev (http://localhost:5173)
npm run build    # build de production
npm run preview  # prévisualiser le build
```

> Note : si `npm` échoue avec une erreur de certificat SSL (`UNABLE_TO_VERIFY_LEAF_SIGNATURE`),
> lance avec `NODE_OPTIONS=--use-system-ca`.

## Structure

```
src/
  types/map.ts          Modèle de données (cartes, étages, murs, joueurs)
  store/mapStore.ts      État global + auto-save localStorage (clé "eva_strat:maps")
  lib/storage.ts         Export/import JSON + lecture d'image en data URL
  components/
    MapCanvas.tsx        Rendu du fond de carte + murs (Konva)
    Toolbar.tsx          Gestion cartes, import image, export/import JSON
    FloorSelector.tsx    Sélecteur d'étage
  App.tsx
```

## Roadmap

- [ ] Outil de dessin de murs (polyligne) + édition/suppression
- [ ] Zones d'ascenseur reliant les étages
- [ ] Vision joueur en cône (raycasting contre les murs)
- [ ] Placement et déplacement des joueurs entre étages
