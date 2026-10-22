import { projectApiRoot } from "../utils/ct-client";

/** Persist Novalnet reconciliation data shared across processor instances. */
export class CustomObjectService {
  async read(container: string, key: string) {
    try {
      return (
        await projectApiRoot
          .customObjects()
          .withContainerAndKey({ container, key })
          .get()
          .execute()
      ).body;
    } catch (error: any) {
      if (error?.statusCode === 404) return undefined;
      throw error;
    }
  }


  async update(
    container: string,
    key: string,
    change: (value: Record<string, any>) => Record<string, any>,
  ) {
    for (let attempt = 0; attempt < 5; attempt++) {
      const stored = await this.read(container, key);
      const value = change(stored?.value ?? {});
      try {
        return await projectApiRoot
          .customObjects()
          .post({
            body: { container, key, version: stored?.version ?? 0, value },
          })
          .execute();
      } catch (error: any) {
        if (error?.statusCode !== 409 || attempt === 4) throw error;
      }
    }
    throw new Error("Custom Object retry exhausted");
  }

  async upsert(container: string, key: string, value: unknown) {
    return this.update(container, key, (current) => {
      const next = value as Record<string, any>;
      const merged = { ...current, ...next };
      if (container !== "nn-private-data") return merged;
      if (current.pendingModification)
        merged.pendingModification = current.pendingModification;
      else delete merged.pendingModification;
      if (current.modificationResults || next.modificationResults)
        merged.modificationResults = {
          ...next.modificationResults,
          ...current.modificationResults,
        };
      for (const name of [
        "additionalInfo",
        "creditEvents",
        "creditEventComments",
        "preCreditRefundEvents",
      ]) {
        if (current[name] || next[name])
          merged[name] = { ...current[name], ...next[name] };
      }
      for (const name of [
        "creditedAmount",
        "preCreditRefundedAmount",
        "refundedAmount",
      ]) {
        if (current[name] != null && next[name] != null)
          merged[name] = Math.max(Number(current[name]), Number(next[name]));
      }
      if (
        current.preCreditRemainingAmount != null &&
        next.preCreditRemainingAmount != null
      )
        merged.preCreditRemainingAmount = Math.min(
          Number(current.preCreditRemainingAmount),
          Number(next.preCreditRemainingAmount),
        );
      return merged;
    });
  }
}

export default new CustomObjectService();
