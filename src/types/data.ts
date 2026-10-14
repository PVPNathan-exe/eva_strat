// Réponses des routes /api/data (voir server/dataTools.ts et analysis/data_usage.py, data_export.py).

export interface DataUsage {
  db_path: string;
  cache_path: string;
  db_bytes: number;
  db_journal_bytes: number;
  backups: { name: string; bytes: number }[];
  eval_cache_bytes: number;
  downloaded_videos: { name: string; bytes: number }[];
  cache_other_bytes: number;
  icons_bytes: number;
  /** Phrase d'avertissement si la base est sur une clé USB ou un disque réseau. */
  warning: string | null;
  games?: number;
  games_with_positions?: number;
  sample_rows?: number;
  /** Estimation : base entière divisée par le nombre de games lues. */
  bytes_per_analysed_game?: number | null;
  purged?: { files: number; bytes: number };
}

export interface ExportResult {
  games: number;
  files_written: number;
  files_unchanged: number;
  bytes: number;
  icons_without_image: number;
  /** Fichiers de games présents dans le dossier mais plus dans la base (laissés en place). */
  orphans: string[];
}

export interface ImportResult {
  imported: number;
  skipped: number;
  rows: Record<string, number>;
  icons_created: number;
  missing_videos: string[];
  dry_run: boolean;
  /** Copie de la base faite avant l'import. */
  backup?: string;
}
