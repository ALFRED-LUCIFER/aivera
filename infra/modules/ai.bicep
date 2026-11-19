// AIV-P0-034: the dev AI resource that @aivera/ai calls (ADR-006, ADR-011). Deployed into Aivera's own resource group
// in UAE North (rg-aivera-ai-dev): Central India offers these models only as provisioned throughput, and Medvya's group
// allows only Indian regions. Pay per token; no keys: the web app signs in with its managed identity.
param tags object
param appIdentityPrincipalId string

var location = 'uaenorth' // ADR-011: explicit, so a group created elsewhere cannot move the account.
// The subdomain must equal the name: @ai-sdk/azure builds <AZURE_OPENAI_RESOURCE_NAME>.openai.azure.com.
var name = 'ai-aivera-dev-${take(uniqueString(resourceGroup().id), 6)}'

resource account 'Microsoft.CognitiveServices/accounts@2024-10-01' = {
  name: name
  location: location
  tags: tags
  kind: 'AIServices'
  sku: { name: 'S0' }
  properties: {
    customSubDomainName: name // Entra sign-in needs a custom subdomain.
    disableLocalAuth: true
    publicNetworkAccess: 'Enabled'
  }
}

// Capacity is thousands of tokens per minute and costs nothing on (Global) Standard: tokens are billed. A rubric draft
// reserves prompt + 4,000 output tokens against it. Quota on 19 Nov 2026: 200 (gpt-4.1-mini), 350 (embedding).
// shortcut: NoAutoUpgrade pins the model for evals; the deployment stops when Azure retires the version, recheck then.
resource gptMain 'Microsoft.CognitiveServices/accounts/deployments@2024-10-01' = {
  parent: account
  name: 'gpt-main'
  // ADR-011: GlobalStandard may run inference outside UAE North. Dev holds synthetic data only.
  sku: { name: 'GlobalStandard', capacity: 100 }
  properties: {
    model: { format: 'OpenAI', name: 'gpt-4.1-mini', version: '2025-04-14' }
    versionUpgradeOption: 'NoAutoUpgrade'
  }
}

resource embeddingMain 'Microsoft.CognitiveServices/accounts/deployments@2024-10-01' = {
  parent: account
  name: 'embedding-main'
  sku: { name: 'Standard', capacity: 100 }
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
