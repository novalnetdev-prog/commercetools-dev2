import { projectApiRoot } from "../utils/ct-client";
import { log } from "../libs/logger";

export async function getOrderByOrderNumber(
  orderNumber: string,
): Promise<any | null> {
  try {
    const response = await projectApiRoot
      .orders()
      .withOrderNumber({ orderNumber })
      .get()
      .execute();
    return response.body;
  } catch (error) {
    log.error("Error fetching order by order number", { orderNumber, error });
    return null;
  }
}

export async function getOrderIdFromOrderNumber(
  orderNumber: string,
): Promise<string | null> {
  const order = await getOrderByOrderNumber(orderNumber);
  return order?.id ?? null;
}
