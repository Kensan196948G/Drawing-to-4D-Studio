import type { DictionaryTerm, WorkType } from '../core/types.js';
import type { ApiCase, ApiState, CasePayload, CaseSummary } from './types.js';

const TIMEOUT_MS = 12_000;

interface ApiErrorBody {
  error?: { code?: string; message?: string };
}

async function requestJson<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init.headers ?? {}) },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!response.ok) {
    let message = `HTTP ${response.status}`;
    try {
      const body = (await response.json()) as ApiErrorBody;
      message = body.error?.message ?? body.error?.code ?? message;
    } catch {
      /* noop */
    }
    throw new Error(message);
  }
  return (await response.json()) as T;
}

export class ApiClient {
  state: ApiState = 'unknown';

  async probe(): Promise<boolean> {
    try {
      const health = await requestJson<{ status: string; db?: { ok?: boolean } }>('/healthz');
      const ok = health.status === 'ok' && health.db?.ok === true;
      this.state = ok ? 'online' : 'offline';
      return ok;
    } catch {
      this.state = 'offline';
      return false;
    }
  }

  async fetchCatalog(): Promise<{ workTypes: WorkType[]; dictionary: DictionaryTerm[] } | null> {
    try {
      const [workTypes, dictionary] = await Promise.all([
        requestJson<{ workTypes: WorkType[] }>('/api/catalog/work-types'),
        requestJson<{ terms: DictionaryTerm[] }>('/api/catalog/dictionary'),
      ]);
      this.state = 'online';
      return { workTypes: workTypes.workTypes, dictionary: dictionary.terms };
    } catch {
      this.state = 'offline';
      return null;
    }
  }

  async learn(pattern: string, workTypeCode: string): Promise<{ ok: boolean; error?: string }> {
    try {
      await requestJson('/api/dictionary/learn', {
        method: 'POST',
        body: JSON.stringify({ pattern, matchType: 'exact', workTypeCode, confidence: 1 }),
      });
      return { ok: true };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  }

  async listCases(): Promise<CaseSummary[]> {
    try {
      const body = await requestJson<{ cases: CaseSummary[] }>('/api/cases');
      this.state = 'online';
      return body.cases;
    } catch {
      this.state = 'offline';
      return [];
    }
  }

  async getCase(code: string): Promise<ApiCase | null> {
    try {
      const body = await requestJson<{ case: ApiCase }>(`/api/cases/${encodeURIComponent(code)}`);
      return body.case;
    } catch {
      return null;
    }
  }

  async putCase(
    code: string,
    payload: CasePayload,
  ): Promise<{ ok: true; revision: number } | { ok: false; error: string }> {
    try {
      const body = await requestJson<{ case: { revision: number } }>(`/api/cases/${encodeURIComponent(code)}`, {
        method: 'PUT',
        body: JSON.stringify(payload),
      });
      return { ok: true, revision: body.case.revision };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  }
}
