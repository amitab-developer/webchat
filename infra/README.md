# Infrastructure

This directory contains the `azd` Bicep deployment for WebChat.

It provisions:

- one Linux App Service that runs `backend.main:app` and serves the built Vite frontend;
- one Linux App Service plan;
- one user-assigned managed identity;
- Log Analytics and Application Insights;
- one Azure AI Foundry/OpenAI-compatible `AIServices` account with a chat model deployment;
- one serverless Cosmos DB account with the WebChat database and three containers:
  `chat_sessions`, `chat_messages`, and `webchat_documents`.

The deployed app uses managed identity instead of runtime keys:

- Cosmos local authentication is disabled.
- Azure AI local authentication is disabled.
- The App Service identity gets Cosmos DB data contributor access scoped to the
  WebChat database.
- The App Service identity gets Cognitive Services/OpenAI user access scoped to
  the Azure AI resource.

## Deploy

Create/select an `azd` environment, then set the required values:

```sh
azd env new dev
azd env set AZURE_LOCATION canadacentral
azd env set AZURE_RESOURCE_GROUP rg-webchat-dev
azd env set AZURE_WEBCHAT_APP_NAME app-webchat-dev
azd env set AZURE_WEBCHAT_APP_SERVICE_PLAN_NAME asp-webchat-dev
azd env set AZURE_USER_ASSIGNED_IDENTITY_NAME id-webchat-dev
azd env set AZURE_LOG_ANALYTICS_WORKSPACE_NAME log-webchat-dev
azd env set AZURE_APPLICATION_INSIGHTS_NAME appi-webchat-dev
azd env set AZURE_FOUNDRY_NAME ai-webchat-dev
azd env set AZURE_FOUNDRY_LOCATION canadacentral
azd env set AZURE_COSMOS_DATABASE_ACCOUNT_NAME cosmos-webchat-dev
azd env set AZURE_COSMOS_WEBCHAT_DATABASE_NAME webchat
azd env set AZURE_FOUNDRY_CHAT_MODEL_DEPLOYMENT '{"name":"chat-gpt-5-4-mini","model":"gpt-5.4-mini","version":"2026-03-17","capacity":100}'
```

Then provision and deploy:

```sh
azd provision
azd deploy
```

`AZURE_FOUNDRY_CHAT_MODEL_DEPLOYMENT` is JSON for provisioning because Bicep
needs the deployment name, model, version, and capacity. The deployed App
Service receives only the deployment name in its application settings.

For local `.azure/local/.env`, keep `AZURE_FOUNDRY_CHAT_MODEL_DEPLOYMENT` as a
plain deployment name because the backend uses it directly.
