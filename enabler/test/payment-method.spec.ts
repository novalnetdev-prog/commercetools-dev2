import { paymentComponentKey } from '../src/payment-enabler/payment-method';
describe('component routing', () => {
  test.each([
    ['Invoice', 'invoice'], ['Prepayment', 'prepayment'], ['Invoice with payment guarantee', 'guaranteedinvoice'],
    ['Direct Debit SEPA with payment guarantee', 'guaranteedsepa'], ['iDEAL | Wero', 'ideal'], ['PayPal', 'paypal'],
    ['Online bank transfer', 'onlinebanktransfer'], ['Alipay', 'alipay'], ['Bancontact', 'bancontact'], ['Blik', 'blik'],
    ['eps', 'eps'], ['MB Way', 'mbway'], ['Multibanco', 'multibanco'], ['PostFinance E-Finance', 'postfinance'],
    ['PostFinance Card', 'postfinancecard'], ['Przelewy24', 'przelewy24'], ['Trustly', 'trustly'], ['TWINT', 'twint'],
    [' WeChat Pay', 'wechatpay'], ['WeChat Pay', 'wechatpay'], ['Direct Debit SEPA', 'sepa'], ['Direct Debit ACH', 'ach'],
    ['Credit/Debit Cards', 'creditcard'], ['Pix', 'pix'], ['Boleto', 'boleto'], ['Bizum', 'bizum'],
    ['BANCOMAT Pay', 'bancomatpay'], ['KakaoPay', 'kakaopay'], ['Naver Pay', 'naverpay'],
    ['GUARANTEED_DIRECT_DEBIT_SEPA', 'guaranteedsepa'], ['DIRECT_DEBIT_SEPA', 'sepa'], ['CREDITCARD', 'creditcard'], ['Credit/Debit Cards - Legacy', 'creditcard'], ['Direct Debit SEPA - Old Integration', 'sepa'],
  ])('%s resolves to %s', (type, key) => expect(paymentComponentKey(type)).toBe(key));
});
