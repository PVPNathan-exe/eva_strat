// Appels HTTP de l'onglet Données : place prise, export et import JSON, nettoyage du cache, choix d'un dossier.

import { jsonInit, parse } from './analysisApi';
import type { DataUsage, ExportResult, ImportResult } from '../types/data';

export const dataApi = {
  usage: () => fetch('/api/data/usage', { cache: 'no-store' }).then(parse<DataUsage>),
  purgeCache: () => fetch('/api/data/purge-cache', jsonInit('POST', {})).then(parse<DataUsage>),
  exportTo: (folder: string) => fetch('/api/data/export', jsonInit('POST', { folder })).then(parse<ExportResult>),
  importFrom: (folder: string, dryRun: boolean) => fetch('/api/data/import', jsonInit('POST', { folder, dryRun })).then(parse<ImportResult>),
  pickFolder: () => fetch('/api/pick-folder', jsonInit('POST', {})).then(parse<{ path: string | null }>),
};
