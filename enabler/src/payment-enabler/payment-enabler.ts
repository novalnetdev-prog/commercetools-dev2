export interface PaymentEnabler {
  /**
   * Creates a payment component builder of the specified type.
   * @param type - The type of the payment component builder.
   * @returns A promise that resolves to the payment component builder.
   * @throws {Error} If the payment component builder cannot be created.
   */
  createComponentBuilder: (
    type: string
  ) => Promise<PaymentComponentBuilder | never>;

}

/**
 * Represents the interface for a payment component.
 */
export interface PaymentComponent {
  /**
   * Mounts the payment component to the specified selector.
   * @param selector - The selector where the component will be mounted.
   */
  mount(selector: string): void;

  /**
   * Submits the payment.
   */
  submit(): void;

  /**
   * Shows the validation for the payment component.
   */
  showValidation?(): void;

  /**
   * Checks if the payment component is valid.
   * @returns A boolean indicating whether the payment component is valid.
   */
  isValid?(): boolean;

  /**
   * Gets the state of the payment component.
   * @returns An object representing the state of the payment component.
   */
  getState?(): {
    card?: {
      endDigits?: string;
      brand?: string;
      expiryDate?: string;
    };
  };

  /**
   * Checks if the payment component is available for use.
   * @returns A promise that resolves to a boolean indicating whether the payment component is available.
   */
  isAvailable?(): Promise<boolean>;
}

/**
 * Represents the interface for a payment component builder.
 */
export interface PaymentComponentBuilder {
  /**
   * Indicates whether the component has a submit action.
   */
  componentHasSubmit?: boolean;

  /**
   * Builds a payment component with the specified configuration.
   * @param config - The configuration options for the payment component.
   * @returns The built payment component.
   */
  build(config: ComponentOptions): PaymentComponent;
}

/**
 * Represents the options for the payment enabler.
 */
export type EnablerOptions = {
  /**
   * The URL of the payment processor.
   */
  processorUrl: string;

  /**
   * The session ID for the payment.
   */
  sessionId: string;

  /**
   * The locale for the payment.
   */
  locale?: string;

  /**
   * A callback function that is called when an action is required during the payment process.
   * @returns A promise that resolves when the action is completed.
   */
  onActionRequired?: () => Promise<void>;

  /**
   * A callback function that is called when the payment is completed.
   * @param result - The result of the payment.
   */
  onComplete?: (result: PaymentResult) => void;

  /**
   * A callback function that is called when an error occurs during the payment process.
   * @param error - The error that occurred.
   * @param paymentReference - The payment reference.
   */
  onError?: (
    error: any,
    context?: { paymentReference?: string }
  ) => void;
};

/**
 * Represents the payment method code.
 */
export enum PaymentMethod {
  /* Apple Pay */
  applepay = "applepay",
  /* Bancontact card */
  bancontactcard = "bcmc",
  /* EPS */
  eps = "eps",
  /* Google Pay */
  googlepay = "googlepay",
  /* iDeal */
  ideal = "ideal",
  /* Invoice */
  invoice = "invoice",
  /* PayPal */
  paypal = "paypal",
  /* Prepayment */
  prepayment = "prepayment",
  /* GuaranteedInvoice */
  GuaranteedInvoice = "GuaranteedInvoice",
  /* GuaranteedSepa */
  GuaranteedSepa = "GuaranteedSepa",
  /* TWINT */
  twint = "twint",
  /* SEPA */
  sepa = "sepa",
  /* ACH */
  ach = "ach",
  /* CREDIT CARD */
  creditcard = "creditcard",
  /* Online Bank Transfer */
  onlinebanktransfer = "onlinebanktransfer",
  /* Alipay */
  alipay = "alipay",
  /* Bancontact */
  bancontact = "bancontact",
  /* Blik */
  blik = "blik",
  /* MBWay */
  mbway = "mbway",
  /* Multibanco */
  multibanco = "multibanco",
  /* Postfinance */
  postfinance = "postfinance",
  /* Postfinancecard */
  postfinancecard = "postfinancecard",
  /* przelewy24 */
  przelewy24 = "przelewy24",
  /* Trustly */
  trustly = "trustly",
  /* Wechatpay */
  wechatpay = "wechatpay",  
  pix = "pix",
  boleto = "boleto",
  bizum = "bizum",
  bancomat = "BANCOMATPAY",
  kakaopay = "kakaoPay",
  naverpay = "naverpay",
}


/**
 * Represents the result of a payment.
 */
export type PaymentResult =
  | {
      /**
       * Indicates whether the payment was successful.
       */
      isSuccess: true;

      /**
       * The payment reference.
       */
      paymentReference: string;
    }
  | {
      /**
       * Indicates whether the payment was unsuccessful.
       */
      isSuccess: false;

      /**
       * The payment reference.
       */
      paymentReference?: string;
    };

/**
 * Represents the options for a payment component.
 */
export type ComponentOptions = {
  /**
   * Indicates whether to show the pay button.
   */
  showPayButton?: boolean;

  /**
   * A callback function that is called when the pay button is clicked.
   * @returns A Promise indicating whether the payment should proceed.
   */
  onPayButtonClick?: () => Promise<void>;
};
