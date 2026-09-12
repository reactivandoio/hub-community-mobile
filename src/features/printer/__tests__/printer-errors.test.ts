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
