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
