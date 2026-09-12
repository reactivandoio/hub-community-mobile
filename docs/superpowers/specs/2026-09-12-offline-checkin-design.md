# Credenciamento offline no Android — design

Data: 2026-09-12 · Status: aprovado em conversa, aguardando revisão do texto

## 1. Objetivo

Fazer o credenciamento (check-in + impressão de crachá) na entrada do evento
por celulares Android, cada um com sua impressora 4BARCODE 4B-2074A ligada por
USB OTG, funcionando **sem depender do Wi-Fi do local**: o operador carrega o
evento antes, credencia offline, e o app sincroniza com o BFF sempre que houver
conexão — inclusive puxando inscrições novas feitas durante o dia. Inscrição na
hora (walk-in) é feita pelo operador no próprio app e também sincroniza depois.

Substitui o fluxo atual 100% no PC (`/badge-printer/event/[slug]` no web).

## 2. Decisões já tomadas

| Tema | Decisão | Por quê |
|---|---|---|
| Impressão | Módulo nativo próprio (Kotlin) mandando TSPL por USB Host; crachá renderizado em RN, capturado em PNG e enviado como `BITMAP` 1bpp | Impressora é só USB; não existe print service Android pra ela; renderizando nós mesmos, acento e layout ficam iguais ao web. Spike em `modules/tspl-usb-printer` (branch `spike/usb-tspl-print`), pendente de teste com a impressora |
| Armazenamento | `react-native-mmkv`, JSON por evento | Centenas de inscritos cabem em memória; busca é filtro em array |
| Dispositivos | Vários celulares simultâneos, cada um com impressora | Check-in é monotônico, então o merge é trivial (`OR`) |
| Walk-in | Operador preenche nome, e-mail, telefone; imprime na hora; cadastro vai pra fila | O BFF (`manualSignup`) já cria conta, inscreve e manda e-mail de senha; já deduplica por e-mail |
| Build | Dev build (`expo run:android` / EAS) | Módulo nativo não roda no Expo Go |
| Auth | Sem login no app por enquanto | As operations de check-in não exigem token no BFF hoje (risco conhecido, fora de escopo) |

## 3. Arquitetura

```
src/app/
  index.tsx                    lista de eventos → "Carregar evento"
  checkin/[slug]/index.tsx     tela principal: busca, lista, credenciar, walk-in, status
  checkin/[slug]/settings.tsx  texto do logo, link do QR, lote (batch), impressora
src/features/checkin/
  store.ts        CheckinStore: estado em memória + persistência MMKV + useSyncExternalStore
  merge.ts        regras puras de merge servidor × local
  outbox.ts       fila de operações pendentes (tipos + processamento com transporte injetado)
  sync.ts         SyncEngine: pull periódico + push da outbox, reage a NetInfo
  transport.ts    chamadas Apollo (eventSignups, checkinSignup, manualSignup) atrás de uma interface
src/features/printer/
  badge-printer.ts   captura BadgeLabel (view-shot) → printBitmap; seleção/persistência da impressora
  usePrinter.ts      estado: dispositivos, selecionado, permissão, último erro
src/components/badge-label.tsx   (já existe) crachá em RN, mesmo layout do web
modules/tspl-usb-printer/        (já existe) transporte USB + TSPL
```

Dependências novas: `react-native-mmkv`, `@react-native-community/netinfo`,
`expo-crypto` (UUID). `react-native-view-shot`, `react-native-qrcode-svg` já
estão no projeto.

## 4. Modelo de dados (MMKV, uma chave por evento)

```ts
// key: `checkin:<slug>`
interface EventCache {
  slug: string;
  title: string;
  loadedAt: string;        // ISO — carga inicial
  lastPullAt?: string;     // ISO — último pull bem-sucedido
  signups: LocalSignup[];
  outbox: OutboxItem[];
  settings: { logoText: string; link: string; batchId: string };
}

interface LocalSignup {
  id: string;              // id do servidor, ou `local:<uuid>` até o walk-in sincronizar
  name: string;
  email?: string | null;
  phone_number?: string | null;
  product_name?: string | null;
  checked_in: boolean;
  checked_in_at?: string | null;
  source: 'server' | 'walkin';
  printed_at?: string;     // último crachá impresso neste aparelho
}

type OutboxItem =
  | { id: string; kind: 'checkin'; signupId: string; checkedInAt: string; createdAt: string; attempts: number; lastError?: string; failed?: true }
  | { id: string; kind: 'walkin'; localId: string; input: { name: string; email: string; phone_number?: string }; batchId: string; createdAt: string; attempts: number; lastError?: string; failed?: true };

// key: `printer:selected` → { vendorId, productId }   (fora do evento)
```

Escrita: toda mutação do store serializa o `EventCache` inteiro (JSON) na
chave do evento. Com ~1.000 inscritos isso é < 300 KB; MMKV escreve síncrono e
rápido. Só um evento é "ativo" por vez, mas os caches de outros ficam
guardados (útil pra evento de dois dias).

## 5. Sincronização

### 5.1 Carga inicial ("Carregar evento")
`eventSignups(eventSlug)` completo → cria o `EventCache` (ou substitui os
`source: 'server'` mantendo outbox e walk-ins locais não resolvidos). Exige
rede; sem rede, o botão mostra "sem conexão".

### 5.2 Pull
- Enquanto a tela de check-in está aberta e há rede: `eventSignups` a cada
  **30 s** (network-only). Também ao reconectar e no botão "Sincronizar".
- Merge por `id` (regras puras em `merge.ts`, testadas):
  - inscrito só no servidor → entra;
  - nos dois → dados do servidor, exceto `checked_in = local || remoto` e, se
    o local estava marcado, mantém o `checked_in_at` local (é a hora real);
  - só local com `source: 'server'` → foi removido no servidor; sai da lista;
  - só local com `source: 'walkin'` → fica (ainda não sincronizou).
- Walk-in já resolvido (id do servidor) é tratado como qualquer outro.

### 5.3 Push (outbox)
- FIFO, um item por vez, só com rede. Dispara: ao enfileirar, ao reconectar,
  após cada pull, no botão "Sincronizar".
- `checkin` → `checkinSignup(eventSlug, signupId, checkedInAt)`. Se o
  `signupId` ainda é `local:` (walk-in não resolvido), o item espera — como a
  fila é FIFO, o `walkin` correspondente vem antes.
- `walkin` → `manualSignup(eventSlug, batchId, input)`. Com `signup.id` na
  resposta: troca `local:<uuid>` pelo id real no `LocalSignup` **e** em todo
  item da outbox que o referencie.
- Erro de rede / 5xx → mantém o item, `attempts++`, retry com backoff
  (5 s, 15 s, 60 s, depois a cada pull). Resposta `success: false` (erro de
  negócio, ex.: e-mail inválido) → `failed: true` + `lastError`; fica visível
  na UI com "Tentar de novo" / "Descartar". Nunca trava a fila: item falho é
  pulado.
- Idempotência: `checkinSignup` passa a ser idempotente no BFF (§7);
  `manualSignup` já devolve o signup existente quando o e-mail já está
  inscrito. Reenviar nunca duplica.

### 5.4 Vários aparelhos
Check-in é monotônico, então não há conflito. Dois aparelhos só imprimem o
mesmo crachá se ambos estiverem offline e a pessoa passar em duas filas —
aceito; ao voltar a rede, a lista do outro mostra "credenciado".

### 5.5 Indicadores na tela
Barra fixa: **online/offline** (NetInfo), **N pendentes** (outbox não falha),
**N com erro**, hora do último pull, **impressora conectada / sem
impressora**. Botão "Sincronizar agora" força pull + push.

## 6. Fluxo do operador

1. **Home**: lista de eventos (query `events`, ordem `start_date desc`); botão
   "Carregar" por evento. Eventos já carregados mostram "carregado às HH:MM" e
   abrem direto, mesmo offline.
2. **Check-in** (`checkin/[slug]`): busca por nome/e-mail (filtro local,
   sem acento/caixa); lista com nome, e-mail, produto e badge "credenciado".
   Toque → sheet com nome grande e:
   - **Imprimir e credenciar** → imprime; se a impressão der certo, marca
     `checked_in` local (com hora do aparelho) e enfileira. Se falhar, mostra o
     erro e oferece **"Credenciar sem imprimir"**.
   - Já credenciado → **Reimprimir** (não enfileira de novo).
3. **Inscrever na hora**: form nome / e-mail / telefone (validação: nome e
   e-mail obrigatórios, e-mail com formato válido). Se o e-mail já existe na
   lista local → avisa "já inscrito" e leva pro check-in dele. Senão cria
   `LocalSignup` (`local:` + `source: 'walkin'`), imprime, marca check-in e
   enfileira `walkin` + `checkin`.
4. **Configurações do evento**: `logoText` (texto do logo no crachá),
   `link` (conteúdo do QR e texto), `batchId` (lote da inscrição, lista via
   `eventBySlugOrId.products[].batches[]`, obrigatório pra walk-in),
   impressora (lista USB, pedir permissão, selecionar; lembrada por
   `vendorId:productId` e reselecionada sozinha ao conectar).

## 7. Mudança no BFF

`checkinSignup(eventSlug, signupId, checkedInAt: String)`:
- `checkedInAt` opcional; quando vier, é o que grava em `checked_in_at`.
- Se a inscrição **já está** `checked_in`, não sobrescreve nada e responde
  `success: true` com a inscrição atual (idempotente). Hoje ela sobrescreve o
  `checked_in_at` a cada chamada, o que apagaria a hora real quando dois
  aparelhos sincronizam o mesmo inscrito.
- Continua publicando no `credentialCheckedIn` só quando de fato mudou.

Testes no BFF cobrem os três casos (novo, novo com timestamp, já
credenciado).

## 8. Impressão

- `badge-printer.ts`: renderiza um `BadgeLabel` fora da tela (largura 812 dp
  numa view com `position: absolute`, fora do viewport), `captureRef` em PNG
  base64 em 816×406, chama `printBitmap(deviceName, png, { gapMm })`. Uma
  impressão por vez (fila interna simples). Erros do módulo nativo viram
  mensagens legíveis ("impressora sem permissão", "impressora desconectada").
- Parâmetros da etiqueta (`gapMm`, `density`) ficam em `printer:*` no MMKV,
  com defaults do spike; expostos nas configurações só se o spike mostrar que
  precisam de ajuste.
- Sem impressora selecionada ou sem permissão → "Imprimir e credenciar" fica
  desabilitado com explicação; "Credenciar sem imprimir" continua disponível.

## 9. Erros e casos de borda

- Carga inicial sem rede → mensagem clara; se já houver cache do evento, abre
  o cache.
- Perda de rede no meio de um push → item permanece; próximo ciclo reenvia.
- App fechado com outbox cheia → tudo está no MMKV; ao abrir a tela do
  evento, o SyncEngine retoma.
- Walk-in com e-mail já inscrito no servidor mas ausente no cache (inscreveu
  pelo site enquanto o aparelho estava offline) → `manualSignup` devolve o
  signup existente; o local é remapeado pro id real; o pull seguinte
  consolida.
- Dois walk-ins com o mesmo e-mail em aparelhos diferentes → os dois
  remapeiam pro mesmo id do servidor; o pull dedup pela chave `id`.
- Falha lógica em `walkin` (`success: false`) → o `checkin` dependente fica
  esperando; a UI mostra o erro no item e o operador decide.

## 10. Testes

- `merge.ts`, `outbox.ts`, `store.ts`: unitários puros (Jest), incluindo
  remapeamento de `local:` ids e ordem FIFO com item falho.
- `sync.ts`: com transporte fake e NetInfo mockado; cenários offline → online.
- `badge-printer.ts`: módulo nativo e `captureRef` mockados; verifica
  parâmetros e tradução de erros.
- Telas: RNTL com store real em memória e transporte fake (carregar, buscar,
  credenciar, walk-in, indicadores).
- Kotlin: sem teste automatizado; validado no spike com a impressora.

## 11. Fora de escopo

Login/roles no app; impressão em iOS; subscriptions (websocket) — o pull de
30 s cobre; analytics; importação de CSV; edição de inscrito.

## 12. Ordem de entrega (base do plano)

1. BFF: `checkinSignup` idempotente + `checkedInAt` (PR separado).
2. `merge.ts` + `store.ts` (MMKV) + testes.
3. `outbox.ts` + `transport.ts` + `sync.ts` + testes.
4. `badge-printer.ts` + `usePrinter` (sobre o módulo do spike).
5. Telas: home com "Carregar", check-in, sheet de credenciar, walk-in,
   configurações.
6. Remover a tela `/print-test` do spike; manter o módulo.
7. Teste de ponta a ponta com a impressora (spike + fluxo completo juntos).
