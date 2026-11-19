// AIV-P0-034: the dev AI resource that @aivera/ai calls (ADR-006, ADR-011). UAE North, because Central India offers
// these models only as provisioned throughput. Pay per token; no keys: the web app signs in with its managed identity.
param tags object
param appIdentityPrincipalId string

// Not the resource group's region: see ADR-011.
var location = 'uaenorth'

resource account 'Microsoft.CognitiveServices/accounts@2024-10-01' = {
  name: 'ai-aivera-dev-${take(uniqueString(resourceGroup().id), 6)}'
  location: location
  tags: tags
  kind: 'AIServices'
  sku: { name: 'S0' }
  properties: {
    // The subdomain makes <name>.openai.azure.com, which @ai-sdk/azure calls and Entra sign-in needs.
    customSubDomainName: 'ai-aivera-dev-${take(uniqueString(resourceGroup().id), 6)}'
    disableLocalAuth: true
    publicNetworkAccess: 'Enabled'
  }
}

// Capacity is thousands of tokens per minute; dev volume is tiny.
resource gptMain 'Microsoft.CognitiveServices/accounts/deployments@2024-10-01' = {
  parent: account
  name: 'gpt-main'
  // ADR-011: GlobalStandard may run inference outside UAE North. Dev holds synthetic data only.
  sku: { name: 'GlobalStandard', capacity: 10 }
  properties: {
    model: { format: 'OpenAI', name: 'gpt-4.1-mini', version: '2025-04-14' }
    versionUpgradeOption: 'NoAutoUpgrade'
  }
}

resource embeddingMain 'Microsoft.CognitiveServices/accounts/deployments@2024-10-01' = {
  parent: account
  name: 'embedding-main'
  sku: { name: 'Standard', capacity: 10 }
  properties: {
    model: { format: 'OpenAI', name: 'text-embedding-3-large', version: '1' }
    versionUpgradeOption: 'NoAutoUpgrade'
  }
  dependsOn: [gptMain] // Azure rejects concurrent deployment writes on one account.
}

// Cognitive Services OpenAI User: call deployments, nothing else. Scoped to this account only.
var openAiUser = subscriptionResourceId('Microsoft.Authorization/roleDefinitions', '5e0bd9bd-7b93-4f28-af87-19fc36ad61bd')

resource appCanCall 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  scope: account
  name: guid(account.id, appIdentityPrincipalId, openAiUser)
  properties: {
    roleDefinitionId: openAiUser
    principalId: appIdentityPrincipalId
    principalType: 'ServicePrincipal'
  }
}

output resourceName string = account.name
