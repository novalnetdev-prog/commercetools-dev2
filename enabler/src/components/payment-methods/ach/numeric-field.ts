export function isValidAchNumber(value: string): boolean {
  return /^[0-9]+$/.test(value);
}

function isAllowedNumericText(value: string): boolean {
  return /^[0-9]*$/.test(value);
}

export function achNumberValidationMessage(
  locale: string,
  field: 'account' | 'routing',
): string {
  if (locale === 'de') {
    return field === 'account'
      ? 'Die Kontonummer darf nur Ziffern enthalten.'
      : 'Die Bankleitzahl darf nur Ziffern enthalten.';
  }
  return field === 'account'
    ? 'Account Number may contain only digits.'
    : 'Routing Number may contain only digits.';
}

export function bindAchNumberValidation(
  input: HTMLInputElement | null,
  locale: string,
  field: 'account' | 'routing',
  onError: (message: string) => void,
): void {
  if (!input || input.dataset.novalnetNumericValidation === '1') return;
  input.dataset.novalnetNumericValidation = '1';
  const message = achNumberValidationMessage(locale, field);
  let lastAllowedValue = isAllowedNumericText(input.value) ? input.value : '';

  input.addEventListener('beforeinput', (event: InputEvent) => {
    if (event.data && !isAllowedNumericText(event.data)) {
      event.preventDefault();
      onError(message);
    }
  });

  input.addEventListener('paste', (event: ClipboardEvent) => {
    const pasted = event.clipboardData?.getData('text') ?? '';
    if (!isAllowedNumericText(pasted)) {
      event.preventDefault();
      onError(message);
    }
  });

  input.addEventListener('input', () => {
    if (isAllowedNumericText(input.value)) {
      lastAllowedValue = input.value;
    } else {
      input.value = lastAllowedValue;
      onError(message);
    }
  });

  input.addEventListener('keydown', (event: KeyboardEvent) => {
    if (event.key === 'Enter' && !isValidAchNumber(input.value)) {
      event.preventDefault();
      onError(message);
    }
  });
}
