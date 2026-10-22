import {
  type AuthMiddlewareOptions,
  ClientBuilder,
  type HttpMiddlewareOptions,
} from "@commercetools/sdk-client-v2";
import { createApiBuilderFromCtpClient } from "@commercetools/platform-sdk";
import { config } from "../config/config";

const authMiddlewareOptions: AuthMiddlewareOptions = {
  host: config.authUrl,
  projectKey: config.projectKey,
  credentials: {
    clientId: config.clientId,
    clientSecret: config.clientSecret,
  },
};

const httpMiddlewareOptions: HttpMiddlewareOptions = {
  host: config.apiUrl,
  timeout: 5000,
  getAbortController: () => new AbortController(),
  // Writes are recovered from persisted results/version checks, not retried
  // invisibly by the transport after an ambiguous timeout.
  enableRetry: false,
};

const ctpClient = new ClientBuilder()
  .withClientCredentialsFlow(authMiddlewareOptions)
  .withHttpMiddleware(httpMiddlewareOptions)
  .build();

export const projectApiRoot = createApiBuilderFromCtpClient(
  ctpClient,
).withProjectKey({ projectKey: config.projectKey });
