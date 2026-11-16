# App mobile com paridade do web — plano de execução

> Para agentes: cada card abaixo é executado por um agente sem contexto. O texto do card é a fonte; este
> plano junta todos em ordem. Marque o progresso no board, não aqui.

**Objetivo:** levar o app HubCommunity do check-in de gestão (PR #11, REA-58) à paridade com o web para o
participante, e à gestão leve no celular.

**Spec:** `docs/superpowers/specs/2026-11-16-app-mobile-paridade-design.md` · **Inventário:**
`docs/paridade-web.md`

**Repositórios** (todos em `reactivandoio/`, clonados lado a lado em `~/projects/reactivando/`):
`hub-community-mobile` (app, Expo 57), `hub-community-bff` (GraphQL, Node/Babel, Vitest),
`hub-community-frontend` (web, Next 16), `hub-community-backend` (Strapi 5).

## 0. Bloco comum (vai em todo card)

- Trabalhe num **branch novo a partir da `main`**, num **git worktree** (`git worktree add ../<repo>-<card> -b <card>-<slug> origin/main`). Abra o PR e **não faça merge**.
- **Nunca** gere build de produção, envie às lojas ou mude configuração de produção sem o dono autorizar (o chat do termhub conta).
- Antes de depurar um erro, procure em `docs/lessons/` do repositório e nas lições do projeto (termhub `search_memory`, `kinds: ["lesson"]`). Ao resolver um erro não óbvio, registre uma lição em `docs/lessons/AAAA-MM-DD-<slug>.md` (formato em `docs/lessons/README.md`) no mesmo PR.
- **App (`hub-community-mobile`)**: use `corepack pnpm@10.13.1` (o `pnpm` puro está quebrado nesta máquina). Leia `CLAUDE.md` e `AGENTS.md` (docs do Expo v57). `src/app/` só tem rotas; telas e testes em `src/components/` ou `src/features/`. Toda rota nova entra na guarda certa do `src/components/root-navigator.tsx` (ou do layout de abas) com teste de guarda via `renderRouter`. RNTL 14: `await render` e `await fireEvent`. `MockedProvider` exige `__typename`. Antes do commit: `npx tsc --noEmit && corepack pnpm@10.13.1 lint && corepack pnpm@10.13.1 test`. Operações GraphQL em `src/lib/queries.ts` copiando o formato de `hub-community-frontend/src/lib/queries.ts`.
- **BFF**: `yarn install --frozen-lockfile`, `npx vitest run`. Toda operação nova entra na tabela `PROTECTED` de `src/__tests__/authorization.test.js` (ou num teste próprio de autorização) e em `src/__tests__/schema.test.js`. Regras de papel em `src/utils/auth/index.js` (`requireUser`, `requireEventOrganizer`, `requireAdmin`); o usuário vem só do token verificado (`ctx.user`).
- **Web**: `CLAUDE.md` do repo; `pnpm test`, `pnpm build` se tocar em rota.
- **Backend (Strapi)**: `CLAUDE.md` do repo; testes do repo.
- Mensagens ao usuário em pt-BR. Commits com o trailer de coautoria pedido pelo ambiente.
- No PR: o que mudou, como testar (no celular, para o app: dev build com `pnpm android`/`pnpm ios`) e o resultado dos testes.

## 1. Ordem de execução

| # | Card | Tipo | Repo | Depende de |
|---|---|---|---|---|
| **Fase 1A — destravar** |||||
| 1 | B1 Minhas inscrições no BFF (`mySignups`) | story | bff | — |
| 2 | B2 Exclusão de conta (`deleteMyAccount`) | story | bff, backend | D7 (retenção) só para o merge |
| 3 | F1 Página web de exclusão de conta | story | front | B2 |
| 4 | M0 CI e checagem de contrato do app | task | mobile | PR #11 |
| 5 | B3 Conta de revisão das lojas | task | bff | — |
| **Fase 1B — participante no dia do evento** |||||
| 6 | M1 Abas e navegação sem login | story | mobile | PR #11 |
| 7 | M2 Ingressos: minhas inscrições e QR | story | mobile | B1, M1 |
| 8 | M3 Eventos: lista e página do evento | story | mobile | M1 |
| 9 | M4 Conta: perfil e completar cadastro | story | mobile | M1 |
| 10 | M5 Excluir conta no app | story | mobile | B2, M4 |
| 11 | M6 Dados de check-in criptografados e com prazo | task | mobile | PR #11 |
| 12 | M7 Links do e-mail abrem o app | story | mobile, front | M2, M3; valores de D1/D3 |
| **Fase 2 — inscrição e Pix** |||||
| 13 | M8 Inscrição no app | story | mobile | M3, M4 |
| 14 | M9 Pagamento Pix no app | story | mobile | M8, M2; D7 (evento online) |
| **Fase 3 — engajamento** |||||
| 15 | M10 Arte "Eu vou" | story | mobile | M3 |
| 16 | M11 Certificados | story | mobile | M1 |
| 17 | M12 Programação, agenda, avaliações e comentários | story | mobile | M3 |
| 18 | M13 Votação | story | bff, mobile | M1 |
| 19 | B4 Tokens de push e envio | story | backend, bff | — |
| 20 | M14 Notificações push no app | story | mobile | B4; D6 para testar |
| **Fase 4 — gestão leve** |||||
| 21 | M15 Painel do evento no celular | story | mobile | PR #11 |
| 22 | M16 Aceitar convite de gestão | story | mobile | M1 (M7 para o link) |
| 23 | M17 Lembrete e reenvio de confirmação pela gestão | story | mobile | M15 |
| **Precisa do dono (o automático não faz)** |||||
| 24 | D1 EAS: projeto e `eas.json` | task | mobile | — |
| 25 | D2 Identificador e nome do app | task | mobile | — |
| 26 | D3 Contas Apple Developer e Google Play | task | — | — |
| 27 | D4 Ligar a conta de revisão na produção | task | bff | B3, D3 |
| 28 | D5 Fichas das lojas e privacidade | task | — | D3, M5, F1 |
| 29 | D6 Credenciais de push | task | mobile | D1, D3 |
| 30 | D7 Decisões de produto pendentes | task | — | — |
| 31 | D8 Distribuição do app do totem | task | mobile | D1 |
| 32 | D9 Primeira publicação (interna e lojas) | task | mobile | D1–D5, M5 |
| 33 | D10 Fase 5: o que da gestão completa vai para o app | task | — | Fases 1–4 em uso |

---

## 2. Cards

### B1 — Minhas inscrições no BFF (`mySignups`)
**Tipo:** story · **Repo:** hub-community-bff · **Depende de:** —

**Contexto.** O app precisa de uma tela "Ingressos" com as inscrições da pessoa logada. As inscrições
vivem no Eventando por e-mail. Já existe `dataSources.eventandoIntegration.findSignupsByEmail(email)`
(`src/dataSources/eventando-manager/signup/index.js`, REA-52), usada pelo perfil de usuário do admin
(`src/services/admin-user-profile/index.js`, `toUserSignup`). Atenção: `toUserSignup` usa `signup.id`
numérico; o ingresso e o check-in usam `signupIdOf` (`src/utils/signup-id`), que prefere `documentId`.

**O que fazer.**
1. Em `src/types/` (novo `MySignup.graphql` ou em `Event.graphql`), declarar exatamente o contrato da spec
   §4.1: `MySignup`, `MySignupEvent`, `Query.mySignups: [MySignup!]!`.
2. Resolver (`src/resolvers/MySignup/index.js` ou no resolver de Event): `requireUser(ctx)`; usar **só**
   `ctx.user.email` (sem argumento de e-mail); `findSignupsByEmail`; mapear com `id = signupIdOf(signup)`,
   `payment_status = effectiveStatus(payment)` e `holds_place = holdsPlace(signup)`
   (`src/utils/payment-status`); evento a partir de `signup.event` (Eventando) enriquecido com o evento do
   Hub (`dataSources.manager.findEvents` com filtro por slug, em lote, uma chamada) para `start_date`,
   `end_date`, `is_online`, `location`, `cover` (primeira de `images`). `call_link` só quando
   `holds_place` (mesma regra de `isUserSignedUp` em `src/resolvers/Event/index.js`).
3. Ordenar pelo `start_date` do evento, mais recente primeiro; inscrições sem evento no Hub ficam no fim.
4. Falha do Eventando: erro com mensagem em pt-BR ("Não foi possível carregar suas inscrições."), sem
   stack para o cliente (ver `src/utils/error-handling`).

**Critérios de aceite.**
- Anônimo → `UNAUTHENTICATED` sem chamar data source.
- Retorna só inscrições do e-mail do token, comparando sem diferenciar maiúsculas.
- `id` igual ao que `eventSignups` devolve para a mesma inscrição.
- `call_link` nulo para pagamento pendente/expirado.

**Testes.** Vitest do resolver (mapeamento, ordenação, `holds_place`, `call_link`), linha na tabela de
`src/__tests__/authorization.test.js`, `schema.test.js` expõe `mySignups`.

---

### B2 — Exclusão de conta (`deleteMyAccount`)
**Tipo:** story · **Repos:** hub-community-bff, hub-community-backend · **Depende de:** D7 confirma a
tabela de retenção antes do merge (o PR pode ser aberto antes)

**Contexto.** Apple (5.1.1(v)) e Google exigem que app que cria conta permita excluí-la. O login por
código (`verifyLoginCode`) cria conta para e-mail novo. Não existe exclusão hoje em nenhum repo. Usuário
Strapi: `src/extensions/users-permissions/content-types/user/schema.json` no backend (relações:
`communities`, `managed_events`, `agenda`, `speaker`, `team`, `role`; campos pessoais `name`, `phone`,
`cpf`, `date_of_birth`, redes, `cover_photo`, `marketing_opt_in`…). APIs relacionadas no backend:
`login-code`, `management-invite`, `agenda`, `rate`, `comment`, `comment-reply`, `vote`, `speaker`,
`certificate`, `email-suppression`. Inscrições ficam no Eventando
(`hub-community-bff/src/dataSources/eventando-manager/signup`).

**O que fazer.**
1. Backend: rota de integração (mesmo padrão de `src/api/account-setup`) `POST /account-deletion` que,
   numa transação, aplica a tabela da spec §5 ao usuário (anonimiza, bloqueia, tira de comunidades e
   eventos geridos, apaga códigos de login, convites, agenda, avaliações, comentários e respostas,
   desvincula votos e palestrante, põe o hash do e-mail original na supressão). Mantém certificados.
   Idempotente.
2. BFF: `Mutation.deleteMyAccount(code: String!)` (spec §4.2). `requireUser`; conferir o código com a
   mesma lógica de `verifyLoginCode` (`src/dataSources/manager-integration/login-code`) para o e-mail do
   token — o código é pedido antes com `requestLoginCode`; chamar a rota do backend; anonimizar as
   inscrições do e-mail no Eventando (nome, e-mail, telefone, CPF) mantendo o pagamento; limpar o cache de
   usuário (`clearUserCache` em `src/utils/auth`) para o token antigo deixar de valer.
3. Registrar no log de auditoria existente (ver `role-change`) quem e quando, sem dados pessoais.

**Critérios de aceite.**
- Anônimo → `UNAUTHENTICATED`; código errado → `LOGIN_CODE_INVALID` e nada muda.
- Depois da exclusão: o token antigo recebe `adminAccess: null` e qualquer operação logada falha; um novo
  `verifyLoginCode` com o mesmo e-mail cria uma conta nova e vazia; a busca de usuários do admin não acha
  mais o nome nem o CPF.
- Rodar duas vezes não quebra.

**Testes.** Vitest no BFF (autorização, código, chamada ao backend, Eventando, cache); testes no backend
da anonimização (cada linha da tabela §5).

---

### F1 — Página web de exclusão de conta
**Tipo:** story · **Repo:** hub-community-frontend · **Depende de:** B2

**Contexto.** O Google Play pede um link web onde a pessoa pede a exclusão sem instalar o app. Login no
web é por código (REA-26, `src/contexts/auth-context.tsx`, `src/components/auth-modal.tsx`).

**O que fazer.** Rota `/excluir-conta`: explica o que é apagado e o que fica (texto da spec §5), pede login
se preciso (`LoginRequired`/`useLoginPrompt`, REA-25), pede um código novo (`REQUEST_LOGIN_CODE`), mostra as
inscrições em eventos futuros que deixam de valer (`mySignups` do B1, se já existir; senão omite), confirma
com o código e chama `DELETE_MY_ACCOUNT` (nova em `src/lib/queries.ts`); depois faz `signOut` e mostra
"Conta excluída". Link no rodapé e em `/privacy`.

**Critérios de aceite.** Sem sessão abre o login no lugar; código errado mostra a mensagem do BFF; sucesso
encerra a sessão. **Testes:** componente da página (estados), mocks Apollo.

---

### M0 — CI e checagem de contrato do app
**Tipo:** task · **Repo:** hub-community-mobile · **Depende de:** PR #11 mesclado

**Contexto.** O repo do app não tem CI; sem CI o termhub não mescla nada e os PRs ficam esperando o dono.

**O que fazer.**
1. `.github/workflows/ci.yml` em `pull_request` e `push` na `main`: Node 22, `corepack enable`,
   `pnpm install --frozen-lockfile`, `npx tsc --noEmit`, `pnpm lint`, `pnpm test`. Sem EAS, sem build.
2. `scripts/check-contract.mjs`: extrai os `gql` de `src/lib/queries.ts` e valida contra os `.graphql` de
   um checkout do BFF (`--bff ../hub-community-bff` ou `BFF_DIR`), com `@graphql-tools/schema` e
   `graphql.validate`; no CI, faz checkout de `reactivandoio/hub-community-bff` na `main` (se o repo for
   privado e o token padrão não tiver acesso, deixe o passo condicionado a um secret `BFF_READ_TOKEN` e
   documente no PR).
3. Script `pnpm check:contract` no `package.json`.

**Critérios de aceite.** O workflow passa na `main`; uma operação inválida em `queries.ts` faz o contrato
falhar com a mensagem do GraphQL. **Testes:** rodar o workflow no PR.

---

### B3 — Conta de revisão das lojas
**Tipo:** task · **Repo:** hub-community-bff · **Depende de:** —

**Contexto.** O revisor da Apple/Google precisa entrar sem acesso ao e-mail; o login é só por código
(`requestLoginCode`/`verifyLoginCode`, `src/resolvers/User`, `src/dataSources/manager-integration/login-code`).

**O que fazer.** Variáveis `STORE_REVIEW_EMAIL` e `STORE_REVIEW_CODE` (6 dígitos). Só quando **as duas**
existem: `requestLoginCode` desse e-mail responde `sent: true` sem enviar e-mail, e `verifyLoginCode`
aceita o código fixo para esse e-mail (e só ele). Sem as variáveis, nada muda. Log de cada uso (sem o
código). Documentar no README do BFF.

**Critérios de aceite.** Sem variáveis: comportamento atual (teste). Com variáveis: outro e-mail não aceita
o código fixo; o e-mail de revisão não aceita outro código. **Não** configurar em produção (é o D4).

---

### M1 — Abas e navegação sem login
**Tipo:** story · **Repo:** hub-community-mobile · **Depende de:** PR #11 mesclado

**Contexto.** Hoje (`src/components/root-navigator.tsx`) sem login só existe `login`; logado, uma home
(`src/components/home/home-screen.tsx`) e, para Admin/Community Manager/Event Manager, `gestao` e
`checkin/[slug]/*` (`Stack.Protected` aninhado; regras em `src/lib/admin-access.ts`, sessão em
`src/features/auth/`). A Apple pede que conteúdo público não exija login.

**O que fazer.** Estrutura da spec §6: grupo `(tabs)` com **Eventos** (público), **Ingressos** e **Conta**
(pedem login: mostram "Entre para ver…" com botão que abre `login`) e **Gestão** (só com
`canManageEvents(access)`, via `Tabs.Protected` ou equivalente). `login` vira modal
(`presentation: 'modal'`) que fecha sozinho ao logar e volta para onde estava. Mover a home atual: dados da
pessoa e "Sair" vão para Conta; a lista de gestão (`EventsHome`) vira a aba Gestão. `checkin/[slug]/*`
continua no Stack raiz, dentro da guarda de gestão. Telas de Eventos/Ingressos podem ser placeholders
("Em breve") — o conteúdo é M2/M3.

**Critérios de aceite.** Sem login: abre em Eventos; Ingressos e Conta pedem login; Gestão não aparece.
Participante logado: três abas. Gestor: quatro. Perder o papel (refetch de `adminAccess`) tira a aba
Gestão e as rotas de check-in. Sair continua apagando as listas de check-in (com o aviso).
**Testes:** `renderRouter` para cada combinação (anônimo, participante, gestor), teste do modal de login.

---

### M2 — Ingressos: minhas inscrições e QR
**Tipo:** story · **Repo:** hub-community-mobile · **Depende de:** B1, M1

**Contexto.** B1 cria `mySignups` no BFF. O QR do ingresso usa o contrato do web
(`hub-community-frontend/src/lib/ticket.ts`): `https://hubcommunity.io/events/<slug>/signup?ticket=<id>`;
o totem e o check-in do app já leem isso (`src/features/checkin/ticket.ts`, `parseTicket`).
`react-native-qrcode-svg` já é dependência.

**O que fazer.**
1. `MY_SIGNUPS` em `src/lib/queries.ts`, tipos em `src/lib/types.ts`.
2. Aba Ingressos: seções "Próximos" e "Anteriores" (por `start_date`), cartão com título, data, local ou
   "Online", status ("Confirmada", "Pagamento pendente", "Expirada", "Cancelada"), "Credenciada às HH:mm"
   quando `checked_in`. Puxar para atualizar.
3. Rota `ingresso/[signupId]`: QR grande (`ticketUrl` portado para `src/lib/ticket.ts` do app), nome do
   evento, data, local; brilho da tela no máximo enquanto aberta (`expo-brightness`, restaurar ao sair);
   link da chamada quando online e `call_link` existe. Só mostra QR quando `holds_place`.
4. Cache offline: guardar a última lista em MMKV por usuário (como `AccessCache`), para mostrar o ingresso
   sem internet na porta; apagar no "Sair".
5. Botão "Reenviar e-mail de confirmação" (`resendSignupConfirmation(event, signup_id)`, mesma copy do
   web, `RESEND_SIGNUP_CONFIRMATION` em `hub-community-frontend/src/lib/queries.ts`).
6. Pagamento pendente: botão "Pagar" leva à tela de Pix do M9 (enquanto M9 não existe, abre
   `https://hubcommunity.io/events/<slug>/signup` no navegador).

**Critérios de aceite.** O QR gerado é aceito por `parseTicket` (teste). Sem rede, a lista e o QR da última
carga aparecem. Inscrição pendente não mostra QR. **Testes:** tela da lista (estados: carregando, vazia,
erro, offline com cache), tela do ingresso, `ticketUrl` × `parseTicket`, guarda da rota.

---

### M3 — Eventos: lista e página do evento
**Tipo:** story · **Repo:** hub-community-mobile · **Depende de:** M1

**Contexto.** No web: `/events`, `/events/[id]` (`EVENT_METADATA_QUERY`, `GET_EVENT_BY_SLUG_OR_ID` em
`hub-community-frontend/src/lib/queries.ts`). A query `EVENTS` do app hoje pede `include_unlisted: true`
porque serve à gestão — a lista pública **não** pode pedir isso.

**O que fazer.** Aba Eventos: próximos eventos (sem `include_unlisted`), busca por nome, filtro por
comunidade; rota `events/[slug]`: capa, título, data/hora, local com botão "Abrir no mapa" (Linking para
Apple/Google Maps), "Online", descrição (Strapi blocks → texto; avaliar um renderer simples),
comunidades, programação resumida (talks com horário e palestrante), botão "Inscrever-se" (abre M8;
antes do M8, abre o web) e "Ver meu ingresso" quando a pessoa já está inscrita (`IS_USER_SIGNED_UP`).
Evento `unlisted` abre pelo link direto, mas não aparece na lista.

**Critérios de aceite.** Lista sem não listados; página abre sem login; inscrito vê "Ver meu ingresso".
**Testes:** lista (variáveis da query sem `include_unlisted`), página (estados), botão de mapa.

---

### M4 — Conta: perfil e completar cadastro
**Tipo:** story · **Repo:** hub-community-mobile · **Depende de:** M1

**Contexto.** No web, depois do login, o `CompleteProfileModal` pede nome, CPF, data de nascimento,
WhatsApp, declaração 18+ e opt-in de novidades (REA-26/REA-29/REA-36); operações `ME` e `UPDATE_PROFILE`
em `hub-community-frontend/src/lib/queries.ts`; regras de 18+ no BFF (`updateProfile`, `ProfileInput` em
`src/types/User.graphql`).

**O que fazer.** Aba Conta: nome, e-mail, papel, editar perfil (nome, WhatsApp, redes) e "Completar
cadastro" quando faltar nome/CPF/nascimento/18+ (mostrar aviso: o certificado exige). Validação de CPF e
data como no web (portar a validação de `hub-community-frontend/src/lib/schemas/user.schema.ts`). Opt-in sempre
desmarcado por padrão. Itens: "Política de privacidade" e "Termos" (abre `hubcommunity.io/privacy` e
`/terms`), "Sair", "Excluir conta" (M5).

**Critérios de aceite.** Erros do BFF (menor de idade, CPF inválido) aparecem como mensagem; sucesso
atualiza a sessão (`SessionStore` guarda o nome novo). **Testes:** formulário (validação, envio, erro do
BFF), aviso de cadastro incompleto.

---

### M5 — Excluir conta no app
**Tipo:** story · **Repo:** hub-community-mobile · **Depende de:** B2, M4

**O que fazer.** Em Conta → "Excluir conta": tela explicando o que é apagado e o que fica (spec §5), lista
das inscrições futuras que deixam de valer (`mySignups`), botão "Enviar código" (`requestLoginCode` para o
e-mail da sessão), campo do código e "Excluir minha conta" (`deleteMyAccount`). Sucesso: mesma limpeza do
"Sair" (`useAuth().signOut`: listas de check-in, cache de acesso, Apollo) e volta para Eventos com
"Conta excluída".

**Critérios de aceite.** Código errado mostra a mensagem do BFF e nada é apagado no aparelho; sucesso
apaga tudo local. **Testes:** tela (fluxo feliz, código errado, cooldown do código).

---

### M6 — Dados de check-in criptografados e com prazo
**Tipo:** task · **Repo:** hub-community-mobile · **Depende de:** PR #11 mesclado

**Contexto.** `CheckinStore` (`src/features/checkin/store.ts`) guarda nome, e-mail e telefone de inscritos
em MMKV (`createMMKV({ id: 'checkin' })` em `store-provider.tsx`) para o check-in offline. MMKV 4 aceita
`encryptionKey`.

**O que fazer.** Gerar uma chave aleatória na primeira execução e guardá-la no SecureStore; abrir as
instâncias `checkin` e `session` com ela. Migração: se existir instância sem criptografia, copiar os dados
para a criptografada e apagar a antiga. Na abertura do app, apagar eventos carregados cujo `loadedAt` tem
mais de 7 dias **e** sem nada na fila (`outbox` vazio); com fila, manter e avisar na lista de gestão.

**Critérios de aceite.** Nenhum dado de inscrito em texto puro no arquivo MMKV; nenhum check-in pendente é
perdido. **Testes:** expiração (com e sem fila) com `MemoryStorage` e relógio injetado; migração com um
storage falso.

---

### M7 — Links do e-mail abrem o app
**Tipo:** story · **Repos:** hub-community-mobile, hub-community-frontend · **Depende de:** M2, M3;
valores de D1/D3 (Team ID da Apple, SHA-256 do certificado de assinatura Android) para funcionar de fato

**O que fazer.**
1. Web: servir `/.well-known/apple-app-site-association` e `/.well-known/assetlinks.json` (rotas do Next
   com `Content-Type: application/json`, sem redirect) a partir de variáveis `APPLE_TEAM_ID`,
   `IOS_BUNDLE_ID`, `ANDROID_PACKAGE`, `ANDROID_SHA256_CERT_FINGERPRINTS`; sem as variáveis, 404. Caminhos:
   `/events/*`, `/convite*`, `/certificado/*`.
2. App: `ios.associatedDomains` e `android.intentFilters` (`autoVerify`) no `app.json` para
   `hubcommunity.io`; mapear `/events/<slug>` → `events/[slug]`, `/events/<slug>/signup?ticket=<id>` →
   `ingresso/[id]` (se logado e o ingresso for da pessoa; senão a página do evento), `/convite?token=` →
   M16, `/certificado/<code>` → M11 (ou o navegador, se ainda não existir). Usar `+native-intent.tsx` do
   expo-router para reescrever.

**Critérios de aceite.** Testes do mapeamento de URL; arquivos `.well-known` com as variáveis (teste da
rota). O teste no aparelho fica para depois de D1/D3.

---

### M8 — Inscrição no app
**Tipo:** story · **Repo:** hub-community-mobile · **Depende de:** M3, M4

**Contexto.** Web: `src/app/events/[id]/signup/page.tsx` com `GET_EVENT_BY_SLUG_OR_ID`, `IS_USER_SIGNED_UP`,
`VALIDATE_COUPON`, `PREVIEW_COUPON`, `SIGNUP_TO_EVENT` (em `hub-community-frontend/src/lib/queries.ts`).
Regras: cupom por link `#cupom=CODE` (REA-18, `lib/coupon-link.ts`), meia-entrada por declaração com "?"
explicativo (REA-16, checkbox desmarcado, só em lote com meia), declaração 18+ obrigatória (REA-36), CPF
obrigatório.

**O que fazer.** Rota `events/[slug]/signup` (pede login): produtos e lotes habilitados, cupom (validar e
mostrar o preço), meia, 18+, CPF/telefone pré-preenchidos do perfil. Lote gratuito: inscreve e vai para o
ingresso (M2). Lote pago: chama `signupToEvent(kind: "PIX_QR")` e vai para a tela de Pix (M9). Já
inscrito: vai para o ingresso. Erros do BFF exibidos como vêm.

**Critérios de aceite.** Mesmas regras do web nos testes (meia só em lote elegível, 18+ obrigatório, cupom
inválido). **Testes:** formulário e cada caminho (grátis, pago, já inscrito, erro).

---

### M9 — Pagamento Pix no app
**Tipo:** story · **Repo:** hub-community-mobile · **Depende de:** M8, M2; D7 decide evento online

**Contexto.** Web: `src/components/signup-pix-payment.tsx` e `guest-payment-resume.tsx`; o pagamento vem
em `SignupResponse.payment` (JSON com `pix_br_code`); status em `signupPaymentStatus(signupId)`
(`SIGNUP_PAYMENT_STATUS`). Provedor único: Opa Pingou (REA-15).

**O que fazer.** Tela de Pix: QR do `pix_br_code`, "Copiar código Pix" (`expo-clipboard`), valor, prazo;
consulta `signupPaymentStatus` a cada 5 s enquanto aberta (parar em segundo plano) e vai para o ingresso
quando `CONFIRMED`; "Expirado" oferece gerar outro (chamar `signupToEvent` de novo, como o web). Retomar
pagamento pendente a partir do cartão do M2. **Regra de loja (proposta da spec, até o D7 decidir):**
evento `is_online` pago não mostra Pix no app — abre a inscrição no navegador.

**Critérios de aceite.** Confirmação leva ao ingresso sem ação da pessoa; sair da tela para o polling.
**Testes:** tela com timers falsos (pendente → confirmado, expirado), cópia, regra do evento online.

---

### M10 — Arte "Eu vou"
**Tipo:** story · **Repo:** hub-community-mobile · **Depende de:** M3

**Contexto.** Web: `src/components/share-art/*` (gerador, cropper, template, canvas) e
`/events/[id]/arte`; configuração `GET_SHARE_ART_CONFIG`/`SHARE_ART_CONFIG_FIELDS`; regras de quem pode
gerar, nome e papel no BFF `src/resolvers/ShareArt/rules.js` (REA-43, REA-45, REA-47, REA-49;
`share_art_open` libera para não inscritos).

**O que fazer.** Rota `events/[slug]/arte`: escolher foto (`expo-image-picker`, com texto de permissão no
`app.json`), recortar na área da configuração, compor fundo + foto + nome + papel numa `View` com as
posições/tamanhos/cores da configuração, capturar com `react-native-view-shot` e compartilhar
(`expo-sharing`) ou salvar (`expo-media-library`). Botão na página do evento e no ingresso.

**Critérios de aceite.** Mesma composição do web para a mesma configuração (comparar com uma imagem gerada
pelo web num teste manual descrito no PR). **Testes:** cálculo das posições (puro), regras de quem vê o
botão.

---

### M11 — Certificados
**Tipo:** story · **Repo:** hub-community-mobile · **Depende de:** M1

**Contexto.** Web: `/certificado` (`LOOKUP_CERTIFICATE`, `REQUEST_CERTIFICATE`, `GET_CERTIFICATE_CONFIG`),
`/certificado/[code]`, `/certificado/verificar/[code]`, `/certificado/solicitar/[slug]`; o PDF é gerado
pelo web em `/api/certificates/[code]/pdf`.

**O que fazer.** Em Conta → "Meus certificados": buscar os da pessoa, abrir o PDF (baixar com
`expo-file-system` e abrir/compartilhar), pedir certificado de um evento quando o formulário estiver
aberto (exige cadastro completo — levar ao M4 se faltar), verificar um código (pública).

**Critérios de aceite.** Cadastro incompleto bloqueia o pedido com explicação. **Testes:** telas e estados.

---

### M12 — Programação, agenda, avaliações e comentários
**Tipo:** story · **Repo:** hub-community-mobile · **Depende de:** M3

**Contexto.** BFF: `talks`, `talk`, `agendas`/`createAgenda`/`deleteAgenda`, `rates`/`createRate`,
`comments`/`createComment`/`deleteComment`; web `/talks/[id]`, `/agendas/[id]`.

**O que fazer.** Na página do evento, aba "Programação" com as talks por horário; detalhe da talk
(palestrante, descrição); "Adicionar à minha agenda"; avaliar a talk (1–5) depois que começou; comentar e
apagar o próprio comentário. Ações pedem login.

**Critérios de aceite.** Só o autor apaga (o BFF garante; o app só mostra o botão para o autor).
**Testes:** cada ação com mocks.

---

### M13 — Votação
**Tipo:** story · **Repos:** hub-community-bff, hub-community-mobile · **Depende de:** M1

**Contexto.** A página do web `/votacao/[id]` **não usa o BFF**: busca a sessão direto no Strapi
(`https://manager.hubcommunity.io/api/voting-sessions/<documentId>?populate=*`), pega o IP em
`api.ipify.org` e grava em `https://manager.hubcommunity.io/api/votes`. As operações de votação do BFF
(`src/types/Voting.graphql`) são todas de admin. O app não deve copiar o acesso direto ao Strapi.

**O que fazer.**
1. BFF: `Query.votingSessionPublic(id)` (sessão aberta, opções, sem dados de quem votou) e
   `Mutation.castVote(sessionId, optionId)` (logado; um voto por usuário e sessão, regra hoje feita por IP
   — manter o IP como registro, pegar do request com `src/utils/client-ip`, não de um serviço externo);
   resultados quando a sessão permitir. Testes de autorização e de voto duplicado.
2. App: abrir a sessão por link (M7) ou pela página do evento, votar (pede login), ver resultados.
3. Não mudar o web neste card (registrar no PR que ele pode migrar para as operações novas).

**Critérios de aceite.** Voto duplicado recusado pelo BFF; sessão encerrada não aceita voto.
**Testes:** BFF (Vitest) e telas do app.

---

### B4 — Tokens de push e envio
**Tipo:** story · **Repos:** hub-community-backend, hub-community-bff · **Depende de:** —

**O que fazer.** Backend: content type `device-token` (usuário, token Expo, plataforma, `last_seen_at`),
único por token. BFF: `registerDeviceToken(token, platform)` e `unregisterDeviceToken(token)` (logado, só
para o próprio usuário); serviço `sendPush(userIds, { title, body, url })` usando a API de push da Expo
(`https://exp.host/--/api/v2/push/send`, lotes de 100, remover tokens com `DeviceNotRegistered`); chamar
nos gatilhos: pagamento confirmado, certificado emitido, lembrete de evento (mesmo ponto das campanhas
`reminder`). Desligado sem a variável `EXPO_ACCESS_TOKEN`.

**Critérios de aceite.** Sem variável, nenhum envio; com variável, falha de push nunca derruba o fluxo do
e-mail. **Testes:** autorização, lote, limpeza de token inválido.

---

### M14 — Notificações push no app
**Tipo:** story · **Repo:** hub-community-mobile · **Depende de:** B4; D6 para testar no aparelho

**O que fazer.** `expo-notifications`: pedir permissão depois do primeiro login (não na abertura),
registrar o token (`registerDeviceToken`), remover no "Sair" e na exclusão de conta; tocar na notificação
abre a `url` (mesmo mapeamento do M7). Preferência "Receber notificações" em Conta.

**Critérios de aceite.** Sem permissão, nada quebra. **Testes:** registro/remoção com o módulo mockado,
abertura por URL.

---

### M15 — Painel do evento no celular
**Tipo:** story · **Repo:** hub-community-mobile · **Depende de:** PR #11 mesclado

**Contexto.** A aba/menu de gestão lista os eventos que a pessoa gere (`EventsHome`,
`src/lib/admin-access.ts`). O BFF tem `eventSignups` (organizador) e a subscription `credentialCheckedIn`
(WebSocket via `graphql-ws`, `src/index.js` do BFF).

**O que fazer.** Ao tocar num evento da gestão, antes do check-in, um painel: total de inscritos,
credenciados, pendentes de pagamento, últimos credenciamentos; atualização a cada 30 s ou pela subscription
(`graphql-ws` no app, com o token no `connectionParams` — conferir no `src/index.js` do BFF como o
contexto do WebSocket autentica). Botões: "Abrir check-in", "Modo totem".

**Critérios de aceite.** Só eventos geridos (guarda já existente). **Testes:** contagens a partir de uma
lista mockada; reconexão.

---

### M16 — Aceitar convite de gestão
**Tipo:** story · **Repo:** hub-community-mobile · **Depende de:** M1 (M7 para abrir pelo link)

**Contexto.** BFF `src/types/Management.graphql`: `managementInvite(token)` (prévia) e
`acceptManagementInvite(token)`; web `/convite`. O convite também é aceito no login por código do e-mail
convidado (REA-26).

**O que fazer.** Rota `convite?token=`: mostra a prévia (evento/comunidade, papel), pede login se preciso,
aceita, atualiza o `adminAccess` (`useAuth().refreshAccess`) e leva à Gestão.

**Critérios de aceite.** Depois de aceitar, a aba Gestão aparece sem reabrir o app. **Testes:** fluxo
logado e deslogado, convite inválido.

---

### M17 — Lembrete e reenvio de confirmação pela gestão
**Tipo:** story · **Repo:** hub-community-mobile · **Depende de:** M15

**Contexto.** BFF: `emailCampaignAudience`, `emailCampaignPreview`, `startEmailCampaign` (tipo
`reminder`, organizador; `invite` é só admin), `resendSignupConfirmation`; web
`/admin/events/[id]/email`.

**O que fazer.** No painel do evento: "Enviar lembrete" (mostra o público e a prévia, confirma e envia) e,
na ficha de um inscrito no check-in, "Reenviar confirmação".

**Critérios de aceite.** Nenhum envio sem confirmação explícita. **Testes:** fluxo com mocks.

---

### D1 — EAS: projeto e `eas.json` · **precisa do dono**
**Tipo:** task · **Repo:** hub-community-mobile

Criar/vincular o projeto EAS na conta Expo da organização (`eas init`), commitar `eas.json` com perfis
`development` (dev client), `preview` (distribuição interna, APK/ad hoc) e `production`; `expo-updates`
com canal por perfil. Só o dono roda comandos que usam a conta ou geram credenciais.

### D2 — Identificador e nome do app · **precisa do dono**
**Tipo:** task · **Repo:** hub-community-mobile

Confirmar `io.hubcommunity.app` (iOS e Android, em `app.json`) e o nome na loja ("HubCommunity"?) antes
do primeiro envio — não dá para trocar depois. Ícone e splash definitivos.

### D3 — Contas Apple Developer e Google Play · **precisa do dono**
**Tipo:** task

Abrir/confirmar as contas (Apple como organização com D-U-N-S; Google Play Console), quem é titular, e
dar acesso de desenvolvedor a quem publica. Anotar o Team ID da Apple e, após D1, o SHA-256 do certificado
Android (usados no M7).

### D4 — Ligar a conta de revisão na produção · **precisa do dono**
**Tipo:** task · **Repo:** hub-community-bff · **Depende de:** B3, D3

Definir `STORE_REVIEW_EMAIL`/`STORE_REVIEW_CODE` no BFF de produção e informar nas notas de revisão das
lojas; desligar quando não houver revisão em andamento.

### D5 — Fichas das lojas e privacidade · **precisa do dono**
**Tipo:** task · **Depende de:** D3, M5, F1

Textos e capturas de tela; URL da política de privacidade e da página de exclusão (F1); "Privacy Nutrition
Label" (Apple) e "Segurança de dados" (Google) declarando e-mail, nome, CPF, telefone, data de nascimento,
foto (arte), câmera (QR), identificadores de push; classificação etária.

### D6 — Credenciais de push · **precisa do dono**
**Tipo:** task · **Depende de:** D1, D3

Chave APNs (Apple) e projeto Firebase/FCM (Android) no EAS; `EXPO_ACCESS_TOKEN` no BFF (B4).

### D7 — Decisões de produto pendentes · **precisa do dono**
**Tipo:** task

1. Tabela de retenção da exclusão de conta (spec §5), em especial certificados e inscrições pagas.
2. Evento online pago: Pix no app ou só no navegador (spec §3).
3. Inscrição sem login (REA-22) também no app ou só logada.

### D8 — Distribuição do app do totem · **precisa do dono**
**Tipo:** task · **Repo:** hub-community-mobile · **Depende de:** D1

O totem (Gertec SK-210, módulos `modules/topwise-scanner` e `modules/tspl-usb-printer`) é Android sem
Google Play. Decidir: APK interno (perfil `preview`) instalado à mão/MDM, ou o mesmo app das lojas com os
módulos inertes fora do totem (já caem para busca por nome).

### D9 — Primeira publicação (interna e lojas) · **precisa do dono**
**Tipo:** task · **Depende de:** D1–D5, M5

Build `preview` para testadores internos (TestFlight / teste interno do Play); teste fechado exigido pelo
Google para conta nova (conferir a regra vigente); envio à revisão e produção só com autorização explícita.

### D10 — Fase 5: o que da gestão completa vai para o app · **precisa do dono**
**Tipo:** task · **Depende de:** fases 1–4 em uso

Com uso real, decidir quais telas do admin (criar/editar evento, lotes, cupons, programação, arte,
certificados, importação, analytics, comunidades, usuários) valem no celular; cada uma vira card próprio.
