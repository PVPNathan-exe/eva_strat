// Registre des plans livrés avec le projet.
// Liste AUTOMATIQUEMENT toutes les images placées dans src/assets/maps/
// grâce à import.meta.glob de Vite : dépose un PNG dans ce dossier et il
// apparaît tout seul dans le menu déroulant de l'éditeur (aucun code à modifier).

const modules = import.meta.glob('../assets/maps/*.{png,jpg,jpeg,webp}', {
  eager: true,
  query: '?url',
  import: 'default',
});

export interface BuiltinMap {
  id: string; // chemin du fichier (clé unique)
  name: string; // nom lisible dérivé du nom de fichier
  src: string; // URL utilisable directement comme src d'image
}

export const builtinMaps: BuiltinMap[] = Object.entries(modules)
  .map(([path, src]) => {
    const file = path.split('/').pop()!.replace(/\.[^.]+$/, '');
    const name = file.replace(/[-_]/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
    return { id: path, name, src: src as string };
  })
  .sort((a, b) => a.name.localeCompare(b.name));
