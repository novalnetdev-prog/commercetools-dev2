const projectKey = __VITE_CTP_PROJECT_KEY__;

const fetchAdminToken = async () => {
  const myHeaders = new Headers();

  myHeaders.append('Authorization', `Basic ${btoa(`${__VITE_CTP_CLIENT_ID__}:${__VITE_CTP_CLIENT_SECRET__}`)}`);
  myHeaders.append('Content-Type', 'application/x-www-form-urlencoded');

  var urlencoded = new URLSearchParams();
  urlencoded.append('grant_type', 'client_credentials');

  const response = await fetch(`${__VITE_CTP_AUTH_URL__}/oauth/token`, {
    body: urlencoded,
    headers: myHeaders,
    method: 'POST',
    redirect: 'follow',
  });

  const token = await response.json();

  if (response.status !== 200) {
    console.log({
      title: 'Token fetch failed',
      message: `Error ${response.status} while fetching token`,
    });
    return;
  }
  return token.access_token;
}

const getSessionId = async(cartId) => {
  const accessToken = await fetchAdminToken();

  const sessionMetadata = {
    processorUrl: __VITE_PROCESSOR_URL__,
    allowedPaymentMethods: ["Invoice", "Prepayment", "ideal | Wero", "Direct Debit SEPA", "Direct Debit ACH", "Credit/Debit Cards", "PayPal", "Online bank transfer", "Alipay", "Bancontact", "Blik", "eps", "MB Way", "Multibanco", "PostFinance Card", "PostFinance E-Finance", "Przelewy24", "Trustly", "TWINT", "wechatpay"],
  }; 

  const url = `${__VITE_CTP_SESSION_URL__}/${projectKey}/sessions`

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({
      cart: {
        cartRef: {
          id: cartId,
        }
      },
      metadata: sessionMetadata,
    }),
  });
  const data = await res.json();

  if (!res.ok) {
    console.error("Not able to create session:", url, data)
    throw new Error("Not able to create session")
  }
  return data.id;
}
