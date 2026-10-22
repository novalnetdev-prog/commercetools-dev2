import { DefaultPaymentService } from "@commercetools/connect-payments-sdk/dist/commercetools/services/ct-payment.service";

const copy = <T>(value: T): T => structuredClone(value);
const missing = () =>
  Object.assign(new Error("Not found"), { statusCode: 404 });

/** In-memory API boundary: production service/SDK code runs, HTTP is stubbed. */
export function commerce() {
  const state: any = {
    payment: {
      id: "payment-a",
      version: 1,
      amountPlanned: { centAmount: 799, currencyCode: "EUR" },
      transactions: [],
      paymentMethodInfo: {},
    },
    cart: {
      id: "cart-a",
      version: 1,
      anonymousId: "anonymous-a",
      customerEmail: "test@example.invalid",
      billingAddress: {
        firstName: "Test",
        lastName: "Shopper",
        streetName: "Teststr, 1",
        postalCode: "12345",
        city: "Berlin",
        country: "DE",
      },
      shippingAddress: {
        firstName: "Test",
        lastName: "Shopper",
        streetName: "Teststr, 1",
        postalCode: "12345",
        city: "Berlin",
        country: "DE",
      },
      taxedPrice: { totalGross: { centAmount: 799, currencyCode: "EUR" } },
      lineItems: [],
      customLineItems: [],
      paymentInfo: { payments: [{ typeId: "payment", id: "payment-a" }] },
    },
    order: {
      id: "order-a",
      version: 1,
      orderState: "Open",
      paymentState: "Pending",
    },
    objects: new Map<string, any>(),
    paymentWrites: [],
    orderWrites: [],
  };
  const execute = (fn: () => any) => ({
    execute: async () => ({ body: copy(fn()) }),
  });
  const paymentWrite = jest.fn(({ body }: any) =>
    execute(() => {
      if (body.version !== state.payment.version)
        throw Object.assign(new Error("Conflict"), { statusCode: 409 });
      state.paymentWrites.push(copy(body));
      for (const action of body.actions) {
        const tx = state.payment.transactions.find(
          (item: any) => item.id === action.transactionId,
        );
        switch (action.action) {
          case "addTransaction":
            state.payment.transactions.push({
              id: `tx-${state.payment.transactions.length + 1}`,
              ...copy(action.transaction),
            });
            break;
          case "changeTransactionState":
            tx.state = action.state;
            break;
          case "setTransactionCustomType":
            tx.custom = { type: action.type, fields: action.fields ?? {} };
            break;
          case "setTransactionCustomField":
            tx.custom.fields[action.name] = action.value;
            break;
          case "setStatusInterfaceCode":
            state.payment.paymentStatus = {
              ...state.payment.paymentStatus,
              interfaceCode: action.interfaceCode,
            };
            break;
          case "setInterfaceId":
            state.payment.interfaceId = action.interfaceId;
            break;
          case "setMethodInfoMethod":
            state.payment.paymentMethodInfo.method = action.method;
            break;
          case "changeTransactionInteractionId":
            tx.interactionId = action.interactionId;
            break;
          default:
            throw new Error(
              `Unimplemented test payment action: ${action.action}`,
            );
        }
      }
      state.payment.version++;
      return state.payment;
    }),
  );
  const paymentResource = {
    get: () => execute(() => state.payment),
    post: paymentWrite,
  };
  const objectWrite = jest.fn(({ body }: any) =>
    execute(() => {
      const key = `${body.container}/${body.key}`;
      const old = state.objects.get(key);
      if (body.version != null && body.version !== (old?.version ?? 0))
        throw Object.assign(new Error("Conflict"), { statusCode: 409 });
      const value = {
        ...copy(body),
        version: (old?.version ?? 0) + 1,
        id: key,
      };
      state.objects.set(key, value);
      return value;
    }),
  );
  const objectResource = ({ container, key }: any) => ({
    get: () =>
      execute(() => {
        const item = state.objects.get(`${container}/${key}`);
        if (!item) throw missing();
        return item;
      }),
    delete: ({ queryArgs }: any) =>
      execute(() => {
        const item = state.objects.get(`${container}/${key}`);
        if (!item) throw missing();
        if (queryArgs.version !== item.version)
          throw Object.assign(new Error("Conflict"), { statusCode: 409 });
        state.objects.delete(`${container}/${key}`);
        return item;
      }),
  });
  const orderWrite = jest.fn(({ body }: any) =>
    execute(() => {
      state.orderWrites.push(copy(body));
      for (const action of body.actions) {
        if (action.action === "setCustomType")
          state.order.custom = {
            type: { id: "order-comment-type" },
            fields: {},
          };
        else if (action.action === "setCustomField")
          state.order.custom.fields[action.name] = action.value;
        else if (action.action === "changePaymentState")
          state.order.paymentState = action.paymentState;
        else throw new Error(`Unexpected fulfillment action: ${action.action}`);
      }
      state.order.version++;
      return state.order;
    }),
  );
  const api = {
    payments: jest.fn(() => ({ withId: () => paymentResource })),
    carts: jest.fn(() => ({
      get: jest.fn(() =>
        execute(() => ({ results: state.cart ? [state.cart] : [] })),
      ),
    })),
    orders: jest.fn(() => ({
      get: () => execute(() => ({ results: state.order ? [state.order] : [] })),
      withId: () => ({
        get: () => execute(() => state.order),
        post: orderWrite,
      }),
    })),
    customObjects: jest.fn(() => ({
      withContainerAndKey: objectResource,
      post: objectWrite,
      get: ({ queryArgs }: any) =>
        execute(() => ({
          results: [...state.objects.values()].filter((item: any) =>
            queryArgs.where.includes(`key="${item.key}"`),
          ),
        })),
    })),
    types: jest.fn(() => ({
      withKey: () => ({
        get: () => execute(() => ({ id: "order-comment-type" })),
      }),
    })),
  };
  const ctPaymentService = new DefaultPaymentService({
    ctAPI: {
      payment: {
        getPaymentById: async () => copy(state.payment),
        createPayment: async (draft: any) => {
          state.payment = { ...state.payment, ...copy(draft) };
          return copy(state.payment);
        },
        updatePayment: async ({ resource, actions }: any) =>
          (
            await paymentWrite({
              body: { version: resource.version, actions },
            }).execute()
          ).body,
      },
    } as any,
    logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() } as any,
  });
  const ctCartService: any = {
    getCart: jest.fn(async () => copy(state.cart)),
    addPayment: jest.fn(async () => copy(state.cart)),
    getPaymentAmount: jest.fn(async () => copy(state.payment.amountPlanned)),
    getOneShippingAddress: jest.fn(({ cart }: any) => cart.shippingAddress),
  };
  return {
    state,
    api,
    ctPaymentService,
    ctCartService,
    paymentWrite,
    orderWrite,
    objectWrite,
  };
}

export const initialTransaction = (
  type = "Authorization",
  state = "Success",
  amount = 799,
) => ({
  id: "tx-original",
  type,
  state,
  amount: { centAmount: amount, currencyCode: "EUR" },
  interactionId: "psp-a",
  custom: {
    type: { id: "transaction-comment-type" },
    fields: {
      transactionComments:
        "Novalnet Transaction ID: 15453500048018276\nPayment Type: Direct Debit SEPA",
    },
  },
});

export function seedReference(state: any, extra: object = {}) {
  state.objects.set("nn-private-data/payment-a-psp-a", {
    id: "private-a",
    version: 1,
    container: "nn-private-data",
    key: "payment-a-psp-a",
    value: { tid: "15453500048018276", ...extra },
  });
}

export const gatewayResponse = (reply: any) =>
  ({
    ok: true,
    status: 200,
    text: async () => JSON.stringify(reply),
  }) as Response;
