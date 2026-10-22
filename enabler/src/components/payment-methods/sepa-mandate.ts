export function sepaMandateTemplate(locale: string): string {
  const isGerman = locale.toLowerCase().startsWith('de');

  const text = isGerman
    ? {
        grant: 'Ich erteile hiermit das SEPA-Lastschriftmandat (elektronische Übermittlung) und bestätige, dass die Bankverbindung korrekt ist',
        authorization: 'Ich ermächtige den Zahlungsempfänger, Zahlungen von meinem Konto mittels Lastschrift einzuziehen. Zugleich weise ich mein Kreditinstitut an, die von dem Zahlungsempfänger auf mein Konto gezogenen Lastschriften einzulösen.',
        creditor: 'Gläubiger-Identifikationsnummer: DE53ZZZ00000004253',
        note: 'Hinweis:',
        refund: 'Ich kann innerhalb von acht Wochen, beginnend mit dem Belastungsdatum, die Erstattung des belasteten Betrages verlangen. Es gelten dabei die mit meinem Kreditinstitut vereinbarten Bedingungen.',
      }
    : {
        grant: 'I hereby grant the mandate for the SEPA direct debit (electronic transmission) and confirm that the given bank details are correct',
        authorization: 'I authorise (A) Novalnet AG to send instructions to my bank to debit my account and (B) my bank to debit my account in accordance with the instructions from Novalnet AG.',
        creditor: 'Creditor identifier: DE53ZZZ00000004253',
        note: 'Note:',
        refund: 'You are entitled to a refund from your bank under the terms and conditions of your agreement with bank. A refund must be claimed within 8 weeks starting from the date on which your account was debited.',
      };

  return `
    <details style="font-size:14px;line-height:1.5;">
      <summary style="cursor:pointer;text-decoration:underline;">
        ${text.grant}
      </summary>
      <div style="margin-top:12px;padding:14px 18px;background:#f7f7f7;">
        <p>${text.authorization}</p>
        <p><strong>${text.creditor}</strong></p>
        <p><strong>${text.note}</strong> ${text.refund}</p>
      </div>
    </details>
  `;
}
