# Offline Check-in (Android) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Credenciar participantes (check-in + crachá impresso por USB) em celulares Android sem depender de rede, sincronizando com o BFF quando houver conexão, com inscrição na hora pelo operador.

**Architecture:** Estado do evento (inscritos, fila de operações, configurações) vive em memória num `CheckinStore` persistido em MMKV por evento. Um `SyncEngine` faz pull periódico de `eventSignups` (merge monotônico) e push FIFO da outbox (`checkinSignup`/`manualSignup`) por um `CheckinTransport` injetável. Impressão usa o módulo nativo `modules/tspl-usb-printer` (já existe, do spike) com o crachá renderizado em RN e capturado em PNG.

**Tech Stack:** Expo SDK 57, expo-router, TypeScript strict, `react-native-mmkv` 4 (+ `react-native-nitro-modules`), `@react-native-community/netinfo`, `expo-crypto`, Apollo Client 3, `react-native-view-shot`, `react-native-qrcode-svg`, Jest (`jest-expo`) + `@testing-library/react-native` 14. BFF: Node/Babel, Apollo Server, Vitest.

**Spec:** `docs/superpowers/specs/2026-09-12-offline-checkin-design.md`

## Global Constraints

- Repos: BFF em `../hub-community-bff` (Task 1); app em `hub-community-mobile` (Tasks 2+). Branch do app: `feat/offline-checkin`, criada a partir de `spike/usb-tspl-print` (o módulo nativo já está lá).
- Tudo que está em `src/app/` vira rota (expo-router). Telas ficam em `src/components/` ou `src/features/`; testes nunca dentro de `src/app/`.
- RNTL 14: `await render(...)` sempre. Apollo `MockedProvider` exige `__typename` nos mocks.
- Nenhuma dependência de plataforma (MMKV, NetInfo, módulo nativo, `captureRef`) pode ser importada por código puro de `src/features/**`: recebem por injeção (interfaces `KeyValueStorage`, `Connectivity`, `CheckinTransport`, `PrinterModule`). Adaptadores concretos ficam em arquivos `*-adapter.ts` / `*.native.ts` que os testes não importam.
- Copy em pt-BR, exatamente como na spec: "Carregar evento", "Sincronizar agora", "Imprimir e credenciar", "Credenciar sem imprimir", "Reimprimir", "Inscrever na hora", "Nenhum evento encontrado.", "já inscrito".
- Commit: mensagem em inglês, trailer `Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>` + `Claude-Session: https://claude.ai/code/session_013kzutpVkXSUeFLP5MdYw97`.
- Antes de cada commit: `pnpm exec tsc --noEmit && pnpm lint && pnpm test` (app) ou `npx vitest run && npx eslint <arquivos tocados>` (BFF).

---

## File map

**BFF (`hub-community-bff`)**
- Modify `src/dataSources/eventando-manager/signup/index.js` — `findSignupById`.
- Modify `src/types/Checkin.graphql` — `checkinSignup(..., checkedInAt: String)`.
- Modify `src/resolvers/Checkin/index.js` — check-in idempotente.
- Modify `src/resolvers/Checkin/index.test.js`.

**App (`hub-community-mobile`)**
- `src/features/checkin/types.ts` — tipos do domínio (LocalSignup, OutboxItem, EventCache, ServerSignup, EventSettings).
- `src/features/checkin/merge.ts` — `mergeSignups`, `normalize`, `matchesSearch`.
- `src/features/checkin/store.ts` — `CheckinStore` (memória + `KeyValueStorage`), `useCheckinStore`, `useEventCache`.
- `src/features/checkin/store-provider.tsx` — contexto + adapter MMKV.
- `src/features/checkin/transport.ts` — `CheckinTransport` sobre Apollo; `NetworkError`.
- `src/features/checkin/outbox.ts` — `processOutbox`.
- `src/features/checkin/sync.ts` — `SyncEngine`, `Connectivity`.
- `src/features/checkin/netinfo-adapter.ts` — `Connectivity` via NetInfo.
- `src/features/checkin/use-sync.ts` — hook que liga SyncEngine à tela.
- `src/features/printer/printer-prefs.ts` — impressora selecionada + parâmetros de etiqueta (storage).
- `src/features/printer/printer-errors.ts` — mensagens amigáveis.
- `src/features/printer/use-printer.ts` — dispositivos, seleção, permissão.
- `src/features/printer/use-print-badge.tsx` — renderiza `BadgeLabel` offscreen, captura e imprime.
- `src/components/checkin/status-bar.tsx`, `signup-row.tsx`, `checkin-sheet.tsx`, `walkin-form.tsx`, `checkin-screen.tsx`, `event-settings-screen.tsx`, `events-home.tsx`.
- `src/app/index.tsx` (home), `src/app/checkin/[slug]/index.tsx`, `src/app/checkin/[slug]/settings.tsx`.
- `src/lib/queries.ts` — `EVENT_SIGNUPS`, `CHECKIN_SIGNUP`, `MANUAL_SIGNUP`, `EVENT_BATCHES`.
- Remove `src/app/print-test.tsx`; update `CLAUDE.md`.

---

### Task 1: BFF — `checkinSignup` idempotente com `checkedInAt`

**Files:**
- Modify: `src/dataSources/eventando-manager/signup/index.js`
- Modify: `src/types/Checkin.graphql`
- Modify: `src/resolvers/Checkin/index.js` (mutation `checkinSignup`)
- Test: `src/resolvers/Checkin/index.test.js`

**Interfaces:**
- Produces: `checkinSignup(eventSlug: String!, signupId: String!, checkedInAt: String): CheckinResponse`. Já credenciado → `success: true`, sem PUT, sem publish. `checkedInAt` inválido/ausente → `new Date().toISOString()`.
- Datasource: `eventandoIntegration.findSignupById(signupId) → { data: rawSignup } | null`.

- [ ] **Step 1: Escrever os testes que falham**

Em `src/resolvers/Checkin/index.test.js`, dentro de `makeDataSources`, adicione ao objeto `eventandoIntegration`:

```js
    findSignupById: vi.fn().mockResolvedValue({ data: rawSignups[0] }),
```

E substitua o bloco `describe('checkinSignup', ...)` por:

```js
describe('checkinSignup', () => {
  it('returns and publishes the signup with the resolved name', async () => {
    const dataSources = makeDataSources({ users: [{ email: 'ana@x.io', name: 'Ana Souza' }] });
    const out = await Checkin.Mutation.checkinSignup(null, { eventSlug: 'ev', signupId: 's1' }, { dataSources });
    expect(out.success).toBe(true);
    expect(out.signup.name).toBe('Ana Souza');
    expect(dataSources.managerIntegration.findUsersByEmails).toHaveBeenCalledWith(['ana@x.io']);
    expect(pubsub.publish).toHaveBeenCalledTimes(1);
  });

  it('stores the checkedInAt sent by the device', async () => {
    const dataSources = makeDataSources();
    await Checkin.Mutation.checkinSignup(
      null,
      { eventSlug: 'ev', signupId: 's1', checkedInAt: '2026-09-12T08:15:00.000Z' },
      { dataSources },
    );
    expect(dataSources.eventandoIntegration.updateSignup).toHaveBeenCalledWith('s1', {
      checked_in: true,
      checked_in_at: '2026-09-12T08:15:00.000Z',
    });
  });

  it('falls back to now when checkedInAt is not a valid date', async () => {
    const dataSources = makeDataSources();
    await Checkin.Mutation.checkinSignup(null, { eventSlug: 'ev', signupId: 's1', checkedInAt: 'ontem' }, { dataSources });
    const [, data] = dataSources.eventandoIntegration.updateSignup.mock.calls[0];
    expect(Number.isNaN(Date.parse(data.checked_in_at))).toBe(false);
  });

  it('is idempotent: an already checked-in signup is returned without overwriting', async () => {
    const dataSources = makeDataSources();
    dataSources.eventandoIntegration.findSignupById.mockResolvedValue({
      data: { ...rawSignups[0], checked_in: true, checked_in_at: '2026-09-12T07:00:00.000Z' },
    });
    const out = await Checkin.Mutation.checkinSignup(
      null,
      { eventSlug: 'ev', signupId: 's1', checkedInAt: '2026-09-12T09:00:00.000Z' },
      { dataSources },
    );
    expect(out.success).toBe(true);
    expect(out.signup.checked_in_at).toBe('2026-09-12T07:00:00.000Z');
    expect(dataSources.eventandoIntegration.updateSignup).not.toHaveBeenCalled();
    expect(pubsub.publish).not.toHaveBeenCalled();
  });

  it('reports a missing signup', async () => {
    const dataSources = makeDataSources();
    dataSources.eventandoIntegration.findSignupById.mockResolvedValue(null);
    const out = await Checkin.Mutation.checkinSignup(null, { eventSlug: 'ev', signupId: 'nope' }, { dataSources });
    expect(out).toEqual({ success: false, message: 'Inscrição não encontrada.', signup: null });
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `cd ../hub-community-bff && npx vitest run src/resolvers/Checkin/index.test.js`
Expected: FAIL — `checkedInAt` ignorado (`checked_in_at` é `now`), idempotência chama `updateSignup`, `findSignupById` nunca é chamado.

- [ ] **Step 3: Datasource `findSignupById`**

Em `src/dataSources/eventando-manager/signup/index.js`, logo antes de `const updateSignup`:

```js
// One signup by documentId; resolves null when Eventando answers 404.
const findSignupById = async (signupId, headers) => {
  try {
    return await fetch(`/signups/${signupId}`, 'GET', headers);
  } catch (err) {
    if (/not found/i.test(err.message)) return null;
    throw err;
  }
};
```

E no objeto exportado (ao lado de `updateSignup`):

```js
  findSignupById: (signupId) => findSignupById(signupId, headers),
```

- [ ] **Step 4: Schema**

Em `src/types/Checkin.graphql`:

```graphql
  "checkedInAt: when the device did the check-in (ISO); defaults to now. Already checked-in signups are returned unchanged."
  checkinSignup(eventSlug: String!, signupId: String!, checkedInAt: String): CheckinResponse
```

- [ ] **Step 5: Resolver**

Em `src/resolvers/Checkin/index.js`, substitua o corpo de `checkinSignup` até o `// 2. Build the signup object` por:

```js
    checkinSignup: async (_, { eventSlug, signupId, checkedInAt }, { dataSources }) => {
      try {
        // 0. Idempotent: a signup that is already checked in keeps its original time
        //    (several devices may sync the same person; the first one wins).
        const existing = (await dataSources.eventandoIntegration.findSignupById(signupId))?.data;
        if (!existing) {
          return { success: false, message: 'Inscrição não encontrada.', signup: null };
        }
        if (existing.checked_in) {
          const [signupData] = withUserNames(
            [mapSignup(existing)],
            await resolveUsers(dataSources, [existing.email]),
          );
          return { success: true, message: 'Check-in já realizado.', signup: signupData };
        }

        // 1. Update signup in Eventando Manager
        const parsed = Date.parse(checkedInAt || '');
        const checkedInAtIso = Number.isNaN(parsed) ? new Date().toISOString() : new Date(parsed).toISOString();
        const updateResponse = await dataSources.eventandoIntegration.updateSignup(
          signupId,
          { checked_in: true, checked_in_at: checkedInAtIso },
        );

        const updatedSignup = updateResponse?.data;

        if (!updatedSignup) {
          return {
            success: false,
            message: 'Inscrição não encontrada.',
            signup: null,
          };
        }
```

O restante da função (passo 2 e 3, `return { success: true, ... }`, `catch`) fica igual. Confira que `mapSignup` já copia `checked_in`/`checked_in_at` do raw (ver `mappers.js`); se não copiar, use `{ ...mapSignup(existing), checked_in: true, checked_in_at: existing.checked_in_at }`.

- [ ] **Step 6: Rodar e ver passar**

Run: `npx vitest run src/resolvers/Checkin/index.test.js && npx vitest run && npx eslint src/resolvers/Checkin/index.js src/dataSources/eventando-manager/signup/index.js src/resolvers/Checkin/index.test.js`
Expected: todos os testes passam (100+5). ESLint: só erros pré-existentes (não introduza novos; se `max-len` reclamar das suas linhas, quebre-as).

- [ ] **Step 7: Boot smoke + commit + PR**

Run: `npx babel ./src --out-dir build --copy-files >/dev/null && (PORT=4999 node build/index.js & sleep 4; curl -s localhost:4999/graphql -H 'content-type: application/json' -d '{"query":"{ __type(name:\"Mutation\"){ fields { name args { name } } } }"}' | grep -o '"checkedInAt"'; kill %1)`
Expected: imprime `"checkedInAt"`.

```bash
git checkout -b feat/idempotent-checkin
git add src/dataSources/eventando-manager/signup/index.js src/types/Checkin.graphql src/resolvers/Checkin/index.js src/resolvers/Checkin/index.test.js
git commit -m "Make checkinSignup idempotent and accept the device's checkedInAt

Several phones will sync check-ins offline; the first check-in of a signup
must win and keep its real time instead of being overwritten by later syncs."
git push -u origin feat/idempotent-checkin
gh pr create --repo reactivandoio/hub-community-bff --title "Idempotent checkinSignup with checkedInAt" --body "..."
```

---

### Task 2: App — tipos, `mergeSignups` e busca

**Files:**
- Create: `src/features/checkin/types.ts`
- Create: `src/features/checkin/merge.ts`
- Test: `src/features/checkin/__tests__/merge.test.ts`

**Interfaces:**
- Produces:
  ```ts
  // types.ts
  export const LOCAL_ID_PREFIX = 'local:';
  export const isLocalId = (id: string) => id.startsWith(LOCAL_ID_PREFIX);
  export interface ServerSignup { id: string; name: string; email?: string | null; phone_number?: string | null; checked_in?: boolean | null; checked_in_at?: string | null; product_name?: string | null }
  export interface LocalSignup { id; name; email?; phone_number?; product_name?; checked_in: boolean; checked_in_at?: string | null; source: 'server' | 'walkin'; printed_at?: string }
  export interface WalkinInput { name: string; email: string; phone_number?: string }
  export type OutboxItem = CheckinItem | WalkinItem  (campos comuns: id, kind, createdAt, attempts, nextAttemptAt?, lastError?, failed?)
  export interface EventSettings { logoText: string; link: string; batchId: string }
  export interface EventCache { slug; title; loadedAt; lastPullAt?; signups: LocalSignup[]; outbox: OutboxItem[]; settings: EventSettings }
  export const DEFAULT_SETTINGS: EventSettings = { logoText: 'COMUNIDADE', link: 'https://hubcommunity.io', batchId: '' };
  // merge.ts
  export function mergeSignups(local: LocalSignup[], server: ServerSignup[]): LocalSignup[]
  export function normalize(text: string): string  // sem acento, minúsculo, trim
  export function matchesSearch(signup: LocalSignup, query: string): boolean
  ```

- [ ] **Step 1: Criar a branch e instalar dependências**

```bash
git checkout spike/usb-tspl-print && git checkout -b feat/offline-checkin
pnpm exec expo install react-native-mmkv react-native-nitro-modules @react-native-community/netinfo expo-crypto
```

- [ ] **Step 2: Escrever `types.ts`** (sem teste — só tipos)

```ts
// Domain types for offline check-in. Everything here is plain data that is
// serialised to MMKV as JSON, so keep it free of classes and Dates.

export const LOCAL_ID_PREFIX = 'local:';
export const isLocalId = (id: string): boolean => id.startsWith(LOCAL_ID_PREFIX);

/** EventSignup as the BFF returns it. */
export interface ServerSignup {
  id: string;
  name: string;
  email?: string | null;
  phone_number?: string | null;
  checked_in?: boolean | null;
  checked_in_at?: string | null;
  product_name?: string | null;
}

export interface LocalSignup {
  /** Server id, or `local:<uuid>` until a walk-in is synced. */
  id: string;
  name: string;
  email?: string | null;
  phone_number?: string | null;
  product_name?: string | null;
  checked_in: boolean;
  checked_in_at?: string | null;
  source: 'server' | 'walkin';
  /** Last badge printed on this device (ISO). */
  printed_at?: string;
}

export interface WalkinInput {
  name: string;
  email: string;
  phone_number?: string;
}

interface OutboxBase {
  id: string;
  createdAt: string;
  attempts: number;
  /** Do not retry before this instant (ISO). */
  nextAttemptAt?: string;
  lastError?: string;
  /** Business failure (`success: false`); waits for the operator. */
  failed?: true;
}
export interface CheckinItem extends OutboxBase {
  kind: 'checkin';
  signupId: string;
  checkedInAt: string;
}
export interface WalkinItem extends OutboxBase {
  kind: 'walkin';
  localId: string;
  input: WalkinInput;
  batchId: string;
}
export type OutboxItem = CheckinItem | WalkinItem;

export interface EventSettings {
  logoText: string;
  link: string;
  batchId: string;
}
export const DEFAULT_SETTINGS: EventSettings = {
  logoText: 'COMUNIDADE',
  link: 'https://hubcommunity.io',
  batchId: '',
};

export interface EventCache {
  slug: string;
  title: string;
  loadedAt: string;
  lastPullAt?: string;
  signups: LocalSignup[];
  outbox: OutboxItem[];
  settings: EventSettings;
}
```

- [ ] **Step 3: Teste de `merge.ts`**

`src/features/checkin/__tests__/merge.test.ts`:

```ts
import { matchesSearch, mergeSignups, normalize } from '../merge';
import type { LocalSignup, ServerSignup } from '../types';

const server = (over: Partial<ServerSignup> & { id: string }): ServerSignup => ({ name: 'X', ...over });
const local = (over: Partial<LocalSignup> & { id: string }): LocalSignup => ({
  name: 'X',
  checked_in: false,
  source: 'server',
  ...over,
});

describe('mergeSignups', () => {
  it('adds signups that only exist on the server', () => {
    const out = mergeSignups([], [server({ id: '1', name: 'Ana', checked_in: false })]);
    expect(out).toEqual([{ id: '1', name: 'Ana', email: undefined, phone_number: undefined, product_name: undefined, checked_in: false, checked_in_at: undefined, source: 'server' }]);
  });

  it('takes server data but keeps a local check-in and its time', () => {
    const out = mergeSignups(
      [local({ id: '1', name: 'old', checked_in: true, checked_in_at: '2026-09-12T08:00:00.000Z', printed_at: 'p' })],
      [server({ id: '1', name: 'Ana Souza', email: 'a@x.io', checked_in: false })],
    );
    expect(out[0]).toMatchObject({ name: 'Ana Souza', email: 'a@x.io', checked_in: true, checked_in_at: '2026-09-12T08:00:00.000Z', printed_at: 'p' });
  });

  it('takes the server check-in when the local one is not checked in', () => {
    const out = mergeSignups(
      [local({ id: '1', checked_in: false })],
      [server({ id: '1', checked_in: true, checked_in_at: '2026-09-12T09:00:00.000Z' })],
    );
    expect(out[0]).toMatchObject({ checked_in: true, checked_in_at: '2026-09-12T09:00:00.000Z' });
  });

  it('drops server signups that disappeared, keeps unresolved walk-ins', () => {
    const out = mergeSignups(
      [local({ id: 'gone' }), local({ id: 'local:abc', source: 'walkin', name: 'Walk In' })],
      [server({ id: '2' })],
    );
    expect(out.map((s) => s.id)).toEqual(['2', 'local:abc']);
  });

  it('keeps server order', () => {
    const out = mergeSignups([], [server({ id: 'b' }), server({ id: 'a' })]);
    expect(out.map((s) => s.id)).toEqual(['b', 'a']);
  });
});

describe('normalize / matchesSearch', () => {
  it('strips accents and case', () => {
    expect(normalize('  José Ção ')).toBe('jose cao');
  });

  it('matches on name or email, empty query matches everything', () => {
    const s = local({ id: '1', name: 'José Ção', email: 'jose@x.io' });
    expect(matchesSearch(s, 'cao')).toBe(true);
    expect(matchesSearch(s, 'JOSE@')).toBe(true);
    expect(matchesSearch(s, 'maria')).toBe(false);
    expect(matchesSearch(s, '')).toBe(true);
  });
});
```

- [ ] **Step 4: Rodar e ver falhar**

Run: `pnpm test -- src/features/checkin`
Expected: FAIL — `Cannot find module '../merge'`.

- [ ] **Step 5: Implementar `merge.ts`**

```ts
import type { LocalSignup, ServerSignup } from './types';
import { isLocalId } from './types';

const fromServer = (s: ServerSignup): LocalSignup => ({
  id: s.id,
  name: s.name,
  email: s.email ?? undefined,
  phone_number: s.phone_number ?? undefined,
  product_name: s.product_name ?? undefined,
  checked_in: Boolean(s.checked_in),
  checked_in_at: s.checked_in_at ?? undefined,
  source: 'server',
});

/**
 * Server list wins for data; check-in is monotonic (local OR server) and a local
 * check-in keeps its own time. Server signups missing from `server` are dropped;
 * unsynced walk-ins (`local:` ids) are kept at the end.
 */
export function mergeSignups(local: LocalSignup[], server: ServerSignup[]): LocalSignup[] {
  const byId = new Map(local.map((s) => [s.id, s]));
  const merged = server.map((raw) => {
    const next = fromServer(raw);
    const prev = byId.get(raw.id);
    if (!prev) return next;
    return {
      ...next,
      checked_in: prev.checked_in || next.checked_in,
      checked_in_at: prev.checked_in ? prev.checked_in_at : next.checked_in_at,
      printed_at: prev.printed_at,
      source: prev.source,
    };
  });
  const walkins = local.filter((s) => isLocalId(s.id));
  return [...merged, ...walkins];
}

export const normalize = (text: string): string =>
  text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim();

export function matchesSearch(signup: LocalSignup, query: string): boolean {
  const q = normalize(query);
  if (!q) return true;
  return normalize(signup.name).includes(q) || normalize(signup.email ?? '').includes(q);
}
```

- [ ] **Step 6: Rodar e ver passar**

Run: `pnpm test -- src/features/checkin`
Expected: PASS (7 testes).

- [ ] **Step 7: Commit**

```bash
git add package.json pnpm-lock.yaml src/features/checkin/types.ts src/features/checkin/merge.ts src/features/checkin/__tests__/merge.test.ts
git commit -m "Add check-in domain types and signup merge rules"
```

---

### Task 3: `CheckinStore` (memória + `KeyValueStorage`)

**Files:**
- Create: `src/features/checkin/store.ts`
- Test: `src/features/checkin/__tests__/store.test.ts`

**Interfaces:**
- Consumes: Task 2 types, `mergeSignups`.
- Produces:
  ```ts
  export interface KeyValueStorage { getString(key: string): string | undefined; set(key: string, value: string): void; delete(key: string): void }
  export class MemoryStorage implements KeyValueStorage  // para testes
  export interface StoreDeps { storage: KeyValueStorage; now?: () => string; uuid?: () => string }
  export class CheckinStore {
    constructor(deps: StoreDeps)
    subscribe(listener: () => void): () => void
    getEvent(slug): EventCache | undefined
    listEvents(): { slug; title; loadedAt; lastPullAt? }[]
    loadEvent(slug, title, server: ServerSignup[]): EventCache      // carga inicial / recarga
    applyPull(slug, server: ServerSignup[]): void                   // merge + lastPullAt
    checkIn(slug, signupId, opts?: { enqueue?: boolean }): void     // no-op se já checked_in
    markPrinted(slug, signupId): void
    addWalkin(slug, input: WalkinInput): LocalSignup                // cria local + enfileira walkin (+ nada de checkin; a tela chama checkIn depois)
    resolveWalkin(slug, localId, server: ServerSignup): void        // remapeia id no signup e na outbox
    outboxSucceeded(slug, itemId): void
    outboxFailed(slug, itemId, error: string, opts: { permanent: boolean }): void  // transient: attempts++, nextAttemptAt = now + backoff(attempts) (5s, 15s, 60s, 60s...)
    retryOutboxItem(slug, itemId): void      // limpa failed/nextAttemptAt
    discardOutboxItem(slug, itemId): void
    updateSettings(slug, patch: Partial<EventSettings>): void
    removeEvent(slug): void
  }
  ```
  Chaves: `checkin:index` = JSON `string[]` de slugs; `checkin:<slug>` = JSON `EventCache`. Toda mutação persiste e notifica listeners.

- [ ] **Step 1: Testes**

`src/features/checkin/__tests__/store.test.ts`:

```ts
import { CheckinStore, MemoryStorage } from '../store';
import type { ServerSignup } from '../types';

const server: ServerSignup[] = [
  { id: 's1', name: 'Ana', email: 'ana@x.io', checked_in: false },
  { id: 's2', name: 'Bia', email: 'bia@x.io', checked_in: true, checked_in_at: '2026-09-12T07:00:00.000Z' },
];

const make = () => {
  const storage = new MemoryStorage();
  let tick = 0;
  const store = new CheckinStore({
    storage,
    now: () => `2026-09-12T10:00:0${tick++}.000Z`,
    uuid: () => 'uuid-1',
  });
  return { storage, store };
};

describe('CheckinStore', () => {
  it('loads an event, lists it and persists it', () => {
    const { store, storage } = make();
    store.loadEvent('ev', 'Evento', server);
    expect(store.getEvent('ev')?.signups.map((s) => s.id)).toEqual(['s1', 's2']);
    expect(store.listEvents()).toEqual([{ slug: 'ev', title: 'Evento', loadedAt: '2026-09-12T10:00:00.000Z', lastPullAt: '2026-09-12T10:00:00.000Z' }]);
    expect(JSON.parse(storage.getString('checkin:ev')!).title).toBe('Evento');
  });

  it('rehydrates from storage', () => {
    const { store, storage } = make();
    store.loadEvent('ev', 'Evento', server);
    const again = new CheckinStore({ storage });
    expect(again.getEvent('ev')?.signups).toHaveLength(2);
    expect(again.listEvents()[0].slug).toBe('ev');
  });

  it('checks in once and enqueues one checkin item', () => {
    const { store } = make();
    store.loadEvent('ev', 'Evento', server);
    store.checkIn('ev', 's1');
    store.checkIn('ev', 's1');
    const ev = store.getEvent('ev')!;
    expect(ev.signups[0]).toMatchObject({ checked_in: true, checked_in_at: '2026-09-12T10:00:01.000Z' });
    expect(ev.outbox).toEqual([
      { id: 'uuid-1', kind: 'checkin', signupId: 's1', checkedInAt: '2026-09-12T10:00:01.000Z', createdAt: '2026-09-12T10:00:01.000Z', attempts: 0 },
    ]);
  });

  it('can check in without enqueueing', () => {
    const { store } = make();
    store.loadEvent('ev', 'Evento', server);
    store.checkIn('ev', 's1', { enqueue: false });
    expect(store.getEvent('ev')!.outbox).toEqual([]);
  });

  it('adds a walk-in as a local signup and enqueues it', () => {
    const { store } = make();
    store.loadEvent('ev', 'Evento', server);
    store.updateSettings('ev', { batchId: '7' });
    const created = store.addWalkin('ev', { name: 'Caio', email: 'caio@x.io', phone_number: '62' });
    expect(created).toMatchObject({ id: 'local:uuid-1', name: 'Caio', source: 'walkin', checked_in: false });
    const ev = store.getEvent('ev')!;
    expect(ev.signups.at(-1)?.id).toBe('local:uuid-1');
    expect(ev.outbox[0]).toMatchObject({ kind: 'walkin', localId: 'local:uuid-1', batchId: '7', input: { name: 'Caio', email: 'caio@x.io', phone_number: '62' } });
  });

  it('resolves a walk-in: remaps the signup id and pending outbox items', () => {
    const { store } = make();
    store.loadEvent('ev', 'Evento', server);
    const created = store.addWalkin('ev', { name: 'Caio', email: 'caio@x.io' });
    store.checkIn('ev', created.id);
    store.resolveWalkin('ev', created.id, { id: 's9', name: 'Caio Melo', email: 'caio@x.io', product_name: 'Lote 1' });
    const ev = store.getEvent('ev')!;
    expect(ev.signups.find((s) => s.id === 's9')).toMatchObject({ name: 'Caio Melo', product_name: 'Lote 1', checked_in: true, source: 'walkin' });
    expect(ev.signups.some((s) => s.id === created.id)).toBe(false);
    const checkin = ev.outbox.find((i) => i.kind === 'checkin');
    expect(checkin).toMatchObject({ signupId: 's9' });
  });

  it('merges a pull without losing local check-ins', () => {
    const { store } = make();
    store.loadEvent('ev', 'Evento', server);
    store.checkIn('ev', 's1');
    store.applyPull('ev', [{ id: 's1', name: 'Ana Souza', checked_in: false }, { id: 's3', name: 'Dan' }]);
    const ev = store.getEvent('ev')!;
    expect(ev.signups.map((s) => s.id)).toEqual(['s1', 's3']);
    expect(ev.signups[0]).toMatchObject({ name: 'Ana Souza', checked_in: true });
    expect(ev.lastPullAt).toBe('2026-09-12T10:00:03.000Z');
  });

  it('tracks outbox failures with backoff, retry and discard', () => {
    const { store } = make();
    store.loadEvent('ev', 'Evento', server);
    store.checkIn('ev', 's1');
    const [item] = store.getEvent('ev')!.outbox;
    store.outboxFailed('ev', item.id, 'timeout', { permanent: false });
    expect(store.getEvent('ev')!.outbox[0]).toMatchObject({ attempts: 1, lastError: 'timeout', nextAttemptAt: '2026-09-12T10:00:07.000Z' });
    store.outboxFailed('ev', item.id, 'bad email', { permanent: true });
    expect(store.getEvent('ev')!.outbox[0]).toMatchObject({ failed: true, lastError: 'bad email' });
    store.retryOutboxItem('ev', item.id);
    expect(store.getEvent('ev')!.outbox[0].failed).toBeUndefined();
    expect(store.getEvent('ev')!.outbox[0].nextAttemptAt).toBeUndefined();
    store.discardOutboxItem('ev', item.id);
    expect(store.getEvent('ev')!.outbox).toEqual([]);
  });

  it('removes done items and notifies subscribers', () => {
    const { store } = make();
    const listener = jest.fn();
    store.subscribe(listener);
    store.loadEvent('ev', 'Evento', server);
    store.checkIn('ev', 's1');
    const [item] = store.getEvent('ev')!.outbox;
    store.outboxSucceeded('ev', item.id);
    expect(store.getEvent('ev')!.outbox).toEqual([]);
    expect(listener).toHaveBeenCalledTimes(3);
  });

  it('marks printed and removes events', () => {
    const { store, storage } = make();
    store.loadEvent('ev', 'Evento', server);
    store.markPrinted('ev', 's2');
    expect(store.getEvent('ev')!.signups[1].printed_at).toBe('2026-09-12T10:00:01.000Z');
    store.removeEvent('ev');
    expect(store.getEvent('ev')).toBeUndefined();
    expect(storage.getString('checkin:ev')).toBeUndefined();
    expect(store.listEvents()).toEqual([]);
  });
});
```

Nota sobre o backoff no teste "tracks outbox failures": `now()` na chamada de `outboxFailed` é `…10:00:02` (loadEvent=00, checkIn=01, outboxFailed=02) e o backoff da 1ª tentativa é 5 s → `10:00:07`.

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm test -- src/features/checkin/__tests__/store.test.ts`
Expected: FAIL — `Cannot find module '../store'`.

- [ ] **Step 3: Implementar `store.ts`**

```ts
import { mergeSignups } from './merge';
import {
  DEFAULT_SETTINGS,
  LOCAL_ID_PREFIX,
  type EventCache,
  type EventSettings,
  type LocalSignup,
  type OutboxItem,
  type ServerSignup,
  type WalkinInput,
} from './types';

export interface KeyValueStorage {
  getString(key: string): string | undefined;
  set(key: string, value: string): void;
  delete(key: string): void;
}

/** In-memory storage for tests. */
export class MemoryStorage implements KeyValueStorage {
  private map = new Map<string, string>();
  getString(key: string) {
    return this.map.get(key);
  }
  set(key: string, value: string) {
    this.map.set(key, value);
  }
  delete(key: string) {
    this.map.delete(key);
  }
}

export interface StoreDeps {
  storage: KeyValueStorage;
  now?: () => string;
  uuid?: () => string;
}

export interface EventSummary {
  slug: string;
  title: string;
  loadedAt: string;
  lastPullAt?: string;
}

const INDEX_KEY = 'checkin:index';
const eventKey = (slug: string) => `checkin:${slug}`;
const BACKOFF_SECONDS = [5, 15, 60];

const addSeconds = (iso: string, seconds: number) => new Date(Date.parse(iso) + seconds * 1000).toISOString();

const defaultUuid = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

/**
 * Holds every loaded event in memory, persists each one as JSON under
 * `checkin:<slug>` and notifies subscribers after every mutation
 * (compatible with useSyncExternalStore).
 */
export class CheckinStore {
  private events = new Map<string, EventCache>();
  private listeners = new Set<() => void>();
  private storage: KeyValueStorage;
  private now: () => string;
  private uuid: () => string;

  constructor({ storage, now, uuid }: StoreDeps) {
    this.storage = storage;
    this.now = now ?? (() => new Date().toISOString());
    this.uuid = uuid ?? defaultUuid;
    this.rehydrate();
  }

  private rehydrate() {
    const slugs: string[] = JSON.parse(this.storage.getString(INDEX_KEY) ?? '[]');
    for (const slug of slugs) {
      const raw = this.storage.getString(eventKey(slug));
      if (raw) this.events.set(slug, JSON.parse(raw));
    }
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  getEvent(slug: string): EventCache | undefined {
    return this.events.get(slug);
  }

  listEvents(): EventSummary[] {
    return [...this.events.values()].map(({ slug, title, loadedAt, lastPullAt }) => ({ slug, title, loadedAt, lastPullAt }));
  }

  loadEvent(slug: string, title: string, server: ServerSignup[]): EventCache {
    const prev = this.events.get(slug);
    const now = this.now();
    const next: EventCache = {
      slug,
      title,
      loadedAt: now,
      lastPullAt: now,
      signups: mergeSignups(prev?.signups ?? [], server),
      outbox: prev?.outbox ?? [],
      settings: prev?.settings ?? { ...DEFAULT_SETTINGS },
    };
    this.commit(next);
    return next;
  }

  applyPull(slug: string, server: ServerSignup[]) {
    this.update(slug, (ev) => ({ ...ev, signups: mergeSignups(ev.signups, server), lastPullAt: this.now() }));
  }

  checkIn(slug: string, signupId: string, opts: { enqueue?: boolean } = {}) {
    const ev = this.events.get(slug);
    const signup = ev?.signups.find((s) => s.id === signupId);
    if (!ev || !signup || signup.checked_in) return;
    const now = this.now();
    const outbox = opts.enqueue === false
      ? ev.outbox
      : [...ev.outbox, { id: this.uuid(), kind: 'checkin' as const, signupId, checkedInAt: now, createdAt: now, attempts: 0 }];
    this.commit({
      ...ev,
      signups: ev.signups.map((s) => (s.id === signupId ? { ...s, checked_in: true, checked_in_at: now } : s)),
      outbox,
    });
  }

  markPrinted(slug: string, signupId: string) {
    const now = this.now();
    this.update(slug, (ev) => ({
      ...ev,
      signups: ev.signups.map((s) => (s.id === signupId ? { ...s, printed_at: now } : s)),
    }));
  }

  addWalkin(slug: string, input: WalkinInput): LocalSignup {
    const ev = this.requireEvent(slug);
    const now = this.now();
    const localId = `${LOCAL_ID_PREFIX}${this.uuid()}`;
    const signup: LocalSignup = {
      id: localId,
      name: input.name,
      email: input.email,
      phone_number: input.phone_number,
      checked_in: false,
      source: 'walkin',
    };
    this.commit({
      ...ev,
      signups: [...ev.signups, signup],
      outbox: [...ev.outbox, { id: this.uuid(), kind: 'walkin', localId, input, batchId: ev.settings.batchId, createdAt: now, attempts: 0 }],
    });
    return signup;
  }

  resolveWalkin(slug: string, localId: string, server: ServerSignup) {
    this.update(slug, (ev) => ({
      ...ev,
      signups: ev.signups
        .filter((s) => s.id !== server.id || s.id === localId)
        .map((s) =>
          s.id === localId
            ? {
                ...s,
                id: server.id,
                name: server.name,
                email: server.email ?? s.email,
                phone_number: server.phone_number ?? s.phone_number,
                product_name: server.product_name ?? undefined,
                checked_in: s.checked_in || Boolean(server.checked_in),
              }
            : s,
        ),
      outbox: ev.outbox.map((item) => (item.kind === 'checkin' && item.signupId === localId ? { ...item, signupId: server.id } : item)),
    }));
  }

  outboxSucceeded(slug: string, itemId: string) {
    this.update(slug, (ev) => ({ ...ev, outbox: ev.outbox.filter((i) => i.id !== itemId) }));
  }

  outboxFailed(slug: string, itemId: string, error: string, { permanent }: { permanent: boolean }) {
    const now = this.now();
    this.update(slug, (ev) => ({
      ...ev,
      outbox: ev.outbox.map((item): OutboxItem => {
        if (item.id !== itemId) return item;
        if (permanent) return { ...item, lastError: error, failed: true, nextAttemptAt: undefined };
        const attempts = item.attempts + 1;
        const backoff = BACKOFF_SECONDS[Math.min(attempts, BACKOFF_SECONDS.length) - 1];
        return { ...item, attempts, lastError: error, nextAttemptAt: addSeconds(now, backoff) };
      }),
    }));
  }

  retryOutboxItem(slug: string, itemId: string) {
    this.update(slug, (ev) => ({
      ...ev,
      outbox: ev.outbox.map((item) => (item.id === itemId ? { ...item, failed: undefined, nextAttemptAt: undefined, attempts: 0 } : item)),
    }));
  }

  discardOutboxItem(slug: string, itemId: string) {
    this.update(slug, (ev) => ({ ...ev, outbox: ev.outbox.filter((i) => i.id !== itemId) }));
  }

  updateSettings(slug: string, patch: Partial<EventSettings>) {
    this.update(slug, (ev) => ({ ...ev, settings: { ...ev.settings, ...patch } }));
  }

  removeEvent(slug: string) {
    this.events.delete(slug);
    this.storage.delete(eventKey(slug));
    this.persistIndex();
    this.notify();
  }

  private requireEvent(slug: string): EventCache {
    const ev = this.events.get(slug);
    if (!ev) throw new Error(`Evento não carregado: ${slug}`);
    return ev;
  }

  private update(slug: string, fn: (ev: EventCache) => EventCache) {
    const ev = this.events.get(slug);
    if (ev) this.commit(fn(ev));
  }

  private commit(ev: EventCache) {
    const isNew = !this.events.has(ev.slug);
    this.events.set(ev.slug, ev);
    this.storage.set(eventKey(ev.slug), JSON.stringify(ev));
    if (isNew) this.persistIndex();
    this.notify();
  }

  private persistIndex() {
    this.storage.set(INDEX_KEY, JSON.stringify([...this.events.keys()]));
  }

  private notify() {
    this.listeners.forEach((l) => l());
  }
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `pnpm test -- src/features/checkin`
Expected: PASS. Se o teste "removes done items and notifies" divergir na contagem de chamadas, conte: loadEvent (1), checkIn (2), outboxSucceeded (3) → 3. Ajuste a implementação, não o teste.

- [ ] **Step 5: Commit**

```bash
git add src/features/checkin/store.ts src/features/checkin/__tests__/store.test.ts
git commit -m "Add CheckinStore: in-memory event cache persisted per event"
```

---

### Task 4: Outbox — `processOutbox`

**Files:**
- Create: `src/features/checkin/transport.ts` (só a interface + `NetworkError` nesta task; a implementação Apollo vem na Task 5)
- Create: `src/features/checkin/outbox.ts`
- Test: `src/features/checkin/__tests__/outbox.test.ts`

**Interfaces:**
- Produces:
  ```ts
  // transport.ts
  export interface MutationResult { success: boolean; message?: string | null; signup?: ServerSignup | null }
  export interface CheckinTransport {
    fetchSignups(eventSlug: string): Promise<ServerSignup[]>;
    checkin(eventSlug: string, signupId: string, checkedInAt: string): Promise<MutationResult>;
    walkin(eventSlug: string, batchId: string, input: WalkinInput): Promise<MutationResult>;
  }
  export class NetworkError extends Error { name = 'NetworkError' }
  // outbox.ts
  export interface OutboxReport { sent: number; failed: number; blocked: number; stoppedByNetwork: boolean }
  export function processOutbox(store: CheckinStore, slug: string, transport: CheckinTransport, now?: () => string): Promise<OutboxReport>
  ```
  Regras: percorre a outbox em ordem; pula `failed` e itens com `nextAttemptAt > now` (contam como `blocked`); `checkin` com `signupId` local é `blocked`; `walkin` sem `batchId` → falha permanente "Selecione o lote nas configurações"; `success:false` → `outboxFailed(permanent)`; `NetworkError` → `outboxFailed(transient)` e **para** (`stoppedByNetwork`); outro erro → `outboxFailed(permanent, message)`. Sucesso de `walkin` com `signup` → `resolveWalkin` antes de `outboxSucceeded`; sem `signup` → falha permanente "Servidor não devolveu a inscrição".

- [ ] **Step 1: Testes**

`src/features/checkin/__tests__/outbox.test.ts`:

```ts
import { processOutbox } from '../outbox';
import { CheckinStore, MemoryStorage } from '../store';
import { NetworkError, type CheckinTransport } from '../transport';

const make = (nowIso = '2026-09-12T10:00:00.000Z') => {
  let n = 0;
  const store = new CheckinStore({ storage: new MemoryStorage(), now: () => nowIso, uuid: () => `u${++n}` });
  store.loadEvent('ev', 'Evento', [{ id: 's1', name: 'Ana' }]);
  store.updateSettings('ev', { batchId: '7' });
  const transport: jest.Mocked<CheckinTransport> = {
    fetchSignups: jest.fn(),
    checkin: jest.fn().mockResolvedValue({ success: true }),
    walkin: jest.fn().mockResolvedValue({ success: true, signup: { id: 's9', name: 'Caio' } }),
  };
  return { store, transport };
};

describe('processOutbox', () => {
  it('sends check-ins in order and removes them', async () => {
    const { store, transport } = make();
    store.checkIn('ev', 's1');
    const report = await processOutbox(store, 'ev', transport);
    expect(transport.checkin).toHaveBeenCalledWith('ev', 's1', '2026-09-12T10:00:00.000Z');
    expect(store.getEvent('ev')!.outbox).toEqual([]);
    expect(report).toEqual({ sent: 1, failed: 0, blocked: 0, stoppedByNetwork: false });
  });

  it('resolves a walk-in then sends its check-in with the server id', async () => {
    const { store, transport } = make();
    const w = store.addWalkin('ev', { name: 'Caio', email: 'c@x.io' });
    store.checkIn('ev', w.id);
    const report = await processOutbox(store, 'ev', transport);
    expect(transport.walkin).toHaveBeenCalledWith('ev', '7', { name: 'Caio', email: 'c@x.io' });
    expect(transport.checkin).toHaveBeenCalledWith('ev', 's9', '2026-09-12T10:00:00.000Z');
    expect(report.sent).toBe(2);
    expect(store.getEvent('ev')!.signups.find((s) => s.id === 's9')?.checked_in).toBe(true);
  });

  it('blocks a check-in whose walk-in has not been resolved yet', async () => {
    const { store, transport } = make();
    transport.walkin.mockResolvedValue({ success: false, message: 'E-mail inválido' });
    const w = store.addWalkin('ev', { name: 'Caio', email: 'nope' });
    store.checkIn('ev', w.id);
    const report = await processOutbox(store, 'ev', transport);
    expect(transport.checkin).not.toHaveBeenCalled();
    expect(report).toEqual({ sent: 0, failed: 1, blocked: 1, stoppedByNetwork: false });
    expect(store.getEvent('ev')!.outbox[0]).toMatchObject({ kind: 'walkin', failed: true, lastError: 'E-mail inválido' });
  });

  it('stops at the first network error and keeps the item for retry', async () => {
    const { store, transport } = make();
    transport.checkin.mockRejectedValueOnce(new NetworkError('offline'));
    store.checkIn('ev', 's1');
    const w = store.addWalkin('ev', { name: 'Caio', email: 'c@x.io' });
    void w;
    const report = await processOutbox(store, 'ev', transport);
    expect(report).toEqual({ sent: 0, failed: 0, blocked: 0, stoppedByNetwork: true });
    expect(transport.walkin).not.toHaveBeenCalled();
    expect(store.getEvent('ev')!.outbox[0]).toMatchObject({ attempts: 1, lastError: 'offline', nextAttemptAt: '2026-09-12T10:00:05.000Z' });
  });

  it('skips items in backoff and failed items', async () => {
    const { store, transport } = make();
    store.checkIn('ev', 's1');
    const [item] = store.getEvent('ev')!.outbox;
    store.outboxFailed('ev', item.id, 'x', { permanent: false });
    const report = await processOutbox(store, 'ev', transport);
    expect(transport.checkin).not.toHaveBeenCalled();
    expect(report.blocked).toBe(1);
  });

  it('fails a walk-in permanently when no batch is configured', async () => {
    const { store, transport } = make();
    store.updateSettings('ev', { batchId: '' });
    store.addWalkin('ev', { name: 'Caio', email: 'c@x.io' });
    await processOutbox(store, 'ev', transport);
    expect(transport.walkin).not.toHaveBeenCalled();
    expect(store.getEvent('ev')!.outbox[0]).toMatchObject({ failed: true, lastError: 'Selecione o lote nas configurações' });
  });

  it('treats unknown errors as permanent failures', async () => {
    const { store, transport } = make();
    transport.checkin.mockRejectedValueOnce(new Error('GraphQL boom'));
    store.checkIn('ev', 's1');
    const report = await processOutbox(store, 'ev', transport);
    expect(report.failed).toBe(1);
    expect(store.getEvent('ev')!.outbox[0]).toMatchObject({ failed: true, lastError: 'GraphQL boom' });
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm test -- src/features/checkin/__tests__/outbox.test.ts`
Expected: FAIL — módulos ausentes.

- [ ] **Step 3: `transport.ts` (interface)**

```ts
import type { ServerSignup, WalkinInput } from './types';

export interface MutationResult {
  success: boolean;
  message?: string | null;
  signup?: ServerSignup | null;
}

/** Everything the sync layer needs from the BFF. Implemented over Apollo in apollo-transport.ts. */
export interface CheckinTransport {
  fetchSignups(eventSlug: string): Promise<ServerSignup[]>;
  checkin(eventSlug: string, signupId: string, checkedInAt: string): Promise<MutationResult>;
  walkin(eventSlug: string, batchId: string, input: WalkinInput): Promise<MutationResult>;
}

/** Thrown when the request never reached the BFF (offline, timeout, DNS). Retried with backoff. */
export class NetworkError extends Error {
  name = 'NetworkError';
}
```

- [ ] **Step 4: `outbox.ts`**

```ts
import type { CheckinStore } from './store';
import { NetworkError, type CheckinTransport, type MutationResult } from './transport';
import { isLocalId, type OutboxItem } from './types';

export interface OutboxReport {
  sent: number;
  failed: number;
  blocked: number;
  /** A network error interrupted the run; remaining items were not attempted. */
  stoppedByNetwork: boolean;
}

const errorMessage = (e: unknown) => (e instanceof Error ? e.message : String(e));

/**
 * Pushes the event's outbox FIFO. Business failures mark the item and move on;
 * a network error stops the run (nothing else would get through either).
 */
export async function processOutbox(
  store: CheckinStore,
  slug: string,
  transport: CheckinTransport,
  now: () => string = () => new Date().toISOString(),
): Promise<OutboxReport> {
  const report: OutboxReport = { sent: 0, failed: 0, blocked: 0, stoppedByNetwork: false };
  const items = store.getEvent(slug)?.outbox ?? [];

  for (const item of items) {
    if (item.failed || (item.nextAttemptAt && item.nextAttemptAt > now())) {
      report.blocked += 1;
      continue;
    }
    if (item.kind === 'checkin' && isLocalId(item.signupId)) {
      report.blocked += 1;
      continue;
    }
    if (item.kind === 'walkin' && !item.batchId) {
      store.outboxFailed(slug, item.id, 'Selecione o lote nas configurações', { permanent: true });
      report.failed += 1;
      continue;
    }

    let result: MutationResult;
    try {
      result = await send(item, slug, transport);
    } catch (e) {
      if (e instanceof NetworkError) {
        store.outboxFailed(slug, item.id, errorMessage(e), { permanent: false });
        report.stoppedByNetwork = true;
        return report;
      }
      store.outboxFailed(slug, item.id, errorMessage(e), { permanent: true });
      report.failed += 1;
      continue;
    }

    if (!result.success) {
      store.outboxFailed(slug, item.id, result.message || 'Falha no servidor', { permanent: true });
      report.failed += 1;
      continue;
    }
    if (item.kind === 'walkin') {
      if (!result.signup) {
        store.outboxFailed(slug, item.id, 'Servidor não devolveu a inscrição', { permanent: true });
        report.failed += 1;
        continue;
      }
      store.resolveWalkin(slug, item.localId, result.signup);
    }
    store.outboxSucceeded(slug, item.id);
    report.sent += 1;
  }
  return report;
}

// Re-reads the item from the store: a walk-in resolved earlier in this run may
// have remapped a check-in's signupId.
const send = (item: OutboxItem, slug: string, transport: CheckinTransport): Promise<MutationResult> =>
  item.kind === 'checkin'
    ? transport.checkin(slug, item.signupId, item.checkedInAt)
    : transport.walkin(slug, item.batchId, item.input);
```

Atenção ao comentário acima de `send`: como `items` foi lido no início, um `checkin` que veio depois de um `walkin` resolvido no mesmo loop ainda tem `signupId` local no array antigo. Corrija dentro do loop: antes de `if (item.kind === 'checkin' && isLocalId(...))`, releia o item — `const current = store.getEvent(slug)?.outbox.find((i) => i.id === item.id); if (!current) continue;` — e use `current` no lugar de `item` daí em diante. O teste "resolves a walk-in then sends its check-in" cobre isso.

- [ ] **Step 5: Rodar e ver passar**

Run: `pnpm test -- src/features/checkin`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/features/checkin/transport.ts src/features/checkin/outbox.ts src/features/checkin/__tests__/outbox.test.ts
git commit -m "Add outbox processing with FIFO, backoff and walk-in id resolution"
```

---

### Task 5: `SyncEngine`, transporte Apollo e queries

**Files:**
- Modify: `src/lib/queries.ts` — `EVENT_SIGNUPS`, `CHECKIN_SIGNUP`, `MANUAL_SIGNUP`, `EVENT_BATCHES`
- Create: `src/features/checkin/apollo-transport.ts`
- Create: `src/features/checkin/sync.ts`
- Create: `src/features/checkin/netinfo-adapter.ts`
- Test: `src/features/checkin/__tests__/sync.test.ts`, `src/features/checkin/__tests__/apollo-transport.test.ts`

**Interfaces:**
- Produces:
  ```ts
  // sync.ts
  export interface Connectivity { isOnline(): boolean; subscribe(cb: (online: boolean) => void): () => void }
  export class FakeConnectivity implements Connectivity { constructor(online = true); set(online: boolean) }
  export interface SyncStatus { online: boolean; syncing: boolean; lastError?: string; lastSyncAt?: string }
  export class SyncEngine {
    constructor(deps: { store: CheckinStore; transport: CheckinTransport; connectivity: Connectivity; pullIntervalMs?: number; now?: () => string })
    start(slug: string): void   // pull+push imediato, timer de pull, reage a reconexão e a novas entradas na outbox
    stop(): void
    syncNow(): Promise<void>    // pull + push; erros viram lastError
    getStatus(): SyncStatus
    subscribe(listener: () => void): () => void
  }
  // apollo-transport.ts
  export function createApolloTransport(client: ApolloClient<unknown>): CheckinTransport
  // netinfo-adapter.ts
  export function createNetInfoConnectivity(): Connectivity
  ```

- [ ] **Step 1: Queries** (`src/lib/queries.ts`, append)

```ts
export const EVENT_SIGNUP_FIELDS = gql`
  fragment EventSignupFields on EventSignup {
    id
    name
    email
    phone_number
    checked_in
    checked_in_at
    product_name
  }
`;

export const EVENT_SIGNUPS = gql`
  query EventSignups($eventSlug: String!) {
    eventSignups(eventSlug: $eventSlug) {
      ...EventSignupFields
    }
  }
  ${EVENT_SIGNUP_FIELDS}
`;

export const CHECKIN_SIGNUP = gql`
  mutation CheckinSignup($eventSlug: String!, $signupId: String!, $checkedInAt: String) {
    checkinSignup(eventSlug: $eventSlug, signupId: $signupId, checkedInAt: $checkedInAt) {
      success
      message
      signup {
        ...EventSignupFields
      }
    }
  }
  ${EVENT_SIGNUP_FIELDS}
`;

export const MANUAL_SIGNUP = gql`
  mutation ManualSignup($eventSlug: String!, $batchId: String!, $input: ManualSignupInput!) {
    manualSignup(eventSlug: $eventSlug, batchId: $batchId, input: $input) {
      success
      message
      account_created
      signup {
        ...EventSignupFields
      }
    }
  }
  ${EVENT_SIGNUP_FIELDS}
`;

export const EVENT_BATCHES = gql`
  query EventBatches($slugOrId: String!) {
    eventBySlugOrId(slugOrId: $slugOrId) {
      id
      title
      products {
        id
        name
        enabled
        batches {
          id
          batch_number
          value
          enabled
        }
      }
    }
  }
`;
```

- [ ] **Step 2: Teste do transporte Apollo**

`src/features/checkin/__tests__/apollo-transport.test.ts`:

```ts
import { ApolloClient, ApolloLink, InMemoryCache, Observable } from '@apollo/client';
import { createApolloTransport } from '../apollo-transport';
import { NetworkError } from '../transport';

const clientWith = (link: ApolloLink) => new ApolloClient({ link, cache: new InMemoryCache({ addTypename: false }) });

describe('createApolloTransport', () => {
  it('maps eventSignups to ServerSignup[] with network-only fetch', async () => {
    const link = new ApolloLink((op) => {
      expect(op.operationName).toBe('EventSignups');
      expect(op.variables).toEqual({ eventSlug: 'ev' });
      return Observable.of({ data: { eventSignups: [{ id: '1', name: 'Ana', email: null, phone_number: null, checked_in: false, checked_in_at: null, product_name: null }] } });
    });
    const out = await createApolloTransport(clientWith(link)).fetchSignups('ev');
    expect(out).toEqual([{ id: '1', name: 'Ana', email: null, phone_number: null, checked_in: false, checked_in_at: null, product_name: null }]);
  });

  it('sends checkin and walkin mutations and returns their payloads', async () => {
    const link = new ApolloLink((op) => {
      if (op.operationName === 'CheckinSignup') {
        expect(op.variables).toEqual({ eventSlug: 'ev', signupId: 's1', checkedInAt: 't' });
        return Observable.of({ data: { checkinSignup: { success: true, message: 'ok', signup: null } } });
      }
      expect(op.variables).toEqual({ eventSlug: 'ev', batchId: '7', input: { name: 'C', email: 'c@x.io', phone_number: '62' } });
      return Observable.of({ data: { manualSignup: { success: true, message: null, account_created: true, signup: { id: 's9', name: 'C' } } } });
    });
    const t = createApolloTransport(clientWith(link));
    expect(await t.checkin('ev', 's1', 't')).toEqual({ success: true, message: 'ok', signup: null });
    expect(await t.walkin('ev', '7', { name: 'C', email: 'c@x.io', phone_number: '62' })).toMatchObject({ success: true, signup: { id: 's9' } });
  });

  it('turns transport failures into NetworkError', async () => {
    const link = new ApolloLink(() => new Observable((o) => o.error(new TypeError('Network request failed'))));
    await expect(createApolloTransport(clientWith(link)).checkin('ev', 's1', 't')).rejects.toBeInstanceOf(NetworkError);
  });

  it('keeps GraphQL errors as plain errors', async () => {
    const link = new ApolloLink(() => Observable.of({ errors: [{ message: 'Unknown argument' }] } as never));
    await expect(createApolloTransport(clientWith(link)).checkin('ev', 's1', 't')).rejects.toThrow('Unknown argument');
  });
});
```

- [ ] **Step 3: Rodar e ver falhar**

Run: `pnpm test -- src/features/checkin/__tests__/apollo-transport.test.ts`
Expected: FAIL — módulo ausente.

- [ ] **Step 4: `apollo-transport.ts`**

```ts
import { ApolloError, type ApolloClient } from '@apollo/client';
import { CHECKIN_SIGNUP, EVENT_SIGNUPS, MANUAL_SIGNUP } from '@/lib/queries';
import { NetworkError, type CheckinTransport, type MutationResult } from './transport';
import type { ServerSignup, WalkinInput } from './types';

const rethrow = (e: unknown): never => {
  if (e instanceof ApolloError && e.networkError && !('result' in e.networkError)) {
    throw new NetworkError(e.networkError.message);
  }
  if (e instanceof TypeError && /network/i.test(e.message)) throw new NetworkError(e.message);
  throw e instanceof Error ? e : new Error(String(e));
};

export function createApolloTransport(client: ApolloClient<unknown>): CheckinTransport {
  return {
    async fetchSignups(eventSlug) {
      try {
        const { data } = await client.query<{ eventSignups: (ServerSignup | null)[] | null }>({
          query: EVENT_SIGNUPS,
          variables: { eventSlug },
          fetchPolicy: 'network-only',
        });
        return (data.eventSignups ?? []).filter((s): s is ServerSignup => s != null);
      } catch (e) {
        return rethrow(e);
      }
    },
    async checkin(eventSlug, signupId, checkedInAt) {
      try {
        const { data } = await client.mutate<{ checkinSignup: MutationResult }>({
          mutation: CHECKIN_SIGNUP,
          variables: { eventSlug, signupId, checkedInAt },
        });
        return data?.checkinSignup ?? { success: false, message: 'Resposta vazia' };
      } catch (e) {
        return rethrow(e);
      }
    },
    async walkin(eventSlug, batchId, input: WalkinInput) {
      try {
        const { data } = await client.mutate<{ manualSignup: MutationResult }>({
          mutation: MANUAL_SIGNUP,
          variables: { eventSlug, batchId, input },
        });
        return data?.manualSignup ?? { success: false, message: 'Resposta vazia' };
      } catch (e) {
        return rethrow(e);
      }
    },
  };
}
```

Nota: Apollo 3 embrulha erros de rede em `ApolloError.networkError`; um `ServerError` (HTTP 4xx/5xx com corpo) tem `result` — tratamos como permanente. Se o teste "turns transport failures into NetworkError" falhar porque o `networkError` vem com outro formato, imprima `e.networkError` e ajuste o predicado (não o teste).

- [ ] **Step 5: Rodar e ver passar**

Run: `pnpm test -- src/features/checkin/__tests__/apollo-transport.test.ts`
Expected: PASS (4).

- [ ] **Step 6: Teste do `SyncEngine`**

`src/features/checkin/__tests__/sync.test.ts`:

```ts
import { CheckinStore, MemoryStorage } from '../store';
import { FakeConnectivity, SyncEngine } from '../sync';
import { NetworkError, type CheckinTransport } from '../transport';

const flush = () => new Promise((r) => setImmediate(r));

const make = (online = true) => {
  const store = new CheckinStore({ storage: new MemoryStorage(), uuid: () => 'u' });
  store.loadEvent('ev', 'Evento', [{ id: 's1', name: 'Ana' }]);
  const transport: jest.Mocked<CheckinTransport> = {
    fetchSignups: jest.fn().mockResolvedValue([{ id: 's1', name: 'Ana' }, { id: 's2', name: 'Bia' }]),
    checkin: jest.fn().mockResolvedValue({ success: true }),
    walkin: jest.fn().mockResolvedValue({ success: true, signup: { id: 's9', name: 'C' } }),
  };
  const connectivity = new FakeConnectivity(online);
  const engine = new SyncEngine({ store, transport, connectivity, pullIntervalMs: 30_000 });
  return { store, transport, connectivity, engine };
};

beforeEach(() => jest.useFakeTimers());
afterEach(() => jest.useRealTimers());

describe('SyncEngine', () => {
  it('pulls immediately on start and every interval while online', async () => {
    const { engine, transport, store } = make();
    engine.start('ev');
    await flush();
    expect(transport.fetchSignups).toHaveBeenCalledTimes(1);
    expect(store.getEvent('ev')!.signups).toHaveLength(2);
    jest.advanceTimersByTime(30_000);
    await flush();
    expect(transport.fetchSignups).toHaveBeenCalledTimes(2);
    engine.stop();
    jest.advanceTimersByTime(60_000);
    expect(transport.fetchSignups).toHaveBeenCalledTimes(2);
  });

  it('does nothing while offline and syncs when connectivity returns', async () => {
    const { engine, transport, connectivity, store } = make(false);
    store.checkIn('ev', 's1');
    engine.start('ev');
    await flush();
    expect(transport.fetchSignups).not.toHaveBeenCalled();
    expect(engine.getStatus().online).toBe(false);
    connectivity.set(true);
    await flush();
    expect(transport.fetchSignups).toHaveBeenCalledTimes(1);
    expect(transport.checkin).toHaveBeenCalledWith('ev', 's1', expect.any(String));
    expect(store.getEvent('ev')!.outbox).toEqual([]);
  });

  it('pushes new outbox items as they are enqueued', async () => {
    const { engine, transport, store } = make();
    engine.start('ev');
    await flush();
    store.checkIn('ev', 's1');
    await flush();
    expect(transport.checkin).toHaveBeenCalledTimes(1);
  });

  it('records network failures in the status and keeps going', async () => {
    const { engine, transport } = make();
    transport.fetchSignups.mockRejectedValueOnce(new NetworkError('offline'));
    engine.start('ev');
    await flush();
    expect(engine.getStatus()).toMatchObject({ syncing: false, lastError: 'offline' });
    jest.advanceTimersByTime(30_000);
    await flush();
    expect(engine.getStatus().lastError).toBeUndefined();
    expect(engine.getStatus().lastSyncAt).toEqual(expect.any(String));
  });

  it('syncNow runs pull and push once even if called twice concurrently', async () => {
    const { engine, transport } = make();
    engine.start('ev');
    await flush();
    transport.fetchSignups.mockClear();
    await Promise.all([engine.syncNow(), engine.syncNow()]);
    expect(transport.fetchSignups).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 7: Rodar e ver falhar**

Run: `pnpm test -- src/features/checkin/__tests__/sync.test.ts`
Expected: FAIL — módulo ausente.

- [ ] **Step 8: `sync.ts`**

```ts
import { processOutbox } from './outbox';
import type { CheckinStore } from './store';
import type { CheckinTransport } from './transport';

export interface Connectivity {
  isOnline(): boolean;
  subscribe(cb: (online: boolean) => void): () => void;
}

/** Connectivity you can flip by hand (tests, dev). */
export class FakeConnectivity implements Connectivity {
  private listeners = new Set<(online: boolean) => void>();
  constructor(private online = true) {}
  isOnline() {
    return this.online;
  }
  subscribe(cb: (online: boolean) => void) {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }
  set(online: boolean) {
    this.online = online;
    this.listeners.forEach((l) => l(online));
  }
}

export interface SyncStatus {
  online: boolean;
  syncing: boolean;
  lastError?: string;
  lastSyncAt?: string;
}

interface Deps {
  store: CheckinStore;
  transport: CheckinTransport;
  connectivity: Connectivity;
  pullIntervalMs?: number;
  now?: () => string;
}

/**
 * Keeps one event in sync: pull (merge) every interval while online, push the
 * outbox whenever it grows or connectivity returns. Only one sync runs at a time;
 * a request made mid-run is queued once.
 */
export class SyncEngine {
  private slug: string | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private unsubscribers: (() => void)[] = [];
  private status: SyncStatus;
  private listeners = new Set<() => void>();
  private running: Promise<void> | null = null;
  private queued = false;
  private lastOutboxLength = 0;
  private deps: Required<Deps>;

  constructor(deps: Deps) {
    this.deps = {
      pullIntervalMs: 30_000,
      now: () => new Date().toISOString(),
      ...deps,
    };
    this.status = { online: deps.connectivity.isOnline(), syncing: false };
  }

  start(slug: string) {
    this.stop();
    this.slug = slug;
    this.lastOutboxLength = this.deps.store.getEvent(slug)?.outbox.length ?? 0;
    this.timer = setInterval(() => void this.syncNow(), this.deps.pullIntervalMs);
    this.unsubscribers.push(
      this.deps.connectivity.subscribe((online) => {
        this.setStatus({ online });
        if (online) void this.syncNow();
      }),
      this.deps.store.subscribe(() => {
        const len = this.deps.store.getEvent(slug)?.outbox.length ?? 0;
        const grew = len > this.lastOutboxLength;
        this.lastOutboxLength = len;
        if (grew) void this.syncNow();
      }),
    );
    void this.syncNow();
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.unsubscribers.forEach((u) => u());
    this.unsubscribers = [];
    this.slug = null;
  }

  getStatus(): SyncStatus {
    return this.status;
  }

  subscribe(listener: () => void) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  syncNow(): Promise<void> {
    if (this.running) {
      this.queued = true;
      return this.running;
    }
    this.running = this.run().finally(() => {
      this.running = null;
      if (this.queued) {
        this.queued = false;
        void this.syncNow();
      }
    });
    return this.running;
  }

  private async run() {
    const { store, transport, connectivity, now } = this.deps;
    const slug = this.slug;
    if (!slug || !connectivity.isOnline()) return;
    this.setStatus({ syncing: true });
    try {
      store.applyPull(slug, await transport.fetchSignups(slug));
      const report = await processOutbox(store, slug, transport, now);
      if (report.stoppedByNetwork) throw new Error('Sem conexão com o servidor');
      this.setStatus({ syncing: false, lastError: undefined, lastSyncAt: now() });
    } catch (e) {
      this.setStatus({ syncing: false, lastError: e instanceof Error ? e.message : String(e) });
    }
  }

  private setStatus(patch: Partial<SyncStatus>) {
    this.status = { ...this.status, ...patch };
    this.listeners.forEach((l) => l());
  }
}
```

- [ ] **Step 9: `netinfo-adapter.ts`**

```ts
import NetInfo from '@react-native-community/netinfo';
import type { Connectivity } from './sync';

const reachable = (state: { isConnected: boolean | null; isInternetReachable: boolean | null }) =>
  Boolean(state.isConnected) && state.isInternetReachable !== false;

/** Connectivity backed by NetInfo. Seeds `isOnline` optimistically until the first event. */
export function createNetInfoConnectivity(): Connectivity {
  let online = true;
  const listeners = new Set<(online: boolean) => void>();
  NetInfo.addEventListener((state) => {
    const next = reachable(state);
    if (next === online) return;
    online = next;
    listeners.forEach((l) => l(online));
  });
  return {
    isOnline: () => online,
    subscribe(cb) {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
  };
}
```

- [ ] **Step 10: Rodar tudo e ver passar**

Run: `pnpm test && pnpm exec tsc --noEmit && pnpm lint`
Expected: PASS. Se o `SyncEngine` "pushes new outbox items" falhar por ter sincronizado duas vezes (o próprio `applyPull` notifica o store), confirme que `grew` só é verdadeiro quando o tamanho da outbox **aumenta**.

- [ ] **Step 11: Commit**

```bash
git add src/lib/queries.ts src/features/checkin/apollo-transport.ts src/features/checkin/sync.ts src/features/checkin/netinfo-adapter.ts src/features/checkin/__tests__/sync.test.ts src/features/checkin/__tests__/apollo-transport.test.ts
git commit -m "Add SyncEngine with periodic pull, outbox push and NetInfo connectivity"
```

---

### Task 6: Store provider (MMKV) e hooks de leitura

**Files:**
- Create: `src/features/checkin/store-provider.tsx`
- Create: `src/features/checkin/use-sync.ts`
- Modify: `src/app/_layout.tsx`
- Test: `src/features/checkin/__tests__/store-provider.test.tsx`

**Interfaces:**
- Produces:
  ```ts
  export function CheckinStoreProvider({ store, children }: { store?: CheckinStore; children: ReactNode })  // sem `store` cria um sobre MMKV (`createMmkvStore()`)
  export function useCheckinStore(): CheckinStore
  export function useEventCache(slug: string): EventCache | undefined   // useSyncExternalStore
  export function useLoadedEvents(): EventSummary[]
  // use-sync.ts
  export function useEventSync(slug: string, engine?: SyncEngine): SyncStatus & { syncNow: () => Promise<void> }
  ```

- [ ] **Step 1: Teste**

`src/features/checkin/__tests__/store-provider.test.tsx`:

```tsx
import React from 'react';
import { Text } from 'react-native';
import { act, render, screen } from '@testing-library/react-native';
import { CheckinStore, MemoryStorage } from '../store';
import { CheckinStoreProvider, useEventCache, useLoadedEvents } from '../store-provider';

function Probe({ slug }: { slug: string }) {
  const ev = useEventCache(slug);
  const events = useLoadedEvents();
  return (
    <Text>
      {events.length} eventos; {ev ? `${ev.signups.length} inscritos` : 'sem evento'}
    </Text>
  );
}

describe('CheckinStoreProvider', () => {
  it('re-renders when the store changes', async () => {
    const store = new CheckinStore({ storage: new MemoryStorage() });
    await render(
      <CheckinStoreProvider store={store}>
        <Probe slug="ev" />
      </CheckinStoreProvider>,
    );
    expect(screen.getByText('0 eventos; sem evento')).toBeTruthy();
    act(() => {
      store.loadEvent('ev', 'Evento', [{ id: '1', name: 'Ana' }]);
    });
    expect(screen.getByText('1 eventos; 1 inscritos')).toBeTruthy();
  });
});
```

- [ ] **Step 2: Rodar e ver falhar** — `pnpm test -- store-provider` → módulo ausente.

- [ ] **Step 3: `store-provider.tsx`**

```tsx
import { createContext, useContext, useMemo, useSyncExternalStore, type ReactNode } from 'react';
import { MMKV } from 'react-native-mmkv';
import { CheckinStore, type EventSummary, type KeyValueStorage } from './store';
import type { EventCache } from './types';

const mmkvStorage = (): KeyValueStorage => {
  const mmkv = new MMKV({ id: 'checkin' });
  return {
    getString: (k) => mmkv.getString(k),
    set: (k, v) => mmkv.set(k, v),
    delete: (k) => mmkv.delete(k),
  };
};

export const createMmkvStore = () => new CheckinStore({ storage: mmkvStorage() });

const Ctx = createContext<CheckinStore | null>(null);

export function CheckinStoreProvider({ store, children }: { store?: CheckinStore; children: ReactNode }) {
  const value = useMemo(() => store ?? createMmkvStore(), [store]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useCheckinStore(): CheckinStore {
  const store = useContext(Ctx);
  if (!store) throw new Error('useCheckinStore fora de CheckinStoreProvider');
  return store;
}

export function useEventCache(slug: string): EventCache | undefined {
  const store = useCheckinStore();
  return useSyncExternalStore(
    (cb) => store.subscribe(cb),
    () => store.getEvent(slug),
  );
}

export function useLoadedEvents(): EventSummary[] {
  const store = useCheckinStore();
  // listEvents() builds a new array each call; cache by store version so the
  // snapshot is referentially stable between changes.
  return useSyncExternalStore(
    (cb) => store.subscribe(cb),
    useMemo(() => {
      let cached: EventSummary[] | null = null;
      let key = '';
      return () => {
        const next = store.listEvents();
        const nextKey = JSON.stringify(next);
        if (nextKey !== key) {
          key = nextKey;
          cached = next;
        }
        return cached!;
      };
    }, [store]),
  );
}
```

Se o Jest reclamar de `react-native-mmkv` (nitro nativo ausente), adicione ao `package.json` em `jest`: `"moduleNameMapper": { "^react-native-mmkv$": "<rootDir>/src/test/mmkv-mock.ts" }` com o arquivo `src/test/mmkv-mock.ts`:

```ts
export class MMKV {
  private m = new Map<string, string>();
  getString(k: string) { return this.m.get(k); }
  set(k: string, v: string) { this.m.set(k, v); }
  delete(k: string) { this.m.delete(k); }
}
```

- [ ] **Step 4: `use-sync.ts`**

```ts
import { useApolloClient } from '@apollo/client';
import { useEffect, useMemo, useSyncExternalStore } from 'react';
import { createApolloTransport } from './apollo-transport';
import { createNetInfoConnectivity } from './netinfo-adapter';
import { useCheckinStore } from './store-provider';
import { SyncEngine, type SyncStatus } from './sync';

let sharedConnectivity: ReturnType<typeof createNetInfoConnectivity> | null = null;

/** Runs a SyncEngine for `slug` while the calling screen is mounted. */
export function useEventSync(slug: string, engineOverride?: SyncEngine): SyncStatus & { syncNow: () => Promise<void> } {
  const store = useCheckinStore();
  const client = useApolloClient();
  const engine = useMemo(() => {
    if (engineOverride) return engineOverride;
    sharedConnectivity ??= createNetInfoConnectivity();
    return new SyncEngine({ store, transport: createApolloTransport(client), connectivity: sharedConnectivity });
  }, [engineOverride, store, client]);

  useEffect(() => {
    engine.start(slug);
    return () => engine.stop();
  }, [engine, slug]);

  const status = useSyncExternalStore(
    (cb) => engine.subscribe(cb),
    () => engine.getStatus(),
  );
  return { ...status, syncNow: () => engine.syncNow() };
}
```

- [ ] **Step 5: Ligar o provider no layout** (`src/app/_layout.tsx`)

```tsx
import { ApolloProvider } from '@apollo/client';
import { Stack } from 'expo-router';
import { useState } from 'react';
import { CheckinStoreProvider } from '@/features/checkin/store-provider';
import { createApolloClient } from '@/lib/apollo-client';

export default function RootLayout() {
  const [client] = useState(createApolloClient);
  return (
    <ApolloProvider client={client}>
      <CheckinStoreProvider>
        <Stack screenOptions={{ headerTitle: 'HubCommunity' }} />
      </CheckinStoreProvider>
    </ApolloProvider>
  );
}
```

- [ ] **Step 6: Rodar e ver passar** — `pnpm test && pnpm exec tsc --noEmit && pnpm lint`.

- [ ] **Step 7: Commit**

```bash
git add src/features/checkin/store-provider.tsx src/features/checkin/use-sync.ts src/app/_layout.tsx src/features/checkin/__tests__/store-provider.test.tsx package.json src/test
git commit -m "Provide the CheckinStore (MMKV) and a per-screen sync hook"
```

---

### Task 7: Impressora — preferências, erros, `usePrinter`, `usePrintBadge`

**Files:**
- Create: `src/features/printer/printer-prefs.ts`
- Create: `src/features/printer/printer-errors.ts`
- Create: `src/features/printer/use-printer.ts`
- Create: `src/features/printer/use-print-badge.tsx`
- Test: `src/features/printer/__tests__/printer-prefs.test.ts`, `src/features/printer/__tests__/printer-errors.test.ts`, `src/features/printer/__tests__/use-print-badge.test.tsx`

**Interfaces:**
- Consumes: `modules/tspl-usb-printer` (`listDevices`, `requestPermission`, `printBitmap`, `isAvailable`, `UsbPrinterDevice`), `BadgeLabel`, `KeyValueStorage`.
- Produces:
  ```ts
  // printer-prefs.ts
  export interface PrinterPrefs { vendorId: number; productId: number }
  export interface LabelPrefs { gapMm: number; density: number }
  export const DEFAULT_LABEL: LabelPrefs = { gapMm: 3, density: 8 }
  export function readPrinterPrefs(storage): PrinterPrefs | null; writePrinterPrefs(storage, prefs | null)
  export function readLabelPrefs(storage): LabelPrefs; writeLabelPrefs(storage, prefs)
  export function pickDevice(devices: UsbPrinterDevice[], prefs: PrinterPrefs | null): UsbPrinterDevice | null  // preferido se presente; senão o único; senão null
  // printer-errors.ts
  export function friendlyPrinterError(e: unknown): string
  // use-printer.ts
  export interface PrinterState { available: boolean; devices: UsbPrinterDevice[]; selected: UsbPrinterDevice | null; refresh(): void; select(d): Promise<boolean> /* pede permissão */; ready: boolean /* selected && hasPermission */ }
  export function usePrinter(storage?: KeyValueStorage): PrinterState
  // use-print-badge.tsx
  export interface BadgeData { fullName: string; logoText: string; link: string }
  export interface PrinterModule { printBitmap(deviceName: string, png: string, opts: LabelOptions): Promise<void> }
  export function usePrintBadge(opts: { deviceName: string | null; label: LabelPrefs; module?: PrinterModule; capture?: (ref: RefObject<View | null>) => Promise<string> }): { offscreen: ReactElement; print(data: BadgeData): Promise<void>; printing: boolean }
  ```

- [ ] **Step 1: Testes de prefs e erros**

`src/features/printer/__tests__/printer-prefs.test.ts`:

```ts
import { MemoryStorage } from '@/features/checkin/store';
import { DEFAULT_LABEL, pickDevice, readLabelPrefs, readPrinterPrefs, writeLabelPrefs, writePrinterPrefs } from '../printer-prefs';
import type { UsbPrinterDevice } from '../../../../modules/tspl-usb-printer';

const dev = (vendorId: number, productId: number, deviceName = `/dev/${vendorId}`): UsbPrinterDevice => ({
  deviceName, vendorId, productId, productName: null, manufacturerName: null, hasPermission: false,
});

describe('printer prefs', () => {
  it('round-trips the selected printer and label settings', () => {
    const s = new MemoryStorage();
    expect(readPrinterPrefs(s)).toBeNull();
    expect(readLabelPrefs(s)).toEqual(DEFAULT_LABEL);
    writePrinterPrefs(s, { vendorId: 1, productId: 2 });
    writeLabelPrefs(s, { gapMm: 2, density: 10 });
    expect(readPrinterPrefs(s)).toEqual({ vendorId: 1, productId: 2 });
    expect(readLabelPrefs(s)).toEqual({ gapMm: 2, density: 10 });
    writePrinterPrefs(s, null);
    expect(readPrinterPrefs(s)).toBeNull();
  });
});

describe('pickDevice', () => {
  it('prefers the remembered printer, else the only device, else null', () => {
    expect(pickDevice([dev(1, 1), dev(2, 2)], { vendorId: 2, productId: 2 })?.vendorId).toBe(2);
    expect(pickDevice([dev(1, 1)], null)?.vendorId).toBe(1);
    expect(pickDevice([dev(1, 1), dev(2, 2)], null)).toBeNull();
    expect(pickDevice([], { vendorId: 2, productId: 2 })).toBeNull();
  });
});
```

`src/features/printer/__tests__/printer-errors.test.ts`:

```ts
import { friendlyPrinterError } from '../printer-errors';

describe('friendlyPrinterError', () => {
  it.each([
    ['No permission for /dev/bus/usb/001/002', 'Sem permissão para usar a impressora. Selecione-a de novo nas configurações.'],
    ['USB device not found: /dev/x', 'Impressora desconectada. Confira o cabo USB.'],
    ['USB write failed at byte 10 of 200', 'Falha ao enviar para a impressora. Confira o cabo e tente de novo.'],
    ['Could not open /dev/x', 'Não foi possível abrir a impressora. Reconecte o cabo.'],
    ['TsplUsbPrinter is only available on Android', 'Impressão USB só funciona no Android.'],
    ['algo estranho', 'Erro na impressora: algo estranho'],
  ])('%s → %s', (raw, friendly) => {
    expect(friendlyPrinterError(new Error(raw))).toBe(friendly);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar** — `pnpm test -- src/features/printer`.

- [ ] **Step 3: `printer-prefs.ts` e `printer-errors.ts`**

```ts
// printer-prefs.ts
import type { KeyValueStorage } from '@/features/checkin/store';
import type { UsbPrinterDevice } from '../../../modules/tspl-usb-printer';

export interface PrinterPrefs {
  vendorId: number;
  productId: number;
}
export interface LabelPrefs {
  gapMm: number;
  density: number;
}
export const DEFAULT_LABEL: LabelPrefs = { gapMm: 3, density: 8 };

const PRINTER_KEY = 'printer:selected';
const LABEL_KEY = 'printer:label';

export const readPrinterPrefs = (s: KeyValueStorage): PrinterPrefs | null => {
  const raw = s.getString(PRINTER_KEY);
  return raw ? (JSON.parse(raw) as PrinterPrefs) : null;
};
export const writePrinterPrefs = (s: KeyValueStorage, prefs: PrinterPrefs | null) =>
  prefs ? s.set(PRINTER_KEY, JSON.stringify(prefs)) : s.delete(PRINTER_KEY);

export const readLabelPrefs = (s: KeyValueStorage): LabelPrefs => {
  const raw = s.getString(LABEL_KEY);
  return raw ? { ...DEFAULT_LABEL, ...(JSON.parse(raw) as Partial<LabelPrefs>) } : DEFAULT_LABEL;
};
export const writeLabelPrefs = (s: KeyValueStorage, prefs: LabelPrefs) => s.set(LABEL_KEY, JSON.stringify(prefs));

/** The remembered printer when plugged in; otherwise the only device; otherwise nothing. */
export function pickDevice(devices: UsbPrinterDevice[], prefs: PrinterPrefs | null): UsbPrinterDevice | null {
  const remembered = prefs && devices.find((d) => d.vendorId === prefs.vendorId && d.productId === prefs.productId);
  if (remembered) return remembered;
  return devices.length === 1 ? devices[0] : null;
}
```

```ts
// printer-errors.ts
const MAP: [RegExp, string][] = [
  [/no permission/i, 'Sem permissão para usar a impressora. Selecione-a de novo nas configurações.'],
  [/device not found/i, 'Impressora desconectada. Confira o cabo USB.'],
  [/write failed/i, 'Falha ao enviar para a impressora. Confira o cabo e tente de novo.'],
  [/could not open|could not claim/i, 'Não foi possível abrir a impressora. Reconecte o cabo.'],
  [/only available on android/i, 'Impressão USB só funciona no Android.'],
];

export function friendlyPrinterError(e: unknown): string {
  const raw = e instanceof Error ? e.message : String(e);
  const hit = MAP.find(([re]) => re.test(raw));
  return hit ? hit[1] : `Erro na impressora: ${raw}`;
}
```

- [ ] **Step 4: Rodar e ver passar** — `pnpm test -- src/features/printer`.

- [ ] **Step 5: Teste de `usePrintBadge`**

`src/features/printer/__tests__/use-print-badge.test.tsx`:

```tsx
import React from 'react';
import { Button, View } from 'react-native';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { usePrintBadge, type PrinterModule } from '../use-print-badge';

function Harness({ module, capture, deviceName }: { module: PrinterModule; capture: () => Promise<string>; deviceName: string | null }) {
  const { offscreen, print, printing } = usePrintBadge({ deviceName, label: { gapMm: 2, density: 9 }, module, capture });
  return (
    <View>
      {offscreen}
      <Button title={printing ? 'imprimindo' : 'imprimir'} onPress={() => void print({ fullName: 'Ana', logoText: 'REACT', link: 'https://x.io' })} />
    </View>
  );
}

describe('usePrintBadge', () => {
  it('captures the offscreen badge and sends it to the selected printer', async () => {
    const module: PrinterModule = { printBitmap: jest.fn().mockResolvedValue(undefined) };
    const capture = jest.fn().mockResolvedValue('PNGBASE64');
    await render(<Harness module={module} capture={capture} deviceName="/dev/p" />);
    await act(async () => {
      fireEvent.press(screen.getByText('imprimir'));
    });
    expect(capture).toHaveBeenCalledTimes(1);
    expect(module.printBitmap).toHaveBeenCalledWith('/dev/p', 'PNGBASE64', { gapMm: 2, density: 9 });
    expect(screen.getByText('imprimir')).toBeTruthy();
  });

  it('rejects with a friendly message when there is no printer', async () => {
    const module: PrinterModule = { printBitmap: jest.fn() };
    let error = '';
    function Probe() {
      const { offscreen, print } = usePrintBadge({ deviceName: null, label: { gapMm: 3, density: 8 }, module, capture: async () => 'x' });
      return (
        <View>
          {offscreen}
          <Button title="go" onPress={() => print({ fullName: 'A', logoText: 'B', link: 'c' }).catch((e: Error) => { error = e.message; })} />
        </View>
      );
    }
    await render(<Probe />);
    await act(async () => {
      fireEvent.press(screen.getByText('go'));
    });
    expect(error).toBe('Nenhuma impressora selecionada.');
    expect(module.printBitmap).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 6: Rodar e ver falhar** — módulo ausente.

- [ ] **Step 7: `use-print-badge.tsx`**

```tsx
import { useCallback, useRef, useState, type ReactElement, type RefObject } from 'react';
import { StyleSheet, View } from 'react-native';
import { captureRef } from 'react-native-view-shot';
import { BadgeLabel, BADGE_DOTS } from '@/components/badge-label';
import * as Printer from '../../../modules/tspl-usb-printer';
import type { LabelOptions } from '../../../modules/tspl-usb-printer';
import { friendlyPrinterError } from './printer-errors';
import type { LabelPrefs } from './printer-prefs';

export interface BadgeData {
  fullName: string;
  logoText: string;
  link: string;
}

export interface PrinterModule {
  printBitmap(deviceName: string, pngBase64: string, options: LabelOptions): Promise<void>;
}

type Capture = (ref: RefObject<View | null>) => Promise<string>;

const defaultCapture: Capture = (ref) =>
  captureRef(ref, { format: 'png', quality: 1, result: 'base64', width: BADGE_DOTS.width + 4, height: BADGE_DOTS.height });

const nextFrame = () => new Promise<void>((r) => requestAnimationFrame(() => r()));

/**
 * Renders the badge offscreen at print resolution, captures it as PNG and sends
 * it to the printer. One print at a time; errors are already user-friendly.
 */
export function usePrintBadge({
  deviceName,
  label,
  module = Printer,
  capture = defaultCapture,
}: {
  deviceName: string | null;
  label: LabelPrefs;
  module?: PrinterModule;
  capture?: Capture;
}) {
  const ref = useRef<View>(null);
  const [data, setData] = useState<BadgeData>({ fullName: '', logoText: '', link: '' });
  const [printing, setPrinting] = useState(false);

  const print = useCallback(
    async (badge: BadgeData) => {
      if (!deviceName) throw new Error('Nenhuma impressora selecionada.');
      if (printing) throw new Error('Já existe uma impressão em andamento.');
      setPrinting(true);
      try {
        setData(badge);
        await nextFrame();
        await nextFrame();
        const png = await capture(ref);
        await module.printBitmap(deviceName, png, { gapMm: label.gapMm, density: label.density });
      } catch (e) {
        throw new Error(friendlyPrinterError(e));
      } finally {
        setPrinting(false);
      }
    },
    [deviceName, printing, capture, module, label.gapMm, label.density],
  );

  const offscreen: ReactElement = (
    <View style={styles.offscreen} pointerEvents="none">
      <BadgeLabel ref={ref} fullName={data.fullName} logoText={data.logoText} link={data.link} width={BADGE_DOTS.width} />
    </View>
  );

  return { offscreen, print, printing };
}

const styles = StyleSheet.create({
  offscreen: { position: 'absolute', left: -10_000, top: 0 },
});
```

Nota: `friendlyPrinterError` na mensagem "Nenhuma impressora selecionada." cairia em "Erro na impressora: …" — por isso o `throw` dessa validação está **antes** do `try`. `requestAnimationFrame` existe no jsdom/RN de teste; se não existir, use `setTimeout(r, 0)`.

- [ ] **Step 8: `use-printer.ts`**

```ts
import { useCallback, useEffect, useMemo, useState } from 'react';
import { MMKV } from 'react-native-mmkv';
import type { KeyValueStorage } from '@/features/checkin/store';
import * as Printer from '../../../modules/tspl-usb-printer';
import type { UsbPrinterDevice } from '../../../modules/tspl-usb-printer';
import { pickDevice, readPrinterPrefs, writePrinterPrefs } from './printer-prefs';

let defaultStorage: KeyValueStorage | null = null;
const getDefaultStorage = (): KeyValueStorage => {
  if (!defaultStorage) {
    const mmkv = new MMKV({ id: 'printer' });
    defaultStorage = { getString: (k) => mmkv.getString(k), set: (k, v) => mmkv.set(k, v), delete: (k) => mmkv.delete(k) };
  }
  return defaultStorage;
};

export interface PrinterState {
  available: boolean;
  devices: UsbPrinterDevice[];
  selected: UsbPrinterDevice | null;
  ready: boolean;
  refresh(): void;
  select(device: UsbPrinterDevice): Promise<boolean>;
}

/** USB printer discovery + the remembered selection. Polls the device list every 3 s (USB attach/detach). */
export function usePrinter(storage?: KeyValueStorage): PrinterState {
  const store = useMemo(() => storage ?? getDefaultStorage(), [storage]);
  const [devices, setDevices] = useState<UsbPrinterDevice[]>([]);
  const [prefs, setPrefs] = useState(() => readPrinterPrefs(store));

  const refresh = useCallback(() => {
    if (!Printer.isAvailable) return;
    setDevices(Printer.listDevices());
  }, []);

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 3000);
    return () => clearInterval(t);
  }, [refresh]);

  const select = useCallback(
    async (device: UsbPrinterDevice) => {
      const granted = await Printer.requestPermission(device.deviceName);
      if (granted) {
        const next = { vendorId: device.vendorId, productId: device.productId };
        writePrinterPrefs(store, next);
        setPrefs(next);
      }
      refresh();
      return granted;
    },
    [store, refresh],
  );

  const selected = pickDevice(devices, prefs);
  return {
    available: Printer.isAvailable,
    devices,
    selected,
    ready: Boolean(selected?.hasPermission),
    refresh,
    select,
  };
}
```

- [ ] **Step 9: Rodar tudo** — `pnpm test && pnpm exec tsc --noEmit && pnpm lint`. Se o Jest falhar ao importar `modules/tspl-usb-printer` (por `requireOptionalNativeModule` do `expo`), o jest-expo já mocka `expo-modules-core`; se não, adicione `moduleNameMapper` `"^expo$": "<rootDir>/src/test/expo-mock.ts"` **não** — em vez disso, mocke só nos testes que importam o hook: `jest.mock('../../../../modules/tspl-usb-printer', () => ({ isAvailable: false, listDevices: () => [], requestPermission: async () => false, printBitmap: async () => {} }))` no topo de `use-print-badge.test.tsx`.

- [ ] **Step 10: Commit**

```bash
git add src/features/printer
git commit -m "Add printer preferences, friendly errors and badge printing hooks"
```

---

### Task 8: Home — lista de eventos com "Carregar evento"

**Files:**
- Create: `src/components/checkin/events-home.tsx`
- Modify: `src/app/index.tsx`
- Modify: `src/components/events-list.tsx` (aceita `renderAction`)
- Test: `src/components/checkin/__tests__/events-home.test.tsx`

**Interfaces:**
- Consumes: `EVENTS` (query), `EVENT_SIGNUPS`, `useCheckinStore`, `useLoadedEvents`, `createApolloTransport`.
- Produces: `EventsHome()` — lista de eventos; cada linha tem "Carregar evento" (busca `eventSignups`, `store.loadEvent`, navega para `/checkin/<slug>`) ou, se já carregado, "Abrir (carregado às HH:MM)" que só navega. Sem rede/erro → `Alert`/texto "Sem conexão: não foi possível carregar".

- [ ] **Step 1: Teste**

`src/components/checkin/__tests__/events-home.test.tsx`:

```tsx
import React from 'react';
import { MockedProvider } from '@apollo/client/testing';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { CheckinStore, MemoryStorage } from '@/features/checkin/store';
import { CheckinStoreProvider } from '@/features/checkin/store-provider';
import { EVENTS, EVENT_SIGNUPS } from '@/lib/queries';
import { EventsHome } from '../events-home';

const push = jest.fn();
jest.mock('expo-router', () => ({ useRouter: () => ({ push }) }));

const event = { __typename: 'Event', id: '1', documentId: '1', slug: 'meetup', title: 'Meetup', start_date: '2026-10-01T12:00:00.000Z', location: null };
const mocks = [
  { request: { query: EVENTS, variables: { sort: [{ start_date: 'DESC' }] } }, result: { data: { events: { __typename: 'PaginatedEvents', data: [event] } } } },
  {
    request: { query: EVENT_SIGNUPS, variables: { eventSlug: 'meetup' } },
    result: { data: { eventSignups: [{ __typename: 'EventSignup', id: 's1', name: 'Ana', email: null, phone_number: null, checked_in: false, checked_in_at: null, product_name: null }] } },
  },
];

const renderHome = async (store: CheckinStore) =>
  render(
    <MockedProvider mocks={mocks}>
      <CheckinStoreProvider store={store}>
        <EventsHome />
      </CheckinStoreProvider>
    </MockedProvider>,
  );

describe('EventsHome', () => {
  beforeEach(() => push.mockClear());

  it('loads the event signups into the store and opens the check-in screen', async () => {
    const store = new CheckinStore({ storage: new MemoryStorage() });
    await renderHome(store);
    fireEvent.press(await screen.findByText('Carregar evento'));
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(store.getEvent('meetup')?.signups).toHaveLength(1);
    expect(push).toHaveBeenCalledWith('/checkin/meetup');
  });

  it('opens an already loaded event without refetching', async () => {
    const store = new CheckinStore({ storage: new MemoryStorage(), now: () => '2026-09-12T13:05:00.000Z' });
    store.loadEvent('meetup', 'Meetup', []);
    await renderHome(store);
    fireEvent.press(await screen.findByText(/Abrir/));
    expect(push).toHaveBeenCalledWith('/checkin/meetup');
  });
});
```

- [ ] **Step 2: Rodar e ver falhar.**

- [ ] **Step 3: `events-list.tsx` — aceitar ação por linha**

Altere `EventsList` para receber `renderAction?: (event: EventSummary) => ReactNode` e renderizá-lo dentro de `EventRow` abaixo dos metadados. Assinatura: `export function EventsList({ renderAction }: { renderAction?: (event: EventSummary) => ReactNode })`. `EventRow` passa a receber `action?: ReactNode` e renderiza `{action}` como último filho.

- [ ] **Step 4: `events-home.tsx`**

```tsx
import { useApolloClient } from '@apollo/client';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Alert, Button, StyleSheet, Text, View } from 'react-native';
import { EventsList } from '@/components/events-list';
import { createApolloTransport } from '@/features/checkin/apollo-transport';
import { useCheckinStore, useLoadedEvents } from '@/features/checkin/store-provider';
import type { EventSummary } from '@/lib/types';

const hhmm = (iso: string) => new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });

export function EventsHome() {
  const store = useCheckinStore();
  const loaded = useLoadedEvents();
  const client = useApolloClient();
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);

  const load = async (event: EventSummary) => {
    setBusy(event.slug);
    try {
      const signups = await createApolloTransport(client).fetchSignups(event.slug);
      store.loadEvent(event.slug, event.title, signups);
      router.push(`/checkin/${event.slug}`);
    } catch (e) {
      Alert.alert('Sem conexão', `Não foi possível carregar o evento: ${(e as Error).message}`);
    } finally {
      setBusy(null);
    }
  };

  return (
    <EventsList
      renderAction={(event) => {
        const cached = loaded.find((l) => l.slug === event.slug);
        return (
          <View style={styles.action}>
            {cached ? (
              <Button title={`Abrir (carregado às ${hhmm(cached.loadedAt)})`} onPress={() => router.push(`/checkin/${event.slug}`)} />
            ) : (
              <Button title={busy === event.slug ? 'Carregando...' : 'Carregar evento'} disabled={busy === event.slug} onPress={() => void load(event)} />
            )}
            {cached ? <Text style={styles.hint}>Toque para recarregar do servidor ao abrir</Text> : null}
          </View>
        );
      }}
    />
  );
}

const styles = StyleSheet.create({ action: { marginTop: 8 }, hint: { fontSize: 11, color: '#888', marginTop: 4 } });
```

Remova o `<Text style={styles.hint}>` se não for implementar recarga na abertura (a tela de check-in já faz pull ao montar — então **remova**, é redundante).

- [ ] **Step 5: `src/app/index.tsx`**

```tsx
import { EventsHome } from '@/components/checkin/events-home';

export default function Index() {
  return <EventsHome />;
}
```

- [ ] **Step 6: Rodar tudo, ver passar; conferir no emulador** (`adb reverse tcp:8081 tcp:8081`, Metro rodando, app aberto): a home mostra "Carregar evento" em cada linha.

- [ ] **Step 7: Commit**

```bash
git add src/components/checkin/events-home.tsx src/components/checkin/__tests__/events-home.test.tsx src/components/events-list.tsx src/app/index.tsx
git commit -m "Home: load an event's signups for offline check-in"
```

---

### Task 9: Tela de check-in — status, busca, lista, credenciar

**Files:**
- Create: `src/components/checkin/status-bar.tsx`
- Create: `src/components/checkin/signup-row.tsx`
- Create: `src/components/checkin/checkin-sheet.tsx`
- Create: `src/components/checkin/checkin-screen.tsx`
- Create: `src/app/checkin/[slug]/index.tsx`
- Test: `src/components/checkin/__tests__/checkin-screen.test.tsx`

**Interfaces:**
- Consumes: `useEventCache`, `useCheckinStore`, `useEventSync(slug, engine?)`, `usePrinter`, `usePrintBadge`, `readLabelPrefs`, `matchesSearch`.
- Produces:
  ```ts
  export function CheckinScreen({ slug, engine?, printer?, printBadge? }: { slug: string; engine?: SyncEngine; printer?: PrinterState; printBadge?: (data: BadgeData) => Promise<void> })
  export function StatusBar({ online, syncing, pending, failed, lastSyncAt, printerReady, onSync }: ...)
  export function SignupRow({ signup, onPress }: { signup: LocalSignup; onPress(): void })
  export function CheckinSheet({ signup, printerReady, onPrintAndCheckin, onCheckinOnly, onReprint, onClose }: ...)
  ```
  Comportamento: toque numa linha abre o sheet (`Modal`). "Imprimir e credenciar": `printBadge` → sucesso: `store.checkIn` + `store.markPrinted`; erro: mostra mensagem no sheet e habilita "Credenciar sem imprimir". Já credenciado: mostra "Credenciado às HH:MM" + "Reimprimir". Barra de status com contadores (`outbox.filter(!failed).length` pendentes, `failed` com erro) e "Sincronizar agora".

- [ ] **Step 1: Teste**

`src/components/checkin/__tests__/checkin-screen.test.tsx`:

```tsx
import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { CheckinStore, MemoryStorage } from '@/features/checkin/store';
import { CheckinStoreProvider } from '@/features/checkin/store-provider';
import { FakeConnectivity, SyncEngine } from '@/features/checkin/sync';
import type { CheckinTransport } from '@/features/checkin/transport';
import type { PrinterState } from '@/features/printer/use-printer';
import { CheckinScreen } from '../checkin-screen';

jest.mock('../../../../modules/tspl-usb-printer', () => ({ isAvailable: false, listDevices: () => [], requestPermission: async () => false, printBitmap: async () => {} }));

const printer = (ready: boolean): PrinterState => ({ available: true, devices: [], selected: ready ? { deviceName: '/dev/p', vendorId: 1, productId: 1, productName: 'P', manufacturerName: null, hasPermission: true } : null, ready, refresh: () => {}, select: async () => true });

const setup = async ({ ready = true, printBadge = jest.fn().mockResolvedValue(undefined) } = {}) => {
  const store = new CheckinStore({ storage: new MemoryStorage(), now: () => '2026-09-12T10:00:00.000Z', uuid: () => 'u' });
  store.loadEvent('ev', 'Evento', [
    { id: 's1', name: 'José Ção', email: 'jose@x.io', product_name: 'Lote 1' },
    { id: 's2', name: 'Bia', checked_in: true, checked_in_at: '2026-09-12T09:30:00.000Z' },
  ]);
  const transport: CheckinTransport = { fetchSignups: async () => [], checkin: async () => ({ success: true }), walkin: async () => ({ success: true }) };
  const engine = new SyncEngine({ store, transport, connectivity: new FakeConnectivity(false) });
  await render(
    <CheckinStoreProvider store={store}>
      <CheckinScreen slug="ev" engine={engine} printer={printer(ready)} printBadge={printBadge} />
    </CheckinStoreProvider>,
  );
  return { store, printBadge };
};

describe('CheckinScreen', () => {
  it('lists signups, filters without accents and shows the status bar', async () => {
    await setup();
    expect(screen.getByText('José Ção')).toBeTruthy();
    expect(screen.getByText('Bia')).toBeTruthy();
    expect(screen.getByText(/offline/i)).toBeTruthy();
    fireEvent.changeText(screen.getByPlaceholderText('Buscar por nome ou e-mail'), 'cao');
    expect(screen.queryByText('Bia')).toBeNull();
    expect(screen.getByText('José Ção')).toBeTruthy();
  });

  it('prints and checks in from the sheet', async () => {
    const { store, printBadge } = await setup();
    fireEvent.press(screen.getByText('José Ção'));
    await act(async () => {
      fireEvent.press(screen.getByText('Imprimir e credenciar'));
    });
    expect(printBadge).toHaveBeenCalledWith({ fullName: 'José Ção', logoText: 'COMUNIDADE', link: 'https://hubcommunity.io' });
    const s1 = store.getEvent('ev')!.signups[0];
    expect(s1).toMatchObject({ checked_in: true, printed_at: '2026-09-12T10:00:00.000Z' });
    expect(store.getEvent('ev')!.outbox).toHaveLength(1);
    expect(screen.getByText(/1 pendente/)).toBeTruthy();
  });

  it('offers check-in without printing when printing fails', async () => {
    const { store } = await setup({ printBadge: jest.fn().mockRejectedValue(new Error('Impressora desconectada. Confira o cabo USB.')) });
    fireEvent.press(screen.getByText('José Ção'));
    await act(async () => {
      fireEvent.press(screen.getByText('Imprimir e credenciar'));
    });
    expect(screen.getByText('Impressora desconectada. Confira o cabo USB.')).toBeTruthy();
    expect(store.getEvent('ev')!.signups[0].checked_in).toBe(false);
    fireEvent.press(screen.getByText('Credenciar sem imprimir'));
    expect(store.getEvent('ev')!.signups[0].checked_in).toBe(true);
  });

  it('disables printing when no printer is ready and shows reprint for checked-in people', async () => {
    const { printBadge } = await setup({ ready: false });
    fireEvent.press(screen.getByText('Bia'));
    expect(screen.getByText(/Credenciado às/)).toBeTruthy();
    const reprint = screen.getByText('Reimprimir');
    expect(reprint.props.accessibilityState?.disabled ?? reprint.parent?.props.accessibilityState?.disabled).toBeTruthy();
    expect(screen.getByText('Sem impressora selecionada')).toBeTruthy();
    expect(printBadge).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Rodar e ver falhar.**

- [ ] **Step 3: `status-bar.tsx`**

```tsx
import { Button, StyleSheet, Text, View } from 'react-native';

export interface StatusBarProps {
  online: boolean;
  syncing: boolean;
  pending: number;
  failed: number;
  lastSyncAt?: string;
  lastError?: string;
  printerReady: boolean;
  onSync(): void;
}

const hhmm = (iso: string) => new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });

export function StatusBar({ online, syncing, pending, failed, lastSyncAt, lastError, printerReady, onSync }: StatusBarProps) {
  return (
    <View style={styles.bar}>
      <View style={styles.row}>
        <Text style={[styles.pill, online ? styles.ok : styles.bad]}>{online ? 'online' : 'offline'}</Text>
        <Text style={[styles.pill, printerReady ? styles.ok : styles.bad]}>{printerReady ? 'impressora ok' : 'sem impressora'}</Text>
        <Text style={styles.pill}>{pending} pendente{pending === 1 ? '' : 's'}</Text>
        {failed > 0 ? <Text style={[styles.pill, styles.bad]}>{failed} com erro</Text> : null}
      </View>
      <View style={styles.row}>
        <Text style={styles.meta}>{syncing ? 'Sincronizando...' : lastSyncAt ? `Sincronizado às ${hhmm(lastSyncAt)}` : 'Ainda não sincronizado'}</Text>
        <Button title="Sincronizar agora" onPress={onSync} disabled={!online || syncing} />
      </View>
      {lastError ? <Text style={styles.error}>{lastError}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: { padding: 12, gap: 6, backgroundColor: '#f4f4f5', borderBottomWidth: StyleSheet.hairlineWidth, borderColor: '#ccc' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  pill: { fontSize: 12, paddingHorizontal: 8, paddingVertical: 2, borderRadius: 999, backgroundColor: '#e4e4e7', overflow: 'hidden' },
  ok: { backgroundColor: '#d1fae5', color: '#065f46' },
  bad: { backgroundColor: '#fee2e2', color: '#991b1b' },
  meta: { flex: 1, fontSize: 12, color: '#555' },
  error: { fontSize: 12, color: '#991b1b' },
});
```

- [ ] **Step 4: `signup-row.tsx`**

```tsx
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { LocalSignup } from '@/features/checkin/types';

export function SignupRow({ signup, onPress }: { signup: LocalSignup; onPress(): void }) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.row, pressed && styles.pressed]}>
      <View style={styles.info}>
        <Text style={styles.name}>{signup.name}</Text>
        <Text style={styles.meta}>{[signup.email, signup.product_name].filter(Boolean).join(' · ')}</Text>
      </View>
      {signup.checked_in ? <Text style={styles.badge}>credenciado</Text> : null}
      {signup.source === 'walkin' && signup.id.startsWith('local:') ? <Text style={styles.local}>na hora</Text> : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: '#ccc', gap: 8 },
  pressed: { backgroundColor: '#f4f4f5' },
  info: { flex: 1 },
  name: { fontSize: 16, fontWeight: '600' },
  meta: { fontSize: 13, color: '#666', marginTop: 2 },
  badge: { fontSize: 12, color: '#065f46', backgroundColor: '#d1fae5', paddingHorizontal: 8, paddingVertical: 2, borderRadius: 999, overflow: 'hidden' },
  local: { fontSize: 12, color: '#5b21b6', backgroundColor: '#ede9fe', paddingHorizontal: 8, paddingVertical: 2, borderRadius: 999, overflow: 'hidden' },
});
```

- [ ] **Step 5: `checkin-sheet.tsx`**

```tsx
import { useState } from 'react';
import { Button, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import type { LocalSignup } from '@/features/checkin/types';

export interface CheckinSheetProps {
  signup: LocalSignup | null;
  printerReady: boolean;
  printing: boolean;
  onPrintAndCheckin(signup: LocalSignup): Promise<void>;
  onCheckinOnly(signup: LocalSignup): void;
  onReprint(signup: LocalSignup): Promise<void>;
  onClose(): void;
}

const hhmm = (iso: string) => new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });

export function CheckinSheet({ signup, printerReady, printing, onPrintAndCheckin, onCheckinOnly, onReprint, onClose }: CheckinSheetProps) {
  const [error, setError] = useState<string | null>(null);
  const close = () => {
    setError(null);
    onClose();
  };
  const attempt = async (fn: () => Promise<void>) => {
    setError(null);
    try {
      await fn();
      close();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <Modal visible={signup != null} transparent animationType="slide" onRequestClose={close}>
      <Pressable style={styles.backdrop} onPress={close} />
      {signup ? (
        <View style={styles.sheet}>
          <Text style={styles.name}>{signup.name}</Text>
          <Text style={styles.meta}>{[signup.email, signup.product_name].filter(Boolean).join(' · ')}</Text>
          {signup.checked_in ? (
            <>
              <Text style={styles.done}>Credenciado às {signup.checked_in_at ? hhmm(signup.checked_in_at) : '--:--'}</Text>
              <Button title="Reimprimir" disabled={!printerReady || printing} onPress={() => void attempt(() => onReprint(signup))} />
            </>
          ) : (
            <>
              <Button title={printing ? 'Imprimindo...' : 'Imprimir e credenciar'} disabled={!printerReady || printing} onPress={() => void attempt(() => onPrintAndCheckin(signup))} />
              {error || !printerReady ? (
                <Button title="Credenciar sem imprimir" onPress={() => { onCheckinOnly(signup); close(); }} />
              ) : null}
            </>
          )}
          {!printerReady ? <Text style={styles.warn}>Sem impressora selecionada</Text> : null}
          {error ? <Text style={styles.error}>{error}</Text> : null}
          <Button title="Fechar" color="#888" onPress={close} />
        </View>
      ) : null}
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.35)' },
  sheet: { backgroundColor: '#fff', padding: 20, gap: 10, borderTopLeftRadius: 16, borderTopRightRadius: 16 },
  name: { fontSize: 24, fontWeight: '800' },
  meta: { color: '#666' },
  done: { color: '#065f46', fontWeight: '600' },
  warn: { color: '#92400e' },
  error: { color: '#991b1b' },
});
```

- [ ] **Step 6: `checkin-screen.tsx`**

```tsx
import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { Button, FlatList, StyleSheet, Text, TextInput, View } from 'react-native';
import { matchesSearch } from '@/features/checkin/merge';
import { useCheckinStore, useEventCache } from '@/features/checkin/store-provider';
import type { SyncEngine } from '@/features/checkin/sync';
import type { LocalSignup } from '@/features/checkin/types';
import { useEventSync } from '@/features/checkin/use-sync';
import { readLabelPrefs } from '@/features/printer/printer-prefs';
import { usePrintBadge, type BadgeData } from '@/features/printer/use-print-badge';
import { usePrinter, type PrinterState } from '@/features/printer/use-printer';
import { MemoryStorage } from '@/features/checkin/store';
import { CheckinSheet } from './checkin-sheet';
import { SignupRow } from './signup-row';
import { StatusBar } from './status-bar';

interface Props {
  slug: string;
  engine?: SyncEngine;
  printer?: PrinterState;
  printBadge?: (data: BadgeData) => Promise<void>;
}

export function CheckinScreen({ slug, engine, printer: printerOverride, printBadge: printOverride }: Props) {
  const store = useCheckinStore();
  const event = useEventCache(slug);
  const sync = useEventSync(slug, engine);
  const router = useRouter();
  const ownPrinter = usePrinter();
  const printer = printerOverride ?? ownPrinter;
  const label = useMemo(() => readLabelPrefs(new MemoryStorage()), []);
  const ownPrint = usePrintBadge({ deviceName: printer.selected?.deviceName ?? null, label });
  const print = printOverride ?? ownPrint.print;
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<LocalSignup | null>(null);

  if (!event) {
    return (
      <View style={styles.center}>
        <Text>Evento não carregado.</Text>
        <Button title="Voltar" onPress={() => router.back()} />
      </View>
    );
  }

  const badge = (s: LocalSignup): BadgeData => ({ fullName: s.name, logoText: event.settings.logoText, link: event.settings.link });
  const visible = event.signups.filter((s) => matchesSearch(s, query));
  const pending = event.outbox.filter((i) => !i.failed).length;
  const failed = event.outbox.filter((i) => i.failed).length;

  return (
    <View style={styles.screen}>
      {ownPrint.offscreen}
      <StatusBar
        online={sync.online}
        syncing={sync.syncing}
        pending={pending}
        failed={failed}
        lastSyncAt={sync.lastSyncAt}
        lastError={sync.lastError}
        printerReady={printer.ready}
        onSync={() => void sync.syncNow()}
      />
      <View style={styles.toolbar}>
        <TextInput style={styles.search} placeholder="Buscar por nome ou e-mail" value={query} onChangeText={setQuery} autoCorrect={false} />
        <Button title="Inscrever na hora" onPress={() => router.push(`/checkin/${slug}/walkin`)} />
        <Button title="Config." color="#888" onPress={() => router.push(`/checkin/${slug}/settings`)} />
      </View>
      <FlatList
        data={visible}
        keyExtractor={(s) => s.id}
        renderItem={({ item }) => <SignupRow signup={item} onPress={() => setSelected(item)} />}
        keyboardShouldPersistTaps="handled"
        ListEmptyComponent={<Text style={styles.empty}>Nenhum inscrito encontrado.</Text>}
      />
      <CheckinSheet
        signup={selected}
        printerReady={printer.ready}
        printing={ownPrint.printing}
        onPrintAndCheckin={async (s) => {
          await print(badge(s));
          store.checkIn(slug, s.id);
          store.markPrinted(slug, s.id);
        }}
        onCheckinOnly={(s) => store.checkIn(slug, s.id)}
        onReprint={async (s) => {
          await print(badge(s));
          store.markPrinted(slug, s.id);
        }}
        onClose={() => setSelected(null)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 },
  toolbar: { flexDirection: 'row', gap: 8, padding: 12, alignItems: 'center' },
  search: { flex: 1, borderWidth: 1, borderColor: '#ccc', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 8 },
  empty: { textAlign: 'center', color: '#666', padding: 24 },
});
```

Substitua `readLabelPrefs(new MemoryStorage())` por leitura do storage real: exporte de `use-printer.ts` a função `getPrinterStorage(): KeyValueStorage` (renomeie `getDefaultStorage` e exporte) e use `readLabelPrefs(getPrinterStorage())`. Nos testes o módulo nativo e o MMKV estão mockados, então isso funciona.

- [ ] **Step 7: Rota** `src/app/checkin/[slug]/index.tsx`

```tsx
import { useLocalSearchParams } from 'expo-router';
import { CheckinScreen } from '@/components/checkin/checkin-screen';

export default function CheckinRoute() {
  const { slug } = useLocalSearchParams<{ slug: string }>();
  return <CheckinScreen slug={slug} />;
}
```

- [ ] **Step 8: Rodar tudo; ver passar. Regenerar typed routes** (`timeout 40 pnpm exec expo start --port 8099 >/dev/null 2>&1 || true`) antes do `tsc`. Conferir no emulador: carregar um evento na home, ver a lista, abrir o sheet.

- [ ] **Step 9: Commit**

```bash
git add src/components/checkin src/app/checkin
git commit -m "Check-in screen: search, status bar and print-and-check-in sheet"
```

---

### Task 10: Walk-in (inscrever na hora)

**Files:**
- Create: `src/components/checkin/walkin-form.tsx`
- Create: `src/app/checkin/[slug]/walkin.tsx`
- Test: `src/components/checkin/__tests__/walkin-form.test.tsx`

**Interfaces:**
- Consumes: `useCheckinStore`, `useEventCache`, `normalize`, `usePrinter`, `usePrintBadge`.
- Produces: `WalkinForm({ slug, printer?, printBadge?, onDone })` — campos Nome, E-mail, Telefone; botão "Imprimir e inscrever"; validação (nome e e-mail obrigatórios, e-mail `/^\S+@\S+\.\S+$/`); e-mail já na lista (comparação normalizada) → mensagem "Este e-mail já está inscrito" + botão "Ir para o check-in" (chama `onDone(existingId)`); sucesso: `store.addWalkin` → print → `checkIn` + `markPrinted` → `onDone(newId)`; falha na impressão: mantém o walk-in criado, faz `checkIn` e mostra "Inscrição salva; crachá não impresso: <erro>" com botão "Concluir". Sem `settings.batchId` → aviso "Selecione o lote nas configurações antes de inscrever" e botão desabilitado.

- [ ] **Step 1: Teste**

```tsx
import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { CheckinStore, MemoryStorage } from '@/features/checkin/store';
import { CheckinStoreProvider } from '@/features/checkin/store-provider';
import type { PrinterState } from '@/features/printer/use-printer';
import { WalkinForm } from '../walkin-form';

jest.mock('../../../../modules/tspl-usb-printer', () => ({ isAvailable: false, listDevices: () => [], requestPermission: async () => false, printBitmap: async () => {} }));

const printer: PrinterState = { available: true, devices: [], selected: { deviceName: '/dev/p', vendorId: 1, productId: 1, productName: 'P', manufacturerName: null, hasPermission: true }, ready: true, refresh: () => {}, select: async () => true };

const setup = async ({ batchId = '7', printBadge = jest.fn().mockResolvedValue(undefined) } = {}) => {
  const store = new CheckinStore({ storage: new MemoryStorage(), uuid: () => 'u' });
  store.loadEvent('ev', 'Evento', [{ id: 's1', name: 'Ana', email: 'Ana@x.io' }]);
  store.updateSettings('ev', { batchId });
  const onDone = jest.fn();
  await render(
    <CheckinStoreProvider store={store}>
      <WalkinForm slug="ev" printer={printer} printBadge={printBadge} onDone={onDone} />
    </CheckinStoreProvider>,
  );
  return { store, onDone, printBadge };
};

const fill = (name: string, email: string) => {
  fireEvent.changeText(screen.getByPlaceholderText('Nome completo'), name);
  fireEvent.changeText(screen.getByPlaceholderText('E-mail'), email);
};

describe('WalkinForm', () => {
  it('validates required fields', async () => {
    await setup();
    fireEvent.press(screen.getByText('Imprimir e inscrever'));
    expect(screen.getByText('Informe o nome')).toBeTruthy();
    fill('Caio', 'caio');
    fireEvent.press(screen.getByText('Imprimir e inscrever'));
    expect(screen.getByText('E-mail inválido')).toBeTruthy();
  });

  it('detects an email that is already signed up', async () => {
    const { onDone } = await setup();
    fill('Ana', 'ana@X.IO ');
    fireEvent.press(screen.getByText('Imprimir e inscrever'));
    expect(screen.getByText('Este e-mail já está inscrito')).toBeTruthy();
    fireEvent.press(screen.getByText('Ir para o check-in'));
    expect(onDone).toHaveBeenCalledWith('s1');
  });

  it('creates the walk-in, prints, checks in and enqueues both operations', async () => {
    const { store, onDone, printBadge } = await setup();
    fill('Caio Melo', 'caio@x.io');
    fireEvent.changeText(screen.getByPlaceholderText('Telefone (opcional)'), '62999');
    await act(async () => {
      fireEvent.press(screen.getByText('Imprimir e inscrever'));
    });
    expect(printBadge).toHaveBeenCalledWith({ fullName: 'Caio Melo', logoText: 'COMUNIDADE', link: 'https://hubcommunity.io' });
    const ev = store.getEvent('ev')!;
    expect(ev.signups.at(-1)).toMatchObject({ id: 'local:u', name: 'Caio Melo', email: 'caio@x.io', phone_number: '62999', checked_in: true, printed_at: expect.any(String) });
    expect(ev.outbox.map((i) => i.kind)).toEqual(['walkin', 'checkin']);
    expect(onDone).toHaveBeenCalledWith('local:u');
  });

  it('keeps the signup when printing fails', async () => {
    const { store } = await setup({ printBadge: jest.fn().mockRejectedValue(new Error('Impressora desconectada. Confira o cabo USB.')) });
    fill('Caio', 'caio@x.io');
    await act(async () => {
      fireEvent.press(screen.getByText('Imprimir e inscrever'));
    });
    expect(screen.getByText(/crachá não impresso: Impressora desconectada/)).toBeTruthy();
    expect(store.getEvent('ev')!.signups.at(-1)).toMatchObject({ name: 'Caio', checked_in: true });
  });

  it('blocks when no batch is configured', async () => {
    await setup({ batchId: '' });
    expect(screen.getByText('Selecione o lote nas configurações antes de inscrever')).toBeTruthy();
  });
});
```

- [ ] **Step 2: Rodar e ver falhar.**

- [ ] **Step 3: `walkin-form.tsx`**

```tsx
import { useState } from 'react';
import { Button, StyleSheet, Text, TextInput, View } from 'react-native';
import { normalize } from '@/features/checkin/merge';
import { useCheckinStore, useEventCache } from '@/features/checkin/store-provider';
import { getPrinterStorage, usePrinter, type PrinterState } from '@/features/printer/use-printer';
import { readLabelPrefs } from '@/features/printer/printer-prefs';
import { usePrintBadge, type BadgeData } from '@/features/printer/use-print-badge';

interface Props {
  slug: string;
  printer?: PrinterState;
  printBadge?: (data: BadgeData) => Promise<void>;
  onDone(signupId: string): void;
}

const EMAIL = /^\S+@\S+\.\S+$/;

export function WalkinForm({ slug, printer: printerOverride, printBadge: printOverride, onDone }: Props) {
  const store = useCheckinStore();
  const event = useEventCache(slug);
  const ownPrinter = usePrinter();
  const printer = printerOverride ?? ownPrinter;
  const ownPrint = usePrintBadge({ deviceName: printer.selected?.deviceName ?? null, label: readLabelPrefs(getPrinterStorage()) });
  const print = printOverride ?? ownPrint.print;

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [existingId, setExistingId] = useState<string | null>(null);
  const [savedWithoutBadge, setSavedWithoutBadge] = useState<{ id: string; message: string } | null>(null);
  const [busy, setBusy] = useState(false);

  if (!event) return <Text style={styles.error}>Evento não carregado.</Text>;
  const noBatch = !event.settings.batchId;

  const submit = async () => {
    setError(null);
    setExistingId(null);
    const cleanName = name.trim();
    const cleanEmail = email.trim().toLowerCase();
    if (!cleanName) return setError('Informe o nome');
    if (!EMAIL.test(cleanEmail)) return setError('E-mail inválido');
    const existing = event.signups.find((s) => normalize(s.email ?? '') === normalize(cleanEmail));
    if (existing) {
      setExistingId(existing.id);
      return setError('Este e-mail já está inscrito');
    }
    setBusy(true);
    const created = store.addWalkin(slug, { name: cleanName, email: cleanEmail, phone_number: phone.trim() || undefined });
    try {
      await print({ fullName: created.name, logoText: event.settings.logoText, link: event.settings.link });
      store.checkIn(slug, created.id);
      store.markPrinted(slug, created.id);
      onDone(created.id);
    } catch (e) {
      store.checkIn(slug, created.id);
      setSavedWithoutBadge({ id: created.id, message: (e as Error).message });
    } finally {
      setBusy(false);
    }
  };

  if (savedWithoutBadge) {
    return (
      <View style={styles.form}>
        <Text style={styles.warn}>Inscrição salva; crachá não impresso: {savedWithoutBadge.message}</Text>
        <Button title="Concluir" onPress={() => onDone(savedWithoutBadge.id)} />
      </View>
    );
  }

  return (
    <View style={styles.form}>
      {noBatch ? <Text style={styles.warn}>Selecione o lote nas configurações antes de inscrever</Text> : null}
      <TextInput style={styles.input} placeholder="Nome completo" value={name} onChangeText={setName} autoCapitalize="words" />
      <TextInput style={styles.input} placeholder="E-mail" value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address" autoCorrect={false} />
      <TextInput style={styles.input} placeholder="Telefone (opcional)" value={phone} onChangeText={setPhone} keyboardType="phone-pad" />
      {error ? <Text style={styles.error}>{error}</Text> : null}
      {existingId ? <Button title="Ir para o check-in" onPress={() => onDone(existingId)} /> : null}
      <Button title={busy ? 'Imprimindo...' : 'Imprimir e inscrever'} disabled={busy || noBatch} onPress={() => void submit()} />
      {!printer.ready ? <Text style={styles.warn}>Sem impressora selecionada — a inscrição será salva sem crachá</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  form: { padding: 16, gap: 10 },
  input: { borderWidth: 1, borderColor: '#ccc', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 8, fontSize: 16 },
  error: { color: '#991b1b' },
  warn: { color: '#92400e' },
});
```

Rota `src/app/checkin/[slug]/walkin.tsx`:

```tsx
import { useLocalSearchParams, useRouter } from 'expo-router';
import { WalkinForm } from '@/components/checkin/walkin-form';

export default function WalkinRoute() {
  const { slug } = useLocalSearchParams<{ slug: string }>();
  const router = useRouter();
  return <WalkinForm slug={slug} onDone={() => router.back()} />;
}
```

- [ ] **Step 4: Rodar tudo, ver passar; conferir no emulador.**

- [ ] **Step 5: Commit**

```bash
git add src/components/checkin/walkin-form.tsx src/components/checkin/__tests__/walkin-form.test.tsx src/app/checkin
git commit -m "Walk-in registration: print now, sync the signup later"
```

---

### Task 11: Configurações do evento (logo, link, lote, impressora, fila com erro)

**Files:**
- Create: `src/components/checkin/event-settings-screen.tsx`
- Create: `src/app/checkin/[slug]/settings.tsx`
- Test: `src/components/checkin/__tests__/event-settings-screen.test.tsx`

**Interfaces:**
- Consumes: `EVENT_BATCHES`, `useEventCache`, `useCheckinStore`, `usePrinter`, `readLabelPrefs`/`writeLabelPrefs`.
- Produces: `EventSettingsScreen({ slug, printer? })` — campos `logoText`, `link` (salvam em `store.updateSettings` no blur/alteração); lote: lista de `products[].batches[]` habilitados como botões "Produto · Lote N (R$ valor)" com o selecionado destacado (salva `batchId`); impressora: lista de `printer.devices` com "Selecionar" (chama `printer.select`), estado "selecionada ✓ / sem permissão"; parâmetros `gapMm`/`density`; seção "Pendências com erro": itens `failed` da outbox com `lastError`, botões "Tentar de novo" (`retryOutboxItem`) e "Descartar" (`discardOutboxItem`). Botão "Remover evento deste aparelho" com `Alert.alert` de confirmação → `store.removeEvent` + `router.replace('/')`.

- [ ] **Step 1: Teste**

```tsx
import React from 'react';
import { MockedProvider } from '@apollo/client/testing';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { CheckinStore, MemoryStorage } from '@/features/checkin/store';
import { CheckinStoreProvider } from '@/features/checkin/store-provider';
import type { PrinterState } from '@/features/printer/use-printer';
import { EVENT_BATCHES } from '@/lib/queries';
import { EventSettingsScreen } from '../event-settings-screen';

jest.mock('expo-router', () => ({ useRouter: () => ({ replace: jest.fn(), back: jest.fn() }) }));
jest.mock('../../../../modules/tspl-usb-printer', () => ({ isAvailable: false, listDevices: () => [], requestPermission: async () => false, printBitmap: async () => {} }));

const mocks = [
  {
    request: { query: EVENT_BATCHES, variables: { slugOrId: 'ev' } },
    result: {
      data: {
        eventBySlugOrId: {
          __typename: 'Event', id: '1', title: 'Evento',
          products: [{ __typename: 'Product', id: 'p1', name: 'Ingresso', enabled: true, batches: [{ __typename: 'Batch', id: '7', batch_number: 1, value: 0, enabled: true }, { __typename: 'Batch', id: '8', batch_number: 2, value: 50, enabled: false }] }],
        },
      },
    },
  },
];

const device = { deviceName: '/dev/p', vendorId: 1, productId: 2, productName: '4BARCODE', manufacturerName: null, hasPermission: false };

const setup = async () => {
  const store = new CheckinStore({ storage: new MemoryStorage(), uuid: () => 'u' });
  store.loadEvent('ev', 'Evento', [{ id: 's1', name: 'Ana' }]);
  store.checkIn('ev', 's1');
  store.outboxFailed('ev', 'u', 'E-mail inválido', { permanent: true });
  const select = jest.fn().mockResolvedValue(true);
  const printer: PrinterState = { available: true, devices: [device], selected: null, ready: false, refresh: () => {}, select };
  await render(
    <MockedProvider mocks={mocks}>
      <CheckinStoreProvider store={store}>
        <EventSettingsScreen slug="ev" printer={printer} />
      </CheckinStoreProvider>
    </MockedProvider>,
  );
  return { store, select };
};

describe('EventSettingsScreen', () => {
  it('edits logo text and link', async () => {
    const { store } = await setup();
    fireEvent.changeText(screen.getByPlaceholderText('Texto do logo'), 'REACTIVANDO');
    fireEvent.changeText(screen.getByPlaceholderText('Link do QR'), 'https://reactivando.io');
    expect(store.getEvent('ev')!.settings).toMatchObject({ logoText: 'REACTIVANDO', link: 'https://reactivando.io' });
  });

  it('lists enabled batches and stores the chosen one', async () => {
    const { store } = await setup();
    fireEvent.press(await screen.findByText('Ingresso · Lote 1 (grátis)'));
    expect(screen.queryByText(/Lote 2/)).toBeNull();
    expect(store.getEvent('ev')!.settings.batchId).toBe('7');
  });

  it('selects a printer', async () => {
    const { select } = await setup();
    fireEvent.press(screen.getByText('Selecionar'));
    expect(select).toHaveBeenCalledWith(device);
  });

  it('shows failed outbox items with retry and discard', async () => {
    const { store } = await setup();
    expect(screen.getByText(/E-mail inválido/)).toBeTruthy();
    fireEvent.press(screen.getByText('Tentar de novo'));
    expect(store.getEvent('ev')!.outbox[0].failed).toBeUndefined();
  });
});
```

- [ ] **Step 2: Rodar e ver falhar.**

- [ ] **Step 3: `event-settings-screen.tsx`**

```tsx
import { useQuery } from '@apollo/client';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Alert, Button, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useCheckinStore, useEventCache } from '@/features/checkin/store-provider';
import { DEFAULT_LABEL, readLabelPrefs, writeLabelPrefs, type LabelPrefs } from '@/features/printer/printer-prefs';
import { getPrinterStorage, usePrinter, type PrinterState } from '@/features/printer/use-printer';
import { EVENT_BATCHES } from '@/lib/queries';
import type { EventBatchesResponse } from '@/lib/types';

const money = (v: number) => (v > 0 ? `R$ ${v.toFixed(2).replace('.', ',')}` : 'grátis');

export function EventSettingsScreen({ slug, printer: printerOverride }: { slug: string; printer?: PrinterState }) {
  const store = useCheckinStore();
  const event = useEventCache(slug);
  const router = useRouter();
  const ownPrinter = usePrinter();
  const printer = printerOverride ?? ownPrinter;
  const { data } = useQuery<EventBatchesResponse>(EVENT_BATCHES, { variables: { slugOrId: slug }, fetchPolicy: 'cache-and-network' });
  const [label, setLabel] = useState<LabelPrefs>(() => readLabelPrefs(getPrinterStorage()));

  if (!event) return <Text style={styles.warn}>Evento não carregado.</Text>;
  const failed = event.outbox.filter((i) => i.failed);
  const batches = (data?.eventBySlugOrId?.products ?? [])
    .filter((p) => p.enabled !== false)
    .flatMap((p) => (p.batches ?? []).filter((b) => b.enabled !== false).map((b) => ({ id: String(b.id), label: `${p.name} · Lote ${b.batch_number} (${money(b.value ?? 0)})` })));

  const updateLabel = (patch: Partial<LabelPrefs>) => {
    const next = { ...label, ...patch };
    setLabel(next);
    writeLabelPrefs(getPrinterStorage(), next);
  };

  return (
    <ScrollView contentContainerStyle={styles.page}>
      <Text style={styles.h}>Crachá</Text>
      <TextInput style={styles.input} placeholder="Texto do logo" value={event.settings.logoText} onChangeText={(logoText) => store.updateSettings(slug, { logoText })} />
      <TextInput style={styles.input} placeholder="Link do QR" value={event.settings.link} autoCapitalize="none" onChangeText={(link) => store.updateSettings(slug, { link })} />

      <Text style={styles.h}>Lote para inscrição na hora</Text>
      {batches.length === 0 ? <Text style={styles.meta}>Nenhum lote habilitado (ou sem conexão para listar).</Text> : null}
      {batches.map((b) => (
        <Pressable key={b.id} onPress={() => store.updateSettings(slug, { batchId: b.id })} style={[styles.option, event.settings.batchId === b.id && styles.optionSelected]}>
          <Text>{b.label}</Text>
        </Pressable>
      ))}

      <Text style={styles.h}>Impressora USB</Text>
      {!printer.available ? <Text style={styles.warn}>Impressão USB só funciona no Android.</Text> : null}
      {printer.devices.length === 0 ? <Text style={styles.meta}>Nenhuma impressora conectada.</Text> : null}
      {printer.devices.map((d) => {
        const isSelected = printer.selected?.deviceName === d.deviceName;
        return (
          <View key={d.deviceName} style={styles.deviceRow}>
            <Text style={styles.deviceName}>
              {d.productName ?? d.deviceName} {isSelected ? (d.hasPermission ? '✓ selecionada' : '(sem permissão)') : ''}
            </Text>
            <Button title="Selecionar" onPress={() => void printer.select(d)} />
          </View>
        );
      })}
      <View style={styles.row}>
        <Text style={styles.meta}>Gap (mm)</Text>
        <TextInput style={styles.small} keyboardType="numeric" value={String(label.gapMm)} onChangeText={(v) => updateLabel({ gapMm: Number(v) || DEFAULT_LABEL.gapMm })} />
        <Text style={styles.meta}>Densidade</Text>
        <TextInput style={styles.small} keyboardType="numeric" value={String(label.density)} onChangeText={(v) => updateLabel({ density: Number(v) || DEFAULT_LABEL.density })} />
      </View>

      <Text style={styles.h}>Pendências com erro ({failed.length})</Text>
      {failed.map((item) => (
        <View key={item.id} style={styles.failed}>
          <Text>{item.kind === 'walkin' ? `Inscrição: ${item.input.name}` : `Check-in: ${item.signupId}`}</Text>
          <Text style={styles.warn}>{item.lastError}</Text>
          <View style={styles.row}>
            <Button title="Tentar de novo" onPress={() => store.retryOutboxItem(slug, item.id)} />
            <Button title="Descartar" color="#991b1b" onPress={() => store.discardOutboxItem(slug, item.id)} />
          </View>
        </View>
      ))}

      <View style={styles.danger}>
        <Button
          title="Remover evento deste aparelho"
          color="#991b1b"
          onPress={() =>
            Alert.alert('Remover evento', event.outbox.length > 0 ? `Há ${event.outbox.length} operação(ões) não sincronizada(s). Remover mesmo assim?` : 'Remover os dados deste evento do aparelho?', [
              { text: 'Cancelar', style: 'cancel' },
              { text: 'Remover', style: 'destructive', onPress: () => { store.removeEvent(slug); router.replace('/'); } },
            ])
          }
        />
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  page: { padding: 16, gap: 8 },
  h: { fontWeight: '700', marginTop: 16 },
  meta: { color: '#666' },
  warn: { color: '#92400e' },
  input: { borderWidth: 1, borderColor: '#ccc', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 8 },
  small: { borderWidth: 1, borderColor: '#ccc', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 6, width: 64 },
  option: { padding: 12, borderWidth: 1, borderColor: '#ccc', borderRadius: 8 },
  optionSelected: { borderColor: '#10B981', backgroundColor: '#d1fae5' },
  deviceRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  deviceName: { flex: 1 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  failed: { borderWidth: 1, borderColor: '#fca5a5', borderRadius: 8, padding: 10, gap: 4 },
  danger: { marginTop: 32 },
});
```

Adicione a `src/lib/types.ts`:

```ts
export interface EventBatch { id: string; batch_number: number; value?: number | null; enabled?: boolean | null }
export interface EventProduct { id: string; name: string; enabled?: boolean | null; batches?: EventBatch[] | null }
export interface EventBatchesResponse { eventBySlugOrId: { id: string; title: string; products?: EventProduct[] | null } | null }
```

Rota `src/app/checkin/[slug]/settings.tsx`:

```tsx
import { useLocalSearchParams } from 'expo-router';
import { EventSettingsScreen } from '@/components/checkin/event-settings-screen';

export default function SettingsRoute() {
  const { slug } = useLocalSearchParams<{ slug: string }>();
  return <EventSettingsScreen slug={slug} />;
}
```

- [ ] **Step 4: Rodar tudo, ver passar; conferir no emulador.**

- [ ] **Step 5: Commit**

```bash
git add src/components/checkin/event-settings-screen.tsx src/components/checkin/__tests__/event-settings-screen.test.tsx src/app/checkin src/lib/types.ts
git commit -m "Event settings: badge text, batch, printer, label params and failed queue"
```

---

### Task 12: Limpeza do spike, docs e build

**Files:**
- Delete: `src/app/print-test.tsx`
- Modify: `CLAUDE.md`, `README.md`
- Modify: `modules/tspl-usb-printer/index.ts` (só o comentário de cabeçalho: não é mais spike)

- [ ] **Step 1: Remover a tela do spike e o link na home** (o link já saiu na Task 8 ao reescrever `index.tsx`; confirme com `grep -rn "print-test" src` → vazio).

```bash
git rm src/app/print-test.tsx
```

- [ ] **Step 2: Docs** — em `CLAUDE.md`, adicione seção:

```markdown
## Offline check-in (`src/features/checkin`, `src/features/printer`)
- Spec: `docs/superpowers/specs/2026-09-12-offline-checkin-design.md`.
- `CheckinStore` holds every loaded event in memory and persists each as JSON in MMKV (`checkin:<slug>`); `SyncEngine` pulls `eventSignups` every 30 s and pushes the outbox FIFO through `CheckinTransport`. Pure modules take storage/transport/connectivity by injection — tests use `MemoryStorage`, `FakeConnectivity` and a mocked transport, never MMKV/NetInfo.
- Printing: `modules/tspl-usb-printer` (Kotlin, USB Host + TSPL) — Android dev build only (`pnpm android`). `usePrintBadge` renders `BadgeLabel` offscreen, captures PNG with view-shot and sends it as a 1bpp `BITMAP`.
- Tests that import printer hooks must `jest.mock('../../../../modules/tspl-usb-printer', ...)`.
```

No `README.md`, na seção "Rodando", acrescente: "Impressão USB exige dev build Android: `pnpm android` (emulador ou aparelho com OTG)."

- [ ] **Step 3: Verificação completa**

Run: `pnpm test && pnpm exec tsc --noEmit && pnpm lint && CI=1 pnpm exec expo export --platform android --output-dir /tmp/hc-export >/dev/null && echo BUNDLE_OK`
Expected: tudo verde + `BUNDLE_OK`.

Build nativo: `CI=1 pnpm exec expo prebuild --platform android --clean --no-install && (cd android && ./gradlew :app:assembleDebug -q)` → `android/app/build/outputs/apk/debug/app-debug.apk`; instalar no emulador (`adb install -r`) e percorrer: home → carregar evento → check-in (sheet, "Credenciar sem imprimir" já que não há impressora) → inscrever na hora → configurações → sincronizar.

- [ ] **Step 4: Commit e PR**

```bash
git add -A
git commit -m "Remove the print spike screen and document the offline check-in modules"
git push -u origin feat/offline-checkin
gh pr create --repo reactivandoio/hub-community-mobile --base main --title "Offline check-in with USB badge printing" --body "..."
```

Nota: `main` no GitHub ainda pode estar com o commit antigo do template SDK 52 se o force push do bootstrap não foi feito — confirme com `git ls-remote origin main` antes de abrir o PR; se for o caso, primeiro `git push --force origin main` a partir do commit `726d801` (bootstrap).

---

## Self-review

- **Cobertura da spec:** §3 arquitetura → Tasks 2–7 (nomes de arquivo iguais ao mapa); §4 modelo → Task 2/3; §5.1 carga → Task 8; §5.2 pull/merge → Tasks 2, 5; §5.3 push/outbox/backoff/idempotência → Tasks 4, 5, 1; §5.5 indicadores → Task 9; §6 fluxo (home, check-in, walk-in, configurações) → Tasks 8–11; §7 BFF → Task 1; §8 impressão (offscreen, capture, erros amigáveis, sem impressora) → Tasks 7, 9; §9 bordas (sem rede na carga → Task 8 Alert; app fechado → rehydrate Task 3; e-mail já inscrito → Task 10; falha lógica de walk-in bloqueia check-in → Task 4); §10 testes → em cada task; §12 ordem → Tasks 1–12.
- **Placeholders:** nenhum "TBD"; o único "..." é o corpo de PR (texto livre do executor).
- **Consistência de tipos:** `PrinterState.select(device)` (Tasks 7/11), `usePrintBadge({ deviceName, label, module?, capture? })` (Tasks 7/9/10), `SyncEngine` deps (Tasks 5/6/9), `store.outboxFailed(slug, id, msg, { permanent })` (Tasks 3/4/11), `getPrinterStorage` exportado em Task 7 Step 8 (renomear `getDefaultStorage` → `getPrinterStorage` e exportar — faça isso já ao escrever a Task 7).
