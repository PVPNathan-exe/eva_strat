// Tableau à colonnes cliquables (tri) des vues Joueurs et Équipes, dans son propre conteneur à défilement horizontal (jamais plus large que l'écran).
// Une ligne peut être choisie (clic ou clavier sur son nom), une ligne de total ferme le tableau de détail, une dernière colonne facultative porte le lien vers la vidéo.

import type { ReactNode } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { nextSort, type SortDir } from '../../../lib/summaryFormat';
import type { Column } from './columns';

export interface SortState {
  col: string;
  dir: SortDir;
}

interface Props<T> {
  /** Nom du tableau pour les lecteurs d'écran. */
  label: string;
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T) => string | number;
  sort: SortState;
  onSort: (next: SortState) => void;
  /** Clé de la ligne choisie ; `onSelect` rend les lignes cliquables. */
  selected?: string | number | null;
  onSelect?: (key: string | number) => void;
  /** Classes de palette de la ligne (voir palRowClass). */
  rowClass?: (row: T) => string;
  /** Ligne de total : libellé, infobulle et ligne de valeurs agrégées. */
  total?: { label: string; title?: string; row: T };
  /** Dernière colonne (lien vers la vidéo) ; `openLabel` est son titre. */
  open?: (row: T) => ReactNode;
  openLabel?: string;
}

export function SortableTable<T>({ label, columns, rows, rowKey, sort, onSort, selected, onSelect, rowClass, total, open, openLabel = 'Vidéo' }: Props<T>) {
  return (
    <div className="sum__scroll" role="region" aria-label={label} tabIndex={0}>
      <table className="sum__table">
        <thead>
          <tr>
            {columns.map((c, i) => (
              <th key={c.id} scope="col" title={c.title} className={i > 0 && c.numeric ? 'sum__num' : undefined} aria-sort={sort.col === c.id ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}>
                <button type="button" className="sum__sort" onClick={() => onSort(nextSort(sort, c.id, c.numeric))}>
                  {c.label}
                  {sort.col === c.id && (sort.dir === 'asc' ? <ChevronUp className="ic" /> : <ChevronDown className="ic" />)}
                </button>
              </th>
            ))}
            {open && <th scope="col">{openLabel}</th>}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const key = rowKey(r);
            return (
              <tr key={key} className={`${rowClass?.(r) ?? ''}${selected === key ? ' is-selected' : ''}${onSelect ? ' sum__pick' : ''}`} onClick={onSelect ? () => onSelect(key) : undefined}>
                {columns.map((c, i) => {
                  const cell = c.cell(r);
                  if (i === 0) {
                    return (
                      <th key={c.id} scope="row" title={cell.title}>
                        <i className="sum__dot" aria-hidden />
                        {onSelect ? (
                          <button type="button" className="sum__name" aria-pressed={selected === key}>
                            {cell.text}
                          </button>
                        ) : (
                          cell.text
                        )}
                      </th>
                    );
                  }
                  return (
                    <td key={c.id} title={cell.title} className={c.numeric ? 'sum__num' : undefined}>
                      {cell.text}
                    </td>
                  );
                })}
                {open && <td>{open(r)}</td>}
              </tr>
            );
          })}
        </tbody>
        {total && (
          <tfoot>
            <tr className="sum__total">
              {columns.map((c, i) => {
                if (i === 0)
                  return (
                    <th key={c.id} scope="row" title={total.title}>
                      {total.label}
                    </th>
                  );
                if (c.inTotal === false) return <td key={c.id} />;
                const cell = c.cell(total.row);
                return (
                  <td key={c.id} title={cell.title} className={c.numeric ? 'sum__num' : undefined}>
                    {cell.text}
                  </td>
                );
              })}
              {open && <td />}
            </tr>
          </tfoot>
        )}
      </table>
    </div>
  );
}
