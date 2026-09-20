# Modo totem (kiosk) de credenciamento — design

**Data:** 2026-09-18 · **Status:** aprovado, em implementação

## Problema

Em eventos maiores queremos um totem de autoatendimento: o participante chega,
mostra o QR da inscrição na câmera frontal (ou digita o nome), o crachá sai na
impressora e o check-in é registrado — sem operador. Quem ainda não se
inscreveu escaneia um QR no próprio totem, se inscreve pelo celular e volta
para o mesmo fluxo.

Hoje **não existe QR de inscrição**: `signupToEvent` devolve só
`success/message/payment/is_free` e a tela de sucesso da web não mostra QR
(o único QR ali é o PIX). O kiosk portanto atravessa três repositórios.

## Contrato do QR do participante

Conteúdo: **URL da inscrição com o id da inscrição** —

```
https://hubcommunity.io/events/<slug>/signup?ticket=<signupId>
```

- `signupId` é o `documentId` do signup no Eventando (o mesmo `EventSignup.id`
  que `eventSignups` devolve e que o cache do app usa como chave).
- É uma URL https para que, lido por qualquer câmera de celular, abra algo útil
  ("ver minha inscrição") em vez de falhar.
- O leitor do kiosk é tolerante (`parseTicket`): aceita o parâmetro `ticket`
  de qualquer URL, ou o payload cru quando ele não é URL (id puro). Isso
  desacopla o app do formato exato da web.

## BFF (`hub-community-bff`)

- `SignupResponse.signup_id: String` — `documentId || id` do signup criado
  (o Eventando espalha o `signupEntry` na resposta do `POST /signup/:eventId`).
- `IsSignedUpResponse.signup_id: String` — `documentId || id` do primeiro
  signup encontrado por e-mail.
- Nenhuma mudança no Eventando.

## Web (`hub-community-frontend`)

- `IS_USER_SIGNED_UP` e `SIGNUP_TO_EVENT` passam a pedir `signup_id`.
- Novo componente `SignupTicketQr` (`qrcode.react`, já instalado): QR do
  contrato acima + texto "Apresente este QR no credenciamento".
- Aparece em `/events/[id]/signup` em dois lugares: no passo `success`
  (usa o `signup_id` retornado pela mutation — cobre o fluxo de conta nova,
  sem login) e no bloco "já inscrito" (usa `isUserSignedUp.signup_id`).
  Pagamentos pendentes (passo `payment`) não mostram o ticket.

## Mobile (`hub-community-mobile`)

### Rota e entrada
- `src/app/checkin/[slug]/kiosk.tsx` → `<KioskScreen slug />`, `headerShown:false`.
- Botão "Modo totem" na barra da tela de check-in do operador.
- Saída escondida: segurar 2 s o canto superior esquerdo → `Alert` de
  confirmação → `router.back()`. (Fixação de tela é do Android; fora de escopo.)
- `expo-keep-awake` mantém a tela ligada enquanto o kiosk está montado.

### Dependências novas
- `expo-camera` (scanner de QR nativo, `facing="front"`) — exige rebuild
  (`pnpm android`). Plugin em `app.json` com a mensagem de permissão.
- `expo-keep-awake`.

### Layout (uma tela, portrait ou landscape, fonte grande)
1. Cabeçalho: título do evento.
2. Câmera frontal com moldura + "Aproxime o QR code da sua inscrição".
   Sem permissão: botão "Permitir câmera"; o restante segue funcionando.
3. "Ou digite seu nome": `TextInput` grande; lista com até 8 resultados a
   partir de 2 caracteres (`matchesSearch`). Rodapé da lista: "Não achou seu
   nome? Toque para atualizar" → `syncNow()`.
4. Cartão "Ainda não se inscreveu?" com QR (`react-native-qrcode-svg`) da URL
   de inscrição do evento: `settings.signupUrl`, novo campo opcional em
   `EventSettings`, editável nas configurações do evento; quando vazio usa
   `https://hubcommunity.io/events/<slug>/signup`.

### Máquina de estados (`useKioskFlow`)
```
idle ──scan(payload)──► lookup ──hit──► confirm? ──► printing ──► done ──5s──► idle
     └─select(signup)─┘         └─miss─► syncNow ─► lookup ─miss─► not_found ─5s─► idle
```
- **scan**: QR é inequívoco → pula a confirmação e vai direto para
  `printing`. Payloads repetidos são ignorados por 4 s e enquanto o estado não
  é `idle` (a câmera dispara `onBarcodeScanned` continuamente).
- **select** (busca): exige `confirm` ("É você, Fulano? Confirmar / Não sou eu")
  — nome parecido é o erro mais comum de autoatendimento.
- **printing**: `print(badge)` → `store.checkIn` + `store.markPrinted`. Se a
  impressora não estiver pronta ou falhar: faz só `checkIn` e a tela `done`
  diz "Retire seu crachá na recepção" em vez de "Retire seu crachá".
- **já credenciado**: `done` mostra "Você já fez check-in às HH:MM" e um botão
  "Imprimir novamente" (crachá perdido é comum; a impressão não altera o
  check-in).
- **not_found** (após o `syncNow`): "Inscrição não encontrada. Se você acabou
  de se inscrever, aguarde alguns segundos e tente de novo."
- `done` / `not_found` voltam a `idle` sozinhos (5 s) ou ao tocar "Próximo".

A lógica do fluxo fica num hook puro (`useKioskFlow`) que recebe
`{ event, print, printerReady, checkIn, markPrinted, syncNow }` por injeção,
como o resto do módulo; a tela só renderiza o estado.

### Sync
`SyncEngine` já faz pull a cada 30 s. O kiosk passa `pullIntervalMs: 15000`
porque a latência "acabei de me inscrever → meu nome aparece" é o que o
participante sente; a busca por miss dispara `syncNow()` de qualquer forma.

### Testes
- `ticket.test.ts`: `parseTicket` (URL com `ticket`, id cru, URL sem ticket →
  null, string vazia → null), `signupUrlFor`.
- `use-kiosk-flow.test.tsx`: cada transição acima com fakes.
- `kiosk-screen.test.tsx`: `expo-camera` mockado (`CameraView` captura o
  `onBarcodeScanned` para o teste disparar), busca → confirmar → check-in;
  scan → check-in sem confirmação; miss → `syncNow` + mensagem.

## Fora de escopo
- Bloqueio de saída do app (usar fixação de tela do Android).
- QR no e-mail de confirmação (a página já cobre; fica para depois).
- Modo landscape forçado: o layout é flexível, mas `app.json` segue `portrait`.
