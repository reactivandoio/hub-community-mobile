# Plano de paridade: app mobile × web (REA-58)

Data: 2026-11-16. Base: `main` do hub-community-frontend (web), hub-community-bff e hub-community-mobile
nesta data.

Objetivo: o app ter as mesmas funcionalidades do web, começando pelo que mais serve a quem participa de
eventos e está com o celular na mão. O app fala com o **mesmo BFF GraphQL** do web, então quase todo o
trabalho é de tela: as regras de negócio, permissões e e-mails já estão no servidor.

---

## 1. Inventário do web

### 1.1 Público (sem login)

| Área | Rotas do web | O que faz |
|---|---|---|
| Home e descoberta | `/`, `/events`, `/communities`, `/communities/[id]`, `/about` | Lista de eventos (sem os `unlisted`), busca, comunidades e seus eventos |
| Página do evento | `/events/[id]` | Descrição, data, local ou link online, programação (talks), palestrantes, comunidades, comentários |
| Inscrição | `/events/[id]/signup` | Escolha de produto/lote, cupom (`#cupom=CODE`, REA-18), meia-entrada (REA-16), declaração 18+ (REA-36), CPF; **inscrição sem login** (REA-22: a conta nasce na confirmação); lote pago gera **Pix** (QR + copia-e-cola) ou link de pagamento do Opa Pingou |
| Arte "Eu vou" | `/events/[id]/arte` | Gera a arte de divulgação com foto e nome da pessoa e papel (REA-2, REA-43, REA-45, REA-47, REA-49) |
| Palestras e agendas | `/talks/[id]`, `/agendas/[id]` | Detalhe da palestra, avaliação (rate), agenda pessoal |
| Perfis públicos | `/users/[username]` | Perfil público de quem participa/palestra |
| Certificados | `/certificado`, `/certificado/[code]`, `/certificado/verificar/[code]`, `/certificado/solicitar/[slug]` | Busca, download do PDF, verificação pública e formulário de solicitação por categoria |
| Votação e sorteio | `/votacao/[id]`, `/votacao/[id]/resultados`, `/sorteio`, `/vencedores` | Votação em sessões, resultados, sorteio ao vivo e vencedores |
| Fluxos de e-mail | `/email-confirmed`, `/completar-cadastro`, `/convite`, `/descadastro` | Confirmação de inscrição, completar cadastro, aceitar convite de gestão (REA-48), descadastro de campanhas (REA-29) |
| Legais | `/privacy`, `/terms`, `/cookies` | Política de privacidade, termos, cookies |
| Legado | `/criar-senha`, `/reset-password` | Páginas do login por senha, que deixou de existir (REA-26/REA-46) |

### 1.2 Participante logado

| Área | Onde | O que faz |
|---|---|---|
| Login | Modal em qualquer página (REA-25) | **Só por código de 6 dígitos enviado ao e-mail** (REA-26); e-mail novo ganha conta na hora |
| Completar perfil | Modal pós-login | Nome, CPF, data de nascimento, WhatsApp, 18+ e opt-in de novidades |
| Perfil | `/profile`, `/profile/edit` | Dados, redes, foto de capa |
| Minha inscrição | Página do evento | "Você está inscrito", **QR do ingresso** (`signup-ticket-qr`), link da chamada online, retomar pagamento Pix pendente (`guest-payment-resume`), reenviar confirmação (REA-50) |
| Comentários e avaliações | Evento e palestra | Comentar, responder, avaliar |
| Certificado | `/certificado` | Pedir e baixar os próprios certificados |

> Não há hoje uma lista "minhas inscrições" no web nem query no BFF que a devolva (só `isUserSignedUp`
> por evento). Para o app, ela é a tela principal do participante: ver a fase 1.

### 1.3 Gestão (Admin, Community Manager, Event Manager)

Regras (BFF `src/utils/auth`, web `lib/admin-access.ts`):

- **Admin**: tudo, inclusive usuários e papéis.
- **Community Manager**: as comunidades que organiza e os eventos delas, mais os eventos para os quais foi
  convidado como gestor.
- **Event Manager** (REA-48): só os eventos que gerencia (`event.managers`); não cria evento nem mexe em
  comunidade.

| Área | Rotas do web | Quem |
|---|---|---|
| Painel e eventos | `/admin`, `/admin/events`, `/admin/events/new` | Todos os três (Event Manager não cria) |
| Editar evento | `/admin/events/[id]` (dados), `/produtos` (lotes, preços, meia), `/programacao` (talks) | Gestores do evento |
| Cupons | `/admin/events/[id]/cupons` | Gestores do evento (CRUD de cupom é admin no BFF) |
| Arte do evento | `/admin/events/[id]/arte` | Configuração da arte "Eu vou" |
| Presença | `/admin/events/[id]/attendance`, `/attendance/[slug]` | Registro de presença |
| Certificados | `/admin/events/[id]/certificados` | Emissão por categoria e formulários de solicitação |
| E-mails | `/admin/events/[id]/email` | Campanhas (lembrete, compartilhar; convite à base é só admin), contador de envios (REA-52), texto com IA (REA-51) |
| Importar inscritos | `/admin/events/[id]/import-signups` | Planilha → inscrições, reenvio de confirmações |
| Analytics | `/admin/events/[id]/analytics` | Métricas, rastreamento |
| Pagamentos | Cartão no admin | Pagamentos do evento, conta Opa Pingou, aprovação manual (REA-34, só admin) |
| Check-in e etiquetas | `/checkin/[eventSlug]`, `/badge-printer/*` | Credenciamento e impressão de crachá |
| Comunidades | `/admin/communities` | Admin e Community Manager |
| Gestores | Dentro do evento/comunidade | Convidar e remover gestores (REA-48) |
| Só admin | `/admin/usuarios`, `/admin/usuarios/idade`, `/admin/speakers`, `/admin/voting-sessions`, `/admin/configuracoes/ia` | Usuários e papéis, revisão de idade (REA-36), palestrantes, votação, IA |

---

## 2. O que o app tem hoje e o que falta

### Tem (depois deste PR)

- **Login só por código no e-mail** (REA-26). Antes deste PR o app **não tinha login nenhum** — nem por
  senha: guardava um token que nada gravava, e o check-in dependia de o BFF aceitar chamadas anônimas. Desde
  a auditoria LGPD o BFF exige organizador do evento (`requireEventOrganizer`), então, pelo código, o check-in
  do app contra a produção recebe "Não autenticado" (conferido em 2026-11-16 com `eventSignups` anônimo).
- **Menu "Gestão de eventos"** só para Admin, Community Manager e Event Manager, listando só os eventos que a
  pessoa pode gerir.
- **Check-in offline** com fila, busca por nome, inscrição na porta (walk-in), impressão de etiqueta USB
  (Android), **modo totem** com o leitor do Gertec SK-210.
- Sessão encerrada ao expirar; ao sair, as listas de inscritos guardadas no aparelho são apagadas.

### Falta (participante)

Página de evento e descoberta, inscrição (inclusive sem login), pagamento Pix, "minhas inscrições" com QR do
ingresso, arte "Eu vou", certificados, perfil e completar cadastro, programação/agenda, comentários e
avaliações, votação, convite de gestão, descadastro, páginas legais, notificações.

### Falta (gestão)

Tudo do admin além do check-in: criar/editar evento, produtos e lotes, cupons, programação, arte, presença,
certificados, e-mails, importação, analytics, pagamentos, comunidades, gestores, usuários e papéis.

---

## 3. Fases sugeridas

Prioridade pelo que mais serve a quem está com o celular na mão. Cada fase sai em PRs pequenos, com testes,
e é publicada em build interno (EAS) antes de ir às lojas.

### Fase 0 — Base (este PR, REA-58)
Login por código, sessão, menu de gestão por papel, check-in protegido. **Feito.**

### Fase 1 — Participante no dia do evento (prioridade alta)
1. **Minhas inscrições + ingresso com QR** — a tela principal do participante. Precisa de uma query nova no
   BFF (ex.: `mySignups`: eventos, status do pagamento, `signup_id`) com o usuário do token, nunca um id vindo
   do cliente. O QR usa o mesmo formato do web (`signup-ticket-qr`), que o totem já lê (`parseTicket`).
2. **Página do evento** (data, local com mapa, link online, programação, palestrantes).
3. **Lista de eventos e comunidades** (descoberta).
4. **Completar cadastro** depois do login (nome, CPF, nascimento, 18+, WhatsApp) — o certificado exige.
5. Deep links do e-mail de confirmação para a inscrição no app (ver §5.6).

### Fase 2 — Inscrição e pagamento (alta)
1. Inscrição logada: produto/lote, cupom, meia-entrada, 18+.
2. **Pix**: QR + copia-e-cola, acompanhar o status (`signupPaymentStatus`), retomar pagamento pendente.
3. Inscrição sem login (REA-22) só se fizer sentido no app; no celular o login por código é curto.
4. Reenviar confirmação (REA-50).

### Fase 3 — Engajamento (média)
1. **Arte "Eu vou"** com compartilhamento nativo (Instagram Stories, WhatsApp).
2. Certificados: pedir, baixar o PDF, abrir a verificação.
3. Programação pessoal (agenda), avaliações e comentários.
4. Votação e resultados.
5. Notificações push (lembrete do evento, pagamento confirmado, certificado emitido).

### Fase 4 — Gestão leve no celular (média)
O que o gestor faz no corredor do evento: painel do evento (inscritos, check-ins em tempo real via
`credentialCheckedIn`), presença, reenviar confirmação, aprovar pagamento (admin), convidar gestor, enviar
lembrete por e-mail.

### Fase 5 — Gestão completa (baixa)
Criar/editar evento, produtos e lotes, cupons, programação, arte, certificados, importação, analytics,
comunidades, usuários e papéis. Formulários longos rendem mais no web; avaliar uso real antes de portar.

---

## 4. O que reaproveitar do BFF

O app já usa o mesmo BFF; nada de regra de negócio deve ser reescrita no cliente.

| Para | Reaproveitar |
|---|---|
| Login | `requestLoginCode`, `verifyLoginCode` (erros com `extensions.code`: `LOGIN_CODE_COOLDOWN`+`retryAfter`, `LOGIN_CODE_INVALID`+`attemptsLeft`, `LOGIN_CODE_EXPIRED`, `ACCOUNT_BLOCKED`, `RATE_LIMITED`), `me`, `updateProfile` |
| Permissões | `adminAccess` (papel, comunidades e eventos geridos). Regras espelhadas em `src/lib/admin-access.ts`; a proteção real é `requireEventOrganizer`/`requireAdmin` em cada operação |
| Eventos | `events` (com `include_unlisted` só na gestão), `eventBySlugOrId`, `communities`, `talks`, `speakers` |
| Inscrição e Pix | `signupToEvent` (`kind: PIX_QR \| PAYMENT_LINK`), `isUserSignedUp`, `signupPaymentStatus`, validação/preview de cupom, `resendSignupConfirmation` |
| Arte | `shareArtConfig` e as regras de `resolvers/ShareArt/rules.js` |
| Certificados | `certificateRequestForm(s)`, `submitCertificateRequest`; o PDF é gerado pela rota do web (`/api/certificates/[code]/pdf`) — abrir no navegador ou baixar |
| Check-in | `eventSignups`, `checkinSignup`, `manualSignup`, `updateSignup`, `credentialCheckedIn` (já em uso) |
| Gestão | Mesmas operações do admin web (`createEvent`, `updateEventSale`, `eventEmailCampaigns`, `issueCertificates`, `inviteEventManager`…) |
| Tracking | `trackEvent` (tipos conhecidos) |

**Lacunas no BFF** a abrir como cards:
- `mySignups` (Fase 1).
- Exclusão de conta pelo próprio usuário (obrigatória nas lojas, ver §5.8).
- Registro de token de push (Fase 3).
- Opcional: uma query `manageableEvents` no servidor, para o app não depender de cruzar `adminAccess` com a
  lista de eventos (hoje o cliente faz o mesmo cruzamento que o web).

---

## 5. Pontos de atenção

### 5.1 Login só por código no e-mail (REA-26)
- Não existe senha; o app nunca deve oferecer "esqueci a senha" nem pedir senha. As páginas
  `/criar-senha` e `/reset-password` do web são legado.
- E-mail desconhecido ganha conta no `verifyLoginCode`: o app **cria conta** — isso puxa a exigência de
  excluir conta (§5.8).
- Use `textContentType="oneTimeCode"`/`autoComplete="one-time-code"` (feito) para o iOS sugerir o código do
  Mail. "Continuar com o Google" está previsto no web; no iOS, oferecer Google obriga a oferecer também
  **Sign in with Apple** (diretriz 4.8).
- Token em `expo-secure-store`; expira pelo `exp` do JWT. Sem refresh token hoje: a sessão dura o que o
  Strapi define.

### 5.2 Papéis e permissões por evento (REA-48)
- O menu e as listas usam `adminAccess` + `manageableEvents` (mesmo cruzamento do web). A proteção é do BFF:
  `eventSignups`, `checkinSignup`, `manualSignup`, `updateSignup` e `credentialCheckedIn` passam por
  `requireEventOrganizer` — testes do PR do BFF cobrem Event Manager de outro evento, Community Manager de
  outra comunidade e pessoa listada como gestora sem o papel.
- O acesso fica em cache no aparelho (MMKV) para o menu abrir offline na porta do evento; só a resposta do
  servidor muda o cache.
- Aceitar convite (`/convite`) ainda é no web; no app entra na Fase 4 junto com deep link.

### 5.3 Pagamento Pix
- Provedor único: Opa Pingou (REA-15). O app mostra o `pix_br_code` (QR + copiar) e acompanha o status;
  nenhum dado de pagamento passa pelo app além disso.
- **Lojas**: ingresso de evento presencial é bem/serviço físico, então pagamento fora do sistema da Apple/
  Google é permitido (App Store 3.1.3(e)/3.1.5; Google Play idem). Evento **online** pago pode ser lido como
  conteúdo digital — validar antes de vender evento online pelo app (alternativa: só abrir o link de
  pagamento no navegador).

### 5.4 Arte "Eu vou"
- O web gera a arte no canvas do navegador. No app: renderizar com `react-native-view-shot` (já usado nas
  etiquetas) ou `@shopify/react-native-skia`, usando a mesma `shareArtConfig` e as regras de papel/nome
  (REA-47/REA-49); compartilhar com a folha nativa.
- Foto da galeria exige permissão e texto de uso no `app.json`.

### 5.5 E-mails
- Todos continuam saindo do BFF (código de login, confirmação, Pix pendente, certificado, campanhas). O app
  não envia e-mail.
- Os links dos e-mails apontam para `hubcommunity.io`. Com **Universal Links / App Links**
  (`apple-app-site-association` e `assetlinks.json` no domínio do web) os mesmos links abrem o app quando
  instalado, sem mudar os templates.

### 5.6 LGPD
- O check-in guarda nomes, e-mails e telefones de inscritos no aparelho (MMKV) para funcionar offline. Este
  PR apaga tudo ao sair da conta (com aviso se houver registros não enviados) e quando outra pessoa entra no
  mesmo aparelho. Pendências: criptografar o MMKV (`encryptionKey` vinda do SecureStore) e expirar listas de
  eventos já encerrados.
- O ingresso (QR) carrega só o id da inscrição.
- Política de privacidade e termos: links no app e nas fichas das lojas; formulários de "Segurança de dados"
  (Google) e "Privacy Nutrition Label" (Apple) declarando e-mail, nome, CPF, telefone, data de nascimento,
  foto (arte) e câmera (leitura de QR).
- Consentimento de marketing (`marketing_opt_in`) só marcado pela pessoa, como no web.

### 5.7 Publicação nas lojas (EAS, Apple, Google)
- **Não há `eas.json`** no repositório: criar perfis `development`, `preview` (distribuição interna) e
  `production`. Builds de produção e envio às lojas só com autorização do dono.
- Identificadores já no `app.json`: `io.hubcommunity.app` (iOS e Android). Confirmar que é o definitivo
  antes do primeiro envio — não dá para trocar depois.
- Contas: **Apple Developer Program** (US$ 99/ano, de preferência como organização, com D-U-N-S) e **Google
  Play Console** (US$ 25 uma vez; pelo que se sabia, conta nova pessoal exige teste fechado com 12 testadores
  por 14 dias antes da produção — conferir a regra vigente). Quem é o titular das contas é decisão do dono.
- O app tem duas caras: o **participante** (lojas públicas) e o **operador/totem** (módulos nativos de
  impressora USB e do leitor Topwise, só Android). Avaliar distribuir o totem por build interno/MDM e
  manter os módulos nativos inofensivos no build das lojas (já caem para busca por nome quando o leitor não
  existe).
- Revisão da Apple: entregar uma conta de teste que funcione sem acesso ao e-mail (o login é por código) —
  por exemplo, um e-mail de revisão com código fixo no BFF, configurado só para ele.
- OTA: `expo-updates` para correções de JS sem passar pela loja; mudanças nativas exigem novo build.

### 5.8 Exclusão de conta
A Apple (5.1.1(v)) e o Google exigem que app que cria conta permita **excluir a conta dentro do app** (e o
Google, também por uma página web). O BFF não tem essa operação hoje: card próprio, antes da primeira
publicação.

---

## 6. Como testar este PR no celular

Ver a descrição do PR (dev build, BFF de produção ou local, contas com cada papel).
