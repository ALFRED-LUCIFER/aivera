// AIV-P0-034: the dev AI resource that @credalent/ai calls (ADR-006, ADR-011). Deployed into Credalent's own resource group
// in UAE North (rg-aivera-ai-dev): Central India offers these models only as provisioned throughput, and Medvya's group
// allows only Indian regions. Pay per token; no keys: the web app signs in with its managed identity. The pilot's sits in
// the pilot's own resource group (AIV-P1-096).
param env string
@description('aivera on dev (its live names), credalent elsewhere: the prefix of every name (main.bicep).')
param brand string
param tags object
param appIdentityPrincipalId string
param aiEvalIdentityPrincipalId string
@description('The AI service\'s identity (AIV-P2-068); empty when the service is not deployed.')
param aiServiceIdentityPrincipalId string = ''

var location = 'uaenorth' // ADR-011: explicit, so a group created elsewhere cannot move the account.
// The subdomain must equal the name: @ai-sdk/azure builds <AZURE_OPENAI_RESOURCE_NAME>.openai.azure.com.
var name = 'ai-${brand}-${env}-${take(uniqueString(resourceGroup().id), 6)}'

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
  // ADR-011: GlobalStandard may run inference outside UAE North, so dev only (synthetic data). The pilot asks for regional
  // Standard, in UAE North; until Azure offers this model there, its apply stops here (docs/runbooks/pilot-environment.md).
  sku: { name: env == 'dev' ? 'GlobalStandard' : 'Standard', capacity: 100 }
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

// Cognitive Services User, for Document Intelligence on this same account (AIV-P1-135): the worker reads CVs and
// documents with prebuilt-layout, which the OpenAI role's data actions do not cover. Scoped to this account only.
// shortcut: the built-in role allows every Cognitive Services data action on the account, and the web app shares the
// identity; narrow to a custom role with the FormRecognizer actions before production (AIV-P5-E03, #34).
var cognitiveServicesUser = subscriptionResourceId('Microsoft.Authorization/roleDefinitions', 'a97b65f3-24c7-4388-baec-2e87135dc908')

resource appCanReadDocuments 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  scope: account
  name: guid(account.id, appIdentityPrincipalId, cognitiveServicesUser)
  properties: {
    roleDefinitionId: cognitiveServicesUser
    principalId: appIdentityPrincipalId
    principalType: 'ServicePrincipal'
  }
}

// The eval harness's live run (AIV-P0-029), with the same role: call deployments, nothing else. Dev only (foundation.bicep).
resource evalCanCall 'Microsoft.Authorization/roleAssignments@2022-04-01' = if (!empty(aiEvalIdentityPrincipalId)) {
  scope: account
  name: guid(account.id, aiEvalIdentityPrincipalId, openAiUser)
  properties: {
    roleDefinitionId: openAiUser
    principalId: aiEvalIdentityPrincipalId
    principalType: 'ServicePrincipal'
  }
}

// The AI service (AIV-P2-068, ADR-015), with the same role: call deployments, nothing else.
resource aiServiceCanCall 'Microsoft.Authorization/roleAssignments@2022-04-01' = if (!empty(aiServiceIdentityPrincipalId)) {
  scope: account
  name: guid(account.id, aiServiceIdentityPrincipalId, openAiUser)
  properties: {
    roleDefinitionId: openAiUser
    principalId: aiServiceIdentityPrincipalId
    principalType: 'ServicePrincipal'
  }
}

output resourceName string = account.name
