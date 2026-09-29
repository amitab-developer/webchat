@description('Primary region for all Azure resources.')
param location string = resourceGroup().location

@description('Tags applied to provisioned resources.')
param tags object = {}

@description('Python runtime version for the FastAPI App Service.')
@allowed(['3.12', '3.13'])
param pythonVersion string = '3.12'

@description('Name for the Web Chat App Service.')
param webAppName string

@description('Name of the Linux App Service plan.')
param appServicePlanName string

@description('Configuration for the Linux App Service plan.')
param appServicePlanConfig object = {
  sku: {
    tier: 'Basic'
    name: 'B1'
    capacity: 1
  }
}

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

@description('Chat model deployment object.')
param azureOpenAIChatModelDeployment object

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
param userPrincipalIds string = ''

@description('Optional principal ID of the primary Azure deployer/service principal.')
param azurePrincipalId string = ''

var splitUserPrincipalIds = [for id in split(userPrincipalIds, ','): trim(id)]
var filteredUserPrincipalIds = filter(splitUserPrincipalIds, (id) => !empty(id))
var operationalSupportPrincipalIds = union(filteredUserPrincipalIds, filter([azurePrincipalId], (id) => !empty(id)))
var applicationInsightsConnectionString = applicationInsights.properties.ConnectionString
var applicationInsightsInstrumentationKey = applicationInsights.properties.InstrumentationKey
var azureOpenAIEndpoint = 'https://${azureOpenAIName}.cognitiveservices.azure.com/'
var chatModelDeployment = union(
  {
    version: ''
    capacity: 1
  },
  azureOpenAIChatModelDeployment
)
var azureOpenAIDeployment = string(chatModelDeployment.name)
var azureOpenAIChatCompletionModel = string(chatModelDeployment.model)
var azureOpenAIChatCompletionModelVersion = string(chatModelDeployment.version)
var azureOpenAIChatDeploymentCapacity = int(chatModelDeployment.capacity)
var cosmosEndpoint = cosmosAccount.properties.documentEndpoint
var cosmosDatabaseScope = '${cosmosAccount.id}/dbs/${webchatCosmosDatabaseName}'

var monitoringMetricsPublisherId = '3913510d-42f4-4e42-8a64-420c390055eb'
var cognitiveServicesUserRoleId = 'a97b65f3-24c7-4388-baec-2e87135dc908'
var cognitiveServicesOpenAIUserRoleId = '5e0bd9bd-7b93-4f28-af87-19fc36ad61bd'
var cosmosBuiltInDataContributorRoleDefinitionId = '00000000-0000-0000-0000-000000000002'

resource logAnalytics 'Microsoft.OperationalInsights/workspaces@2025-02-01' = {
  name: logAnalyticsWorkspaceName
  location: location
  properties: any({
    retentionInDays: 30
    features: {
      searchVersion: 1
    }
    sku: {
      name: 'PerGB2018'
    }
  })
  tags: tags
}

resource applicationInsights 'Microsoft.Insights/components@2020-02-02' = {
  name: applicationInsightsName
  location: location
  kind: 'web'
  properties: {
    Application_Type: 'web'
    WorkspaceResourceId: logAnalytics.id
    DisableLocalAuth: true
  }
  tags: tags
}

resource webAppIdentity 'Microsoft.ManagedIdentity/userAssignedIdentities@2024-11-30' = {
  name: userAssignedIdentityName
  location: location
  tags: tags
}

resource azureOpenAI 'Microsoft.CognitiveServices/accounts@2025-06-01' = {
  name: azureOpenAIName
  location: azureOpenAILocation
  kind: 'AIServices'
  identity: {
    type: 'SystemAssigned'
  }
  sku: {
    name: 'S0'
  }
  properties: {
    customSubDomainName: azureOpenAIName
    disableLocalAuth: true
    networkAcls: {
      defaultAction: 'Allow'
      virtualNetworkRules: []
      ipRules: []
    }
    publicNetworkAccess: 'Enabled'
    allowProjectManagement: true
  }
  tags: tags
}

module azureOpenAIDeploymentResource './openai_deployment.bicep' = {
  name: 'azureOpenAIChatDeployment'
  params: {
    azureOpenAIAccountName: azureOpenAIName
    deploymentName: azureOpenAIDeployment
    modelName: azureOpenAIChatCompletionModel
    modelVersion: azureOpenAIChatCompletionModelVersion
    deploymentSkuName: azureOpenAIDeploymentSkuName
    deploymentCapacity: azureOpenAIChatDeploymentCapacity
  }
  dependsOn: [
    azureOpenAI
  ]
}

resource cosmosAccount 'Microsoft.DocumentDB/databaseAccounts@2024-11-15' = {
  name: azureCosmosAccountName
  location: location
  kind: 'GlobalDocumentDB'
  properties: {
    databaseAccountOfferType: 'Standard'
    disableLocalAuth: true
    publicNetworkAccess: 'Enabled'
    enableAutomaticFailover: false
    minimalTlsVersion: 'Tls12'
    locations: [
      {
        locationName: location
        failoverPriority: 0
        isZoneRedundant: false
      }
    ]
    capabilities: [
      {
        name: 'EnableServerless'
      }
    ]
    consistencyPolicy: {
      defaultConsistencyLevel: 'Session'
    }
  }
  tags: tags

  resource webchatSqlDatabase 'sqlDatabases' = {
    name: webchatCosmosDatabaseName
    properties: {
      resource: {
        id: webchatCosmosDatabaseName
      }
    }

    resource sessionsContainer 'containers' = {
      name: webchatCosmosSessionsContainerName
      properties: {
        resource: {
          id: webchatCosmosSessionsContainerName
          partitionKey: {
            paths: [
              '/sessionId'
            ]
            kind: 'Hash'
          }
        }
      }
    }

    resource messagesContainer 'containers' = {
      name: webchatCosmosMessagesContainerName
      properties: {
        resource: {
          id: webchatCosmosMessagesContainerName
          partitionKey: {
            paths: [
              '/sessionId'
            ]
            kind: 'Hash'
          }
        }
      }
    }

    resource documentsContainer 'containers' = {
      name: webchatCosmosDocumentsContainerName
      properties: {
        resource: {
          id: webchatCosmosDocumentsContainerName
          partitionKey: {
            paths: [
              '/sessionId'
            ]
            kind: 'Hash'
          }
        }
      }
    }
  }
}

resource appServicePlan 'Microsoft.Web/serverfarms@2024-11-01' = {
  name: appServicePlanName
  location: location
  kind: 'linux'
  sku: appServicePlanConfig.sku
  properties: {
    reserved: true
  }
  tags: tags
}

resource webApp 'Microsoft.Web/sites@2024-11-01' = {
  name: webAppName
  location: location
  kind: 'app,linux'
  identity: {
    type: 'UserAssigned'
    userAssignedIdentities: {
      '${webAppIdentity.id}': {}
    }
  }
  properties: {
    serverFarmId: appServicePlan.id
    httpsOnly: true
    siteConfig: {
      linuxFxVersion: 'PYTHON|${pythonVersion}'
      alwaysOn: true
      ftpsState: 'Disabled'
      minTlsVersion: '1.2'
      healthCheckPath: '/api/health'
      appCommandLine: 'bash -c "python -m uvicorn backend.main:app --host 0.0.0.0 --port 8000 --workers $(( ($(nproc)*2)+1 ))"'
    }
  }
  resource configAppSettings 'config' = {
    name: 'appsettings'
    properties: {
      APPLICATIONINSIGHTS_AUTHENTICATION_STRING: 'ClientId=${webAppIdentity.properties.clientId};Authorization=AAD'
      APPLICATIONINSIGHTS_CONNECTION_STRING: applicationInsightsConnectionString
      APPINSIGHTS_INSTRUMENTATIONKEY: applicationInsightsInstrumentationKey
      AZURE_CLIENT_ID: webAppIdentity.properties.clientId
      AZURE_COSMOS_ENDPOINT: cosmosEndpoint
      AZURE_FOUNDRY_API_ENDPOINT: azureOpenAIEndpoint
      AZURE_FOUNDRY_RUNTIME_API_VERSION: azureOpenAIApiVersion
      AZURE_FOUNDRY_CHAT_MODEL_DEPLOYMENT: azureOpenAIDeployment
      CHAT_MAX_MESSAGE_LENGTH: chatMaxMessageLength
      DEPLOY_COMMIT_SHA: deployCommitSha
      PYTHON_APPLICATIONINSIGHTS_ENABLE_TELEMETRY: 'true'
      SCM_DO_BUILD_DURING_DEPLOYMENT: 'true'
      SESSION_UPLOAD_MAX_FILE_COUNT: sessionUploadMaxFileCount
      SESSION_UPLOAD_MAX_FILE_SIZE_BYTES: sessionUploadMaxFileSizeBytes
      SESSION_UPLOAD_SUPPORTED_EXTENSIONS: sessionUploadSupportedExtensions
      UV_NO_EDITABLE: '1'
      AZURE_COSMOS_WEBCHAT_DATABASE_NAME: webchatCosmosDatabaseName
      AZURE_COSMOS_WEBCHAT_DOCUMENTS_CONTAINER_NAME: webchatCosmosDocumentsContainerName
      AZURE_COSMOS_WEBCHAT_MESSAGES_CONTAINER_NAME: webchatCosmosMessagesContainerName
      AZURE_COSMOS_WEBCHAT_SESSIONS_CONTAINER_NAME: webchatCosmosSessionsContainerName
      WEBSITES_PORT: '8000'
    }
  }
  tags: union(tags, { 'azd-service-name': 'webchat' })
}

resource cosmosBuiltInDataContributorRoleDefinition 'Microsoft.DocumentDB/databaseAccounts/sqlRoleDefinitions@2024-05-15' existing = {
  parent: cosmosAccount
  name: cosmosBuiltInDataContributorRoleDefinitionId
}

resource cosmosWebAppContributorRoleAssignment 'Microsoft.DocumentDB/databaseAccounts/sqlRoleAssignments@2024-05-15' = {
  parent: cosmosAccount
  name: guid(cosmosAccount.id, webAppIdentity.id, cosmosBuiltInDataContributorRoleDefinitionId, cosmosDatabaseScope)
  properties: {
    principalId: webAppIdentity.properties.principalId
    roleDefinitionId: cosmosBuiltInDataContributorRoleDefinition.id
    scope: cosmosDatabaseScope
  }
}

resource cosmosDebugUserContributorRoleAssignments 'Microsoft.DocumentDB/databaseAccounts/sqlRoleAssignments@2024-05-15' = [
  for principalId in operationalSupportPrincipalIds: {
    parent: cosmosAccount
    name: guid(cosmosAccount.id, principalId, cosmosBuiltInDataContributorRoleDefinitionId, cosmosDatabaseScope)
    properties: {
      principalId: principalId
      roleDefinitionId: cosmosBuiltInDataContributorRoleDefinition.id
      scope: cosmosDatabaseScope
    }
  }
]

resource roleAssignmentWebAppCognitiveServicesUser 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(subscription().id, azureOpenAI.id, webAppIdentity.id, 'Cognitive Services User')
  scope: azureOpenAI
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', cognitiveServicesUserRoleId)
    principalId: webAppIdentity.properties.principalId
    principalType: 'ServicePrincipal'
  }
}

resource roleAssignmentWebAppOpenAIUser 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(subscription().id, azureOpenAI.id, webAppIdentity.id, 'Cognitive Services OpenAI User')
  scope: azureOpenAI
  properties: {
    roleDefinitionId: subscriptionResourceId(
      'Microsoft.Authorization/roleDefinitions',
      cognitiveServicesOpenAIUserRoleId
    )
    principalId: webAppIdentity.properties.principalId
    principalType: 'ServicePrincipal'
  }
}

resource roleAssignmentDebugCognitiveServicesUser 'Microsoft.Authorization/roleAssignments@2022-04-01' = [
  for principalId in operationalSupportPrincipalIds: {
    name: guid(subscription().id, azureOpenAI.id, principalId, 'Cognitive Services User')
    scope: azureOpenAI
    properties: {
      roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', cognitiveServicesUserRoleId)
      principalId: principalId
    }
  }
]

resource roleAssignmentDebugOpenAIUser 'Microsoft.Authorization/roleAssignments@2022-04-01' = [
  for principalId in operationalSupportPrincipalIds: {
    name: guid(subscription().id, azureOpenAI.id, principalId, 'Cognitive Services OpenAI User')
    scope: azureOpenAI
    properties: {
      roleDefinitionId: subscriptionResourceId(
        'Microsoft.Authorization/roleDefinitions',
        cognitiveServicesOpenAIUserRoleId
      )
      principalId: principalId
    }
  }
]

resource roleAssignmentAppInsights 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(subscription().id, applicationInsights.id, webAppIdentity.id, 'Monitoring Metrics Publisher')
  scope: applicationInsights
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', monitoringMetricsPublisherId)
    principalId: webAppIdentity.properties.principalId
    principalType: 'ServicePrincipal'
  }
}

resource roleAssignmentDebugAppInsights 'Microsoft.Authorization/roleAssignments@2022-04-01' = [
  for principalId in operationalSupportPrincipalIds: {
    name: guid(subscription().id, applicationInsights.id, principalId, 'Monitoring Metrics Publisher')
    scope: applicationInsights
    properties: {
      roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', monitoringMetricsPublisherId)
      principalId: principalId
    }
  }
]

output webAppIdentityClientId string = webAppIdentity.properties.clientId
output webAppEndpoint string = 'https://${webApp.properties.defaultHostName}'
output azureOpenAIEndpoint string = azureOpenAIEndpoint
output cosmosEndpoint string = cosmosEndpoint
