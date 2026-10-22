/** Resolve historical display titles and API codes without changing stored integrations. */
export function paymentComponentKey(type: string): string {
  const key = String(type ?? '').trim().toLowerCase().replace(/[\s_\/|\-]+/g, '');
  const aliases: Record<string, string> = {
    card: 'creditcard', creditdebitcards: 'creditcard',
    directdebitsepa: 'sepa', directdebitach: 'ach',
    invoicewithpaymentguarantee: 'guaranteedinvoice', guaranteedinvoice: 'guaranteedinvoice',
    directdebitsepawithpaymentguarantee: 'guaranteedsepa', guaranteeddirectdebitsepa: 'guaranteedsepa',
    onlinebanktransfer: 'onlinebanktransfer', idealwero: 'ideal',
    postfinanceefinance: 'postfinance', postfinancecard: 'postfinancecard', bancomat: 'bancomatpay',
  };
  if (aliases[key]) return aliases[key];
  // Preserve the previous enabler's support for descriptive integration types.
  const descriptive: [string, string][] = [
    ['directdebitsepawithpaymentguarantee', 'guaranteedsepa'], ['guaranteedsepa', 'guaranteedsepa'],
    ['invoicewithpaymentguarantee', 'guaranteedinvoice'], ['guaranteedinvoice', 'guaranteedinvoice'],
    ['postfinancecard', 'postfinancecard'], ['postfinance', 'postfinance'],
    ['creditdebitcards', 'creditcard'], ['creditcard', 'creditcard'],
    ['onlinebanktransfer', 'onlinebanktransfer'], ['ideal', 'ideal'], ['sepa', 'sepa'], ['ach', 'ach'], ['mbway', 'mbway'],
  ];
  return descriptive.find(([label]) => key.includes(label))?.[1] ?? key;
}
