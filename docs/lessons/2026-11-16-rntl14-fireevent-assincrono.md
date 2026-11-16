---
symptom: "You seem to have overlapping act() calls, this is not supported. Be sure to await previous act() calls before making a new one."
tags: [jest, testing-library, react-native, act]
evidence: fixed
card: REA-58
pr:
agent: claude
date: 2026-11-16
---
## Causa

No `@testing-library/react-native` 14, `fireEvent` (assim como `render`) é assíncrono e roda dentro de
um `act` próprio. Chamado sem `await`, o próximo `fireEvent` ou `act` começa antes de o anterior
terminar: o React avisa de `act` sobreposto e as atualizações de estado (ex.: a troca de passo do
login) não chegam à árvore, então `getByLabelText` falha sem motivo aparente.

## Correção

`await fireEvent.press(...)` / `await fireEvent.changeText(...)` em todo teste de tela, igual ao
`await render(...)`.

## Como conferir

`pnpm test` sem nenhum `console.error` de "overlapping act() calls" e os testes de
`src/components/auth/__tests__/login-screen.test.tsx` passando.
