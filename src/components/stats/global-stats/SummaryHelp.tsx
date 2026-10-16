// Explication des colonnes des vues Joueurs et Équipes (repliée par défaut). Dit ce qui est une borne, une convention ou une valeur non établie.

interface Props {
  kind: 'joueurs' | 'équipes';
}

export function SummaryHelp({ kind }: Props) {
  const players = kind === 'joueurs';
  return (
    <details className="help">
      <summary>Comment lire les {kind}</summary>
      <p className="help__body">
        Chaque ligne du tableau du haut cumule {players ? 'toutes les games du joueur' : "toutes les games de l'équipe"} dans l'étendue choisie ; la colonne <b>Games</b> dit combien de games portent les chiffres
        (« 8 sur 10 » : 8 games avec un bilan calculé sur 10). Un clic sur un nom {players ? 'de joueur' : "d'équipe"} affiche dessous le détail game par game, avec un total en pied de tableau. Un clic sur
        un titre de colonne trie ; une valeur absente reste toujours en bas.
      </p>
      <p className="help__body">
        <b>Secondaires utilisés</b> : « possible » est une <b>borne haute</b> calculée par délai de gadget. Elle n'est établie qu'avec assez de cycles de recharge observés, sinon la case dit « non établi » (jamais 0) ;
        un total n'additionne jamais « possible » en partie : dès qu'une game ne l'établit pas, le total ne l'établit pas non plus. Mourir avec le secondaire disponible est mauvais ; le garder sans mourir ne l'est pas en soi.
        {players && (
          <>
            {' '}
            <b>Vitesse</b> : la moyenne est pondérée par le temps vivant (tyroliennes et sauts exclus) ; la vitesse max est le <b>98e centile</b> (médiane par game dans le tableau global), et non le maximum brut,
            qui peut contenir des erreurs de lecture.
          </>
        )}
      </p>
      <p className="help__body">
        <b>Duels</b>
        {players ? ' et notes des kills' : ''} : ce sont des <b>conventions</b> de calcul, sans vérité terrain. La part de duels gagnés est gagnés sur (gagnés + perdus) ; les duels « autres » n'ont pas de vainqueur net ; sous
        le nombre de games minimal donné par le serveur, la part n'est pas montrée. {players ? '' : 'Les changements de point sont ceux de la carte (aucun sur Engine). '}
        Le <b>score de capture final</b> est la dernière lecture du pourcentage de chaque équipe : ce n'est <b>pas un résultat de match</b>. Le vainqueur d'une game n'est pas renseigné dans la base, donc aucune
        victoire ni défaite n'est affichée. « n/d » : le bilan de la game ou du chiffre n'est pas calculé (lancer <code>npm run stats -- --all</code>).
      </p>
    </details>
  );
}
