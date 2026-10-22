export function isAllowedAccountHolderText(value: string): boolean {
  return /^[\p{L}& ]*$/u.test(value);
}

export function isValidAccountHolder(value: string): boolean {
  return /\p{L}/u.test(value) && isAllowedAccountHolderText(value.trim());
}

export function accountHolderValidationMessage(locale: string): string {
  return locale === 'de'
    ? 'Der Kontoinhaber darf nur Buchstaben, Leerzeichen und & enthalten.'
    : 'Account holder may contain only letters, spaces, and &.';
}

export function bindAccountHolderValidation(
  input: HTMLInputElement | null,
  locale: string,
  onError: (message: string) => void,
): void {
  if (!input || input.dataset.novalnetHolderValidation === '1') return;
  input.dataset.novalnetHolderValidation = '1';
  const message = accountHolderValidationMessage(locale);
  let lastAllowedValue = isAllowedAccountHolderText(input.value) ? input.value : '';

  input.addEventListener('beforeinput', (event: InputEvent) => {
    if (event.data && !isAllowedAccountHolderText(event.data)) {
      event.preventDefault();
      onError(message);
    }
  });

  input.addEventListener('paste', (event: ClipboardEvent) => {
    const pasted = event.clipboardData?.getData('text') ?? '';
    if (!isAllowedAccountHolderText(pasted)) {
      event.preventDefault();
      onError(message);
    }
  });

  input.addEventListener('input', () => {
    if (isAllowedAccountHolderText(input.value)) {
      lastAllowedValue = input.value;
    } else {
      input.value = lastAllowedValue;
      onError(message);
    }
  });

  input.addEventListener('keydown', (event: KeyboardEvent) => {
    if (event.key === 'Enter' && !isValidAccountHolder(input.value)) {
      event.preventDefault();
      onError(message);
    }
  });
}
