import "@fastify/request-context";
import { ContextData } from "./libs/fastify/context/context";
declare module "@fastify/request-context" {
  interface RequestContextData {
    request: ContextData;
  }
}

declare module "fastify" {
  export interface FastifyRequest {
    correlationId?: string;
  }
}
