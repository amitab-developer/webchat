@description('Name of the Azure AI Foundry/OpenAI-compatible account.')
param azureOpenAIAccountName string

@description('Name of the model deployment.')
param deploymentName string

@description('Model name to deploy.')
param modelName string

@description('Model version to deploy. Leave empty to use the service default.')
param modelVersion string = ''

@description('Deployment SKU name.')
param deploymentSkuName string = 'GlobalStandard'

@description('Deployment capacity.')
param deploymentCapacity int = 1

resource azureOpenAI 'Microsoft.CognitiveServices/accounts@2025-06-01' existing = {
  name: azureOpenAIAccountName
}

resource deployment 'Microsoft.CognitiveServices/accounts/deployments@2025-06-01' = {
  parent: azureOpenAI
  name: deploymentName
  sku: {
    name: deploymentSkuName
    capacity: deploymentCapacity
  }
  properties: {
    model: union({
      format: 'OpenAI'
      name: modelName
    }, empty(modelVersion) ? {} : {
      version: modelVersion
    })
  }
}
