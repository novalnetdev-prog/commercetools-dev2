import { InvoiceBuilder } from "../components/payment-methods/invoice/invoice";
import { PrepaymentBuilder } from "../components/payment-methods/prepayment/prepayment";
import { GuaranteedInvoiceBuilder } from "../components/payment-methods/GuaranteedInvoice/GuaranteedInvoice";
import { GuaranteedSepaBuilder } from "../components/payment-methods/GuaranteedSepa/GuaranteedSepa";
import { IdealBuilder } from "../components/payment-methods/ideal/ideal";
import { PaypalBuilder } from "../components/payment-methods/paypal/paypal";
import { OnlinebanktransferBuilder } from "../components/payment-methods/onlinebanktransfer/onlinebanktransfer";
import { AlipayBuilder } from "../components/payment-methods/alipay/alipay";
import { BancontactBuilder } from "../components/payment-methods/bancontact/bancontact";
import { BlikBuilder } from "../components/payment-methods/blik/blik";
import { EpsBuilder } from "../components/payment-methods/eps/eps";
import { MbwayBuilder } from "../components/payment-methods/mbway/mbway";
import { MultibancoBuilder } from "../components/payment-methods/multibanco/multibanco";
import { PostfinanceBuilder } from "../components/payment-methods/postfinance/postfinance";
import { PostfinancecardBuilder } from "../components/payment-methods/postfinancecard/postfinancecard";
import { Przelewy24Builder } from "../components/payment-methods/przelewy24/przelewy24";
import { TrustlyBuilder } from "../components/payment-methods/trustly/trustly";
import { TwintBuilder } from "../components/payment-methods/twint/twint";
import { WechatpayBuilder } from "../components/payment-methods/wechatpay/wechatpay";
import { PixBuilder } from "../components/payment-methods/pix/pix";
import { BoletoBuilder } from "../components/payment-methods/boleto/boleto";
import { BizumBuilder } from "../components/payment-methods/bizum/bizum";
import { BancomatpayBuilder } from "../components/payment-methods/bancomatpay/bancomatpay";
import { KakaopayBuilder } from "../components/payment-methods/kakaopay/kakaopay";
import { NaverpayBuilder } from "../components/payment-methods/naverpay/naverpay";
import { SepaBuilder } from "../components/payment-methods/sepa/sepa";
import { AchBuilder } from "../components/payment-methods/ach/ach";
import { CreditcardBuilder } from "../components/payment-methods/creditcard/creditcard";
import { clearPaymentError, showPaymentError, showReturnedPaymentError } from './payment-error';
import { createRedirectPaymentErrorRecovery } from './redirect-payment-error';
import { paymentComponentKey } from './payment-method';
import {
  EnablerOptions,
  PaymentComponentBuilder,
  PaymentEnabler,
  PaymentResult,
} from "./payment-enabler";

declare global {
  interface ImportMeta {
    env: any;
  }
}

export type BaseOptions = {
  processorUrl: string;
  sessionId: string;
  onPaymentStart?: () => void;
  locale?: string;
  onComplete: (result: PaymentResult) => void;
  onError: (error: any, context?: { paymentReference?: string }) => void;
};

export class NovalnetPaymentEnabler implements PaymentEnabler {
  setupData: Promise<{ baseOptions: BaseOptions }>;
  private redirectError: ReturnType<typeof createRedirectPaymentErrorRecovery>;

  constructor(options: EnablerOptions) {
    this.redirectError = createRedirectPaymentErrorRecovery(options);
    this.setupData = NovalnetPaymentEnabler._Setup(options, () => this.redirectError.cancel());
  }

  private static _Setup = async (
    options: EnablerOptions,
    cancelRecovery: () => void,
  ): Promise<{ baseOptions: BaseOptions }> => {
    showReturnedPaymentError();
    return Promise.resolve({
      baseOptions: {
        processorUrl: options.processorUrl,
        sessionId: options.sessionId,
        onPaymentStart: () => { cancelRecovery(); clearPaymentError(true); },
        locale: options.locale,
        onComplete: (result) => {
          cancelRecovery();
          clearPaymentError(true);
          options.onComplete?.(result);
        },
        onError: (error, context) => {
          cancelRecovery();
          showPaymentError(error);
          options.onError?.(error, context);
        },
      },
    });
  };

  async createComponentBuilder(
    type: string
  ): Promise<PaymentComponentBuilder | never> {
  
    const { baseOptions } = await this.setupData;
    showReturnedPaymentError(true);
    this.redirectError.report();
    
    const paymentType = paymentComponentKey(type);

    const supportedMethods = {
      invoice: InvoiceBuilder,
      prepayment: PrepaymentBuilder,
      guaranteedinvoice: GuaranteedInvoiceBuilder,
      guaranteedsepa: GuaranteedSepaBuilder,
      ideal: IdealBuilder,
      paypal: PaypalBuilder,
      onlinebanktransfer: OnlinebanktransferBuilder,
      alipay: AlipayBuilder,
      bancontact: BancontactBuilder,
      blik: BlikBuilder,
      eps: EpsBuilder,
      mbway: MbwayBuilder,
      multibanco: MultibancoBuilder,
      postfinance: PostfinanceBuilder,
      postfinancecard: PostfinancecardBuilder,
      przelewy24: Przelewy24Builder,
      trustly: TrustlyBuilder,
      twint: TwintBuilder,
      wechatpay: WechatpayBuilder,
      pix: PixBuilder,
      boleto: BoletoBuilder,
      bizum: BizumBuilder,
      "bancomat pay": BancomatpayBuilder,
      bancomatpay: BancomatpayBuilder,
      kakaopay: KakaopayBuilder,
      "kakao pay": KakaopayBuilder,
      naverpay: NaverpayBuilder,
      "naver pay": NaverpayBuilder,
      sepa: SepaBuilder,
      ach: AchBuilder,
      creditcard: CreditcardBuilder,
    };
  
    const Builder = supportedMethods[paymentType];
  
    if (!Builder) {
      throw new Error(`Unsupported payment type: ${type}`);
    }
  
    return new Builder(baseOptions);
  }

}
