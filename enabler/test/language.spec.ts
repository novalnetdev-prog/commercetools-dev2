/** @jest-environment jsdom */
import { BaseComponent } from '../src/components/base';

class LanguageComponent extends BaseComponent {
  constructor(locale?: string) {
    super('invoice', { processorUrl: '', sessionId: '', onComplete() {}, onError() {}, locale }, {});
  }
  submit() {}
  mount() {}
  language() { return this.getLanguage(); }
}

describe('shop language selection', () => {
  beforeEach(() => {
    history.replaceState({}, '', '/checkout');
    document.documentElement.lang = '';
  });
  test.each([
    [undefined, 'en'], ['', 'en'], ['fr', 'en'], ['en-GB', 'en'], ['de', 'de'], ['DE', 'de'], ['de-DE', 'de'],
  ])('locale %s uses %s', (locale, expected) => {
    expect(new LanguageComponent(locale).language()).toBe(expected);
  });
  test('German path and document language are used when no locale is supplied', () => {
    history.replaceState({}, '', '/de/checkout');
    expect(new LanguageComponent().language()).toBe('de');
    history.replaceState({}, '', '/checkout');
    document.documentElement.lang = 'de-DE';
    expect(new LanguageComponent().language()).toBe('de');
  });
  test('an explicitly unsupported locale uses English even on a German path', () => {
    history.replaceState({}, '', '/de/checkout');
    expect(new LanguageComponent('fr').language()).toBe('en');
  });
});
