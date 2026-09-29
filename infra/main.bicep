targetScope = 'subscription'

@description('AZD environment name used to tag and scope the deployment.')
param environment string

@description('Primary Azure region for the deployment.')
param location string

@description('JSON string of additional tags applied to provisioned resources.')
param additionalTagsJSON string = ''

@description('Resource group to create or update.')
param resourceGroupName string

@description('Globally unique name for the Web Chat App Service.')
param webAppName string

@description('Name of the Linux App Service plan.')
param appServicePlanName string

@description('JSON object for the Linux App Service plan configuration.')
param appServicePlanJSON string = '{"sku":{"tier":"Basic","name":"B1","capacity":1}}'

@description('Name of the user-assigned managed identity.')
param userAssignedIdentityName string

@description('Name of the Log Analytics workspace.')
param logAnalyticsWorkspaceName string

@description('Name of Application Insights.')
param applicationInsightsName string

@description('Name of the Azure AI Foundry/OpenAI-compatible cognitive resource.')
param azureOpenAIName string

@description('Azure region for the Foundry/OpenAI-compatible resource.')
param azureOpenAILocation string = location

@description('Azure OpenAI-compatible API version used by the application runtime.')
param azureOpenAIApiVersion string

@description('SKU name for Azure OpenAI-compatible model deployments.')
param azureOpenAIDeploymentSkuName string = 'GlobalStandard'

@description('JSON object for the chat model deployment.')
param azureOpenAIChatModelDeployment string

@description('Name of the Azure Cosmos DB account.')
param azureCosmosAccountName string

@description('Azure Cosmos DB database name for web chat runtime data.')
param webchatCosmosDatabaseName string = 'webchat'

@description('Azure Cosmos DB container name for chat session metadata.')
param webchatCosmosSessionsContainerName string = 'chat_sessions'

@description('Azure Cosmos DB container name for chat message history.')
param webchatCosmosMessagesContainerName string = 'chat_messages'

@description('Azure Cosmos DB container name for uploaded document metadata and extracted text.')
param webchatCosmosDocumentsContainerName string = 'webchat_documents'

@description('Maximum number of files a user can upload to a session.')
param sessionUploadMaxFileCount string = '10'

@description('Maximum upload size in bytes for a single session file.')
param sessionUploadMaxFileSizeBytes string = '10485760'

@description('Comma-separated list of allowed upload file extensions.')
param sessionUploadSupportedExtensions string = '.txt,.md,.csv,.vtt,.html,.pdf,.docx,.xlsx,.pptx,.jpg,.jpeg,.png,.bmp,.tif,.tiff,.heif'

@description('Maximum assistant chat message length accepted by the API.')
param chatMaxMessageLength string = '25000'

@description('Optional deployment commit SHA to surface in app settings.')
param deployCommitSha string = ''

@description('Optional comma-separated list of principal IDs of users deploying/debugging the resources.')
param debugUserPrincipalIds string = ''

@description('Optional principal ID of the primary Azure deployer/service principal.')
param azurePrincipalId string = ''

var tags = union(empty(additionalTagsJSON) ? {} : json(additionalTagsJSON), { 'azd-env-name': environment })

resource rg 'Microsoft.Resources/resourceGroups@2022-09-01' = {
  name: resourceGroupName
  location: location
  tags: tags
}

module rgResources './resources.bicep' = {
  name: 'rgResources'
  scope: resourceGroup(resourceGroupName)
  params: {
    location: location
    tags: tags
    webAppName: webAppName
    appServicePlanName: appServicePlanName
    appServicePlanConfig: json(appServicePlanJSON)
    userAssignedIdentityName: userAssignedIdentityName
    logAnalyticsWorkspaceName: logAnalyticsWorkspaceName
    applicationInsightsName: applicationInsightsName
    azureOpenAIName: azureOpenAIName
    azureOpenAILocation: azureOpenAILocation
    azureOpenAIApiVersion: azureOpenAIApiVersion
    azureOpenAIDeploymentSkuName: azureOpenAIDeploymentSkuName
    azureOpenAIChatModelDeployment: json(azureOpenAIChatModelDeployment)
    azureCosmosAccountName: azureCosmosAccountName
    webchatCosmosDatabaseName: webchatCosmosDatabaseName
    webchatCosmosSessionsContainerName: webchatCosmosSessionsContainerName
    webchatCosmosMessagesContainerName: webchatCosmosMessagesContainerName
    webchatCosmosDocumentsContainerName: webchatCosmosDocumentsContainerName
    sessionUploadMaxFileCount: sessionUploadMaxFileCount
    sessionUploadMaxFileSizeBytes: sessionUploadMaxFileSizeBytes
    sessionUploadSupportedExtensions: sessionUploadSupportedExtensions
    chatMaxMessageLength: chatMaxMessageLength
    deployCommitSha: deployCommitSha
    userPrincipalIds: debugUserPrincipalIds
    azurePrincipalId: azurePrincipalId
  }
  dependsOn: [
    rg
  ]
}

output AZURE_CLIENT_ID string = rgResources.outputs.webAppIdentityClientId
output AZURE_WEBCHAT_ENDPOINT string = rgResources.outputs.webAppEndpoint
output AZURE_FOUNDRY_API_ENDPOINT string = rgResources.outputs.azureOpenAIEndpoint
output AZURE_COSMOS_ENDPOINT string = rgResources.outputs.cosmosEndpoint
