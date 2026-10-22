export {};

declare global {
  interface Window {
    NovalnetUtility?: {
      formatIban?: (event: Event, bicDivId?: string) => boolean | void;
      checkIban?: (event: Event, bicDivId?: string) => boolean;
      formatBic?: (event: Event) => boolean;
      setBirthDateFormat: (format: string) => void;
      isNumericBirthdate: (input: HTMLInputElement, event: KeyboardEvent) => boolean | void;
      validateDateFormat: (value: string) => boolean;
    };
  }
}
