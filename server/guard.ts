// Garde-fou de l'API locale : refuse les requêtes venant d'une autre origine (CSRF depuis
// une page web quelconque) et les écritures qui ne sont pas du JSON.

export interface GuardHeaders {
  host?: string;
  origin?: string;
  'content-type'?: string;
}

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);
const hostname = (host: string) => host.replace(/:\d+$/, '').toLowerCase();

export function isAllowedRequest(method: string, headers: GuardHeaders): boolean {
  if (!headers.host || !LOCAL_HOSTS.has(hostname(headers.host))) return false;

  if (headers.origin) {
    try {
      if (new URL(headers.origin).host !== headers.host) return false;
    } catch {
      return false;
    }
  }

  if (['POST', 'PUT', 'PATCH'].includes(method)) {
    return (headers['content-type'] ?? '').toLowerCase().startsWith('application/json');
  }
  return true;
}
