import { bindAccountHolderValidation, isValidAccountHolder } from '../src/components/payment-methods/account-holder';
import { bindAchNumberValidation, isValidAchNumber } from '../src/components/payment-methods/ach/numeric-field';
class Input {
  value = ''; dataset: Record<string, string> = {}; handlers: Record<string, Function> = {};
  addEventListener(type: string, fn: Function) { this.handlers[type] = fn; }
  fire(type: string, fields: object) { const event = { preventDefault: jest.fn(), ...fields }; this.handlers[type](event); return event; }
}
describe('account holder and ACH input validation', () => {
  test.each(['Müller & Söhne', 'Jörg Weiß', 'John Doe'])('allows %s', (text) => expect(isValidAccountHolder(text)).toBe(true));
  test.each(['', '123', 'Name123', 'Name@', '& ', 'A-B'])('rejects %s', (text) => expect(isValidAccountHolder(text)).toBe(false));
  test('holder validation rejects typed/pasted invalid text and Enter, and rolls back invalid input', () => {
    const input = new Input(), onError = jest.fn(); input.value = 'Müller'; bindAccountHolderValidation(input as any, 'de', onError);
    expect(input.fire('beforeinput', { data: '1' }).preventDefault).toHaveBeenCalled();
    expect(input.fire('paste', { clipboardData: { getData: () => 'Invalid9' } }).preventDefault).toHaveBeenCalled();
    input.value = 'Invalid9'; input.fire('input', {}); expect(input.value).toBe('Müller');
    input.value = ''; expect(input.fire('keydown', { key: 'Enter' }).preventDefault).toHaveBeenCalled();
    expect(onError).toHaveBeenCalledWith(expect.stringContaining('Kontoinhaber'));
  });
  test.each(['123456', '00001234'])('ACH preserves numeric text and leading zeroes: %s', (text) => expect(isValidAchNumber(text)).toBe(true));
  test.each(['', '12a', '12 3', '+123', '1.23'])('ACH rejects %s', (text) => expect(isValidAchNumber(text)).toBe(false));
  test('ACH rejects paste and typing, and rolls back invalid input', () => {
    const input = new Input(), onError = jest.fn(); input.value = '0012'; bindAchNumberValidation(input as any, 'de', 'routing', onError);
    expect(input.fire('beforeinput', { data: 'a' }).preventDefault).toHaveBeenCalled();
    expect(input.fire('paste', { clipboardData: { getData: () => '12-34' } }).preventDefault).toHaveBeenCalled();
    input.value = '00a'; input.fire('input', {}); expect(input.value).toBe('0012');
    expect(onError).toHaveBeenCalledWith(expect.stringContaining('Bankleitzahl'));
  });
});
