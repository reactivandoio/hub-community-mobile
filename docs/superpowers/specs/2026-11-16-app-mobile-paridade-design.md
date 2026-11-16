# App mobile com paridade do web — design

Data: 2026-11-16 · Card de origem: REA-58 · Status: pedido pelo dono ("crie spec e plan de execução, crie
os cards no board e já coloque em automático"); decisões marcadas **(dono)** esperam confirmação dele.

Base: `docs/paridade-web.md` (inventário do web, o que falta, pontos de atenção). Plano de execução e
cards: `docs/superpowers/plans/2026-11-16-app-mobile-paridade.md`.

## 1. Objetivo

O app HubCommunity (Expo 57, React Native 0.86) passa a servir o **participante** — achar eventos,
inscrever-se, pagar por Pix, mostrar o ingresso na porta, gerar a arte "Eu vou", pegar o certificado — e
continua servindo o **gestor** no dia do evento (check-in, totem, etiquetas, que já existem). A gestão
completa (formulários longos) fica no web até o uso real pedir.

Fora de escopo: reescrever regras de negócio no app. Toda regra (permissão, lote, cupom, meia, 18+, Pix,
e-mail) continua no BFF; o app só chama as mesmas operações do web.

## 2. Ponto de partida (PR #11, REA-58)

- Login só por código no e-mail (`requestLoginCode` → `verifyLoginCode`); token e usuário no SecureStore
  (`SessionStore`).
- `AuthProvider` com `adminAccess` em cache (MMKV) para o menu de gestão abrir offline.
- Rotas por `Stack.Protected` em `src/components/root-navigator.tsx`; gestão só para Admin, Community
  Manager e Event Manager, com os eventos que a pessoa gere (`src/lib/admin-access.ts`).
- Sair apaga as listas de inscritos do aparelho.

Todo card de app parte da `main` **depois do merge do PR #11**.

## 3. Decisões

| Tema | Decisão | Por quê |
|---|---|---|
| Navegação | Abas: **Eventos** (público), **Ingressos** (logado), **Conta** (logado) e **Gestão** (só papéis de gestão). Login vira um modal/rota chamado quando uma ação pede sessão, como no web (REA-25) | A Apple recusa app que exige login para conteúdo que não depende de conta (diretriz 5.1.1); o participante abre o app para achar evento e mostrar ingresso |
| Eventos sem login | Lista, página do evento, comunidades e verificação de certificado abertas sem login | Mesmo comportamento do web |
| "Minhas inscrições" | Query nova no BFF `mySignups`, pelo **e-mail do token** (nunca um argumento) | As inscrições vivem no Eventando por e-mail; já existe `findSignupsByEmail` (REA-52) |
| Ingresso | QR com `https://hubcommunity.io/events/<slug>/signup?ticket=<signupId>` — mesmo contrato do web (`lib/ticket.ts`) e do totem (`parseTicket`) | O totem e o check-in já leem esse formato; o id é o de `signupIdOf` |
| Exclusão de conta | Mutation `deleteMyAccount` no BFF; anonimiza (não apaga a linha) para não quebrar relações e registros fiscais. Tabela de retenção em §5 **(dono)** | Apple 5.1.1(v) e Google Play exigem excluir a conta no app; o login por código cria conta |
| Página web de exclusão | `/excluir-conta` no web, que pede o código por e-mail e chama a mesma mutation | O Google exige também um link web |
| Pix | Mesmo fluxo do web: `signupToEvent(kind: PIX_QR)` → `pix_br_code`, QR + copiar, `signupPaymentStatus` até confirmar | Opa Pingou é o único provedor (REA-15) |
| Evento online pago | **(dono)** Proposta: o app mostra o Pix só para evento presencial; evento online pago abre a inscrição no navegador | Lojas podem tratar evento online como conteúdo digital (compra dentro do app) |
| Arte "Eu vou" | Renderizada no app com `react-native-view-shot` (já usado nas etiquetas), mesma `shareArtConfig` e regras de papel/nome do web; compartilhamento nativo | Sem dependência nova pesada; resultado igual ao web |
| Deep links | Universal Links / App Links em `hubcommunity.io` para `/events/<slug>`, `/events/<slug>/signup?ticket=…`, `/convite?token=…`, `/certificado/<code>` | Os e-mails do BFF já apontam para o web; não muda template |
| Push | `expo-notifications` + token do aparelho guardado no backend; envio pelo BFF nos mesmos gatilhos dos e-mails | Fase 3; precisa das credenciais APNs/FCM **(dono)** |
| Dados no aparelho | MMKV criptografado com chave no SecureStore; listas de check-in de eventos encerrados há mais de 7 dias são apagadas | LGPD (dados de terceiros offline) |
| Revisão das lojas | E-mail de revisão com código fixo, ligado só por variável de ambiente no BFF | O revisor não tem acesso ao e-mail; o login é só por código |
| Builds | EAS com perfis `development`, `preview` (interno) e `production`. **Nenhum build de produção nem envio às lojas sem o dono** | Política do projeto |

## 4. Contratos novos no BFF

### 4.1 `mySignups`

```graphql
type MySignup {
  "Same id as eventSignups / the ticket QR (utils/signup-id signupIdOf)."
  id: ID!
  event: MySignupEvent!
  created_at: String
  product_name: String
  "PEDING_PAYMENT | CONFIRMED | EXPIRED | CANCELED | REFUND; null without payment (free, imported, manual)."
  payment_status: String
  "true when the signup holds its place (utils/payment-status holdsPlace)."
  holds_place: Boolean!
  checked_in: Boolean!
  checked_in_at: String
}

type MySignupEvent {
  id: ID!
  slug: String
  title: String
  start_date: String
  end_date: String
  is_online: Boolean
  "Only while the signup holds its place, as isUserSignedUp."
  call_link: String
  location_title: String
  location_city: String
  "First of Event.images."
  cover: String
}

extend type Query {
  "REA-58: the signed-in user's signups (by the token's e-mail), newest event first. UNAUTHENTICATED without a session."
  mySignups: [MySignup!]!
}
```

### 4.2 `deleteMyAccount`

```graphql
type DeleteMyAccountResult {
  success: Boolean!
  message: String
}

extend type Mutation {
  "REA-58: deletes (anonymizes) the signed-in user's account. Needs a fresh login code sent to the account's e-mail (requestLoginCode), so a stolen token alone cannot delete it. Errors: UNAUTHENTICATED, LOGIN_CODE_INVALID, LOGIN_CODE_EXPIRED, RATE_LIMITED."
  deleteMyAccount(code: String!): DeleteMyAccountResult!
}
```

## 5. Retenção na exclusão de conta — proposta **(dono)**

| Dado | O que acontece | Por quê |
|---|---|---|
| Usuário Strapi (nome, e-mail, CPF, telefone, nascimento, redes, capa) | Anonimizado: `email` = `excluido-<documentId>@excluido.invalid`, `username` = `excluido-<documentId>`, `name` = "Conta excluída", demais campos pessoais `null`, `blocked = true`, `marketing_opt_in = false`, papel volta a `authenticated`, sai de `communities` e `managed_events` | Mantém as chaves estrangeiras; a pessoa deixa de ser identificável |
| Códigos de login, convites de gestão pendentes para o e-mail | Apagados | Sem uso |
| Agenda pessoal, avaliações (rate) | Apagadas | Dado só da pessoa |
| Comentários e respostas | Apagados | Conteúdo assinado por ela |
| Votos | Mantidos sem vínculo com a pessoa | Não alterar resultado de votação encerrada |
| Palestrante vinculado | Desvinculado (`unlinkSpeakerAccount`); o perfil de palestrante é conteúdo do evento | Programação publicada continua de pé |
| Inscrições no Eventando | Nome, e-mail, telefone e CPF anonimizados; pagamento mantido | Registro fiscal do pagamento |
| Certificados emitidos | Mantidos (código e nome), porque terceiros verificam pelo código | Interesse legítimo; **o dono confirma** |
| Supressão de e-mail | E-mail original vira hash na lista de supressão | Não mandar campanha para quem saiu |

Inscrições em eventos futuros com pagamento confirmado: a tela de exclusão lista e avisa que o ingresso deixa
de valer; não há reembolso automático.

## 6. Navegação do app (alvo)

```
src/app/
  _layout.tsx                 providers + RootNavigator
  (tabs)/_layout.tsx          Tabs: eventos, ingressos, conta, gestao (Tabs.Protected por papel)
  (tabs)/eventos/index.tsx    lista pública
  (tabs)/ingressos/index.tsx  minhas inscrições (pede login)
  (tabs)/conta/index.tsx      perfil, completar cadastro, sair, excluir conta (pede login)
  (tabs)/gestao/index.tsx     eventos que gere (hoje src/app/gestao)
  login.tsx                   modal de login por código
  events/[slug]/index.tsx     página do evento
  events/[slug]/signup.tsx    inscrição + Pix (pede login)
  events/[slug]/arte.tsx      arte "Eu vou"
  ingresso/[signupId].tsx     ingresso em tela cheia (QR, brilho máximo)
  certificado/...             busca, solicitação, PDF
  checkin/[slug]/*            como hoje (gestão)
```

Toda rota nova entra no `RootNavigator` (ou no layout de abas) dentro da guarda certa; teste de guarda com
`renderRouter` para cada uma.

## 7. Testes

- App: Jest + RNTL 14 (`await render`, `await fireEvent`), `MockedProvider` com `__typename`; telas com
  `useAuth` mockado (`src/test/auth-fixtures.ts`). `tsc --noEmit`, `pnpm lint`, `pnpm test` antes de cada
  commit.
- BFF: Vitest; toda operação nova entra na tabela de `src/__tests__/authorization.test.js` (anônimo,
  outro usuário) e no `schema.test.js`.
- Contrato app × BFF: as operações de `src/lib/queries.ts` do app validadas contra os `.graphql` do BFF
  (script no plano, Tarefa M0).
- Teste no aparelho: dev build (`pnpm android`/`pnpm ios`), nunca build de produção sem o dono.
