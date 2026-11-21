// AIV-P0-003: Credalent's own identities, Key Vault and Application Insights inside the shared Medvya dev resource group
// (ADR-008). Log Analytics is Medvya's workspace, referenced, not created (the pilot's own: modules/network.bicep).
param env string
param location string
param tags object
param logAnalyticsName string
param githubOidcRepo string

// Web and worker. Reads Credalent's Key Vault; signs in to PostgreSQL as aivera_app (no DDL, row-level security applies).
resource appIdentity 'Microsoft.ManagedIdentity/userAssignedIdentities@2023-01-31' = {
  name: 'id-aivera-${env}'
  location: location
  tags: tags
}

// GitHub Actions (OIDC, no stored secret) and the migration job. Signs in to PostgreSQL as aivera_migrator.
// Kept apart from the app identity: a compromised web app must never be able to run DDL or bypass RLS.
resource cicdIdentity 'Microsoft.ManagedIdentity/userAssignedIdentities@2023-01-31' = {
  name: 'id-aivera-cicd-${env}'
  location: location
  tags: tags

  // Dev trusts main (deploy-dev.yml); the pilot trusts only the owner-approved "pilot" environment (deploy-pilot.yml).
  resource github 'federatedIdentityCredentials' = {
    name: env == 'dev' ? 'github-main' : 'github-${env}'
    properties: {
      issuer: 'https://token.actions.githubusercontent.com'
      subject: env == 'dev' ? 'repo:${githubOidcRepo}:ref:refs/heads/main' : 'repo:${githubOidcRepo}:environment:${env}'
      audiences: ['api://AzureADTokenExchange']
    }
  }
}

// GitHub Actions' ai-eval-live job (AIV-P0-029): may call the dev AI deployments and nothing else (ai.bicep). Trusts the
// "ai-eval" environment only, so a pull request never gets the deploy identity, and this one cannot deploy.
// Dev only: evals never call the pilot's AI.
resource aiEvalIdentity 'Microsoft.ManagedIdentity/userAssignedIdentities@2023-01-31' = if (env == 'dev') {
  name: 'id-aivera-ai-eval-${env}'
  location: location
  tags: tags

  resource github 'federatedIdentityCredentials' = if (env == 'dev') {
    name: 'github-ai-eval'
    properties: {
      issuer: 'https://token.actions.githubusercontent.com'
      subject: 'repo:${githubOidcRepo}:environment:ai-eval'
      audiences: ['api://AzureADTokenExchange']
    }
  }
}

resource keyVault 'Microsoft.KeyVault/vaults@2023-07-01' = {
  name: 'kv-aivera-${env}-${take(uniqueString(resourceGroup().id), 6)}'
  location: location
  tags: tags
  properties: {
    tenantId: tenant().tenantId
    sku: { family: 'A', name: 'standard' }
    enableRbacAuthorization: true
    enableSoftDelete: true
    softDeleteRetentionInDays: 7
    enablePurgeProtection: true
    // main.bicep reads acs-webhook-key with getSecret (AIV-P0-017); ARM may only fetch it with this on. Readers still need RBAC.
    enabledForTemplateDeployment: true
    // shortcut: public endpoint with RBAC only (a private endpoint is about $7/month), add one in AIV-P5-E03 (#34).
    publicNetworkAccess: 'Enabled'
  }
}

var keyVaultSecretsUser = subscriptionResourceId(
  'Microsoft.Authorization/roleDefinitions',
  '4633458b-17de-408a-b874-0445c86b69e6'
)

// Vault scope is Credalent-only: this vault holds nothing of Medvya's.
resource appReadsSecrets 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(keyVault.id, appIdentity.id, keyVaultSecretsUser)
  scope: keyVault
  properties: {
    roleDefinitionId: keyVaultSecretsUser
    principalId: appIdentity.properties.principalId
    principalType: 'ServicePrincipal'
  }
}

resource logAnalytics 'Microsoft.OperationalInsights/workspaces@2023-09-01' existing = {
  name: logAnalyticsName
}

resource appInsights 'Microsoft.Insights/components@2020-02-02' = {
  name: 'appi-aivera-${env}'
  location: location
  tags: tags
  kind: 'web'
  properties: {
    Application_Type: 'web'
    WorkspaceResourceId: logAnalytics.id
  }
}

resource appInsightsSecret 'Microsoft.KeyVault/vaults/secrets@2023-07-01' = {
  parent: keyVault
  name: 'applicationinsights-connection-string'
  properties: { value: appInsights.properties.ConnectionString }
}

output appIdentityId string = appIdentity.id
output appIdentityClientId string = appIdentity.properties.clientId
output appIdentityPrincipalId string = appIdentity.properties.principalId
output cicdIdentityId string = cicdIdentity.id
output cicdIdentityClientId string = cicdIdentity.properties.clientId
output cicdIdentityPrincipalId string = cicdIdentity.properties.principalId
output aiEvalIdentityClientId string = env == 'dev' ? aiEvalIdentity!.properties.clientId : ''
output aiEvalIdentityPrincipalId string = env == 'dev' ? aiEvalIdentity!.properties.principalId : ''
output keyVaultName string = keyVault.name
output keyVaultUri string = keyVault.properties.vaultUri
output appInsightsId string = appInsights.id
output appInsightsSecretUri string = appInsightsSecret.properties.secretUri
