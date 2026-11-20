// Credalent dev environment (epic AIV-P0-E02). Deployed into Medvya's dev resource group, Central India (ADR-008):
//   az deployment group create -g rg-medvya-dev-in -n aivera-dev --mode Incremental -f infra/main.bicep -p imageTag=<sha> alertEmail=<team address>
// Owner only (infra/README.md). Never --mode Complete: the resource group is Medvya's, and Complete deletes everything
// this template does not declare.
targetScope = 'resourceGroup'

@description('GitHub repository allowed to deploy with OIDC from main.')
param githubRepo string = 'ALFRED-LUCIFER/aivera'

@description('GitHub now puts immutable ids in the OIDC subject: owner@ownerId/repo@repoId. Must match exactly or azure/login fails with AADSTS700213.')
param githubOidcRepo string = 'ALFRED-LUCIFER@95878204/aivera@1462479700'

@description('Email address of the team that receives dev alerts (AIV-P0-018). Not a candidate\'s address.')
param alertEmail string

@description('Commit SHA tag of the images on ghcr.io to run. Pass the one running now so a redeploy changes nothing.')
param imageTag string

@description('Candidate app registration (client) id; empty keeps candidate sign-in off (docs/runbooks/candidate-sign-in.md).')
param entraCandidateClientId string = ''
@description('Google OAuth client id for recruiter "Continue with Google" (AIV-P0-928); empty keeps the Google button hidden.')
param googleClientId string = ''

var location = resourceGroup().location
var tags = { product: 'aivera', env: 'dev', data: 'synthetic' }
var images = 'ghcr.io/${toLower(githubRepo)}'
// Credalent's own group in UAE North for the AI resource (ADR-011): Medvya's group allows Indian regions only.
var aiResourceGroup = 'rg-aivera-ai-dev'

// Shared Medvya dev resources, referenced with `existing` and never changed.
var shared = {
  logAnalytics: 'log-medvya-dev-3afs7i'
  postgresServer: 'psql-medvya-dev-3afs7i'
  vnet: 'vnet-medvya-dev-3afs7i'
}

module foundation 'modules/foundation.bicep' = {
  name: 'aivera-foundation'
  params: {
    location: location
    tags: tags
    logAnalyticsName: shared.logAnalytics
    githubOidcRepo: githubOidcRepo
  }
}

// Credalent's external environment on a new subnet of Medvya's VNet (10.20.5.0/27 is free: Medvya uses 10.20.1.0/24,
// 10.20.2.0/24 and 10.20.4.0/27 of 10.20.0.0/16, checked 18 Nov 2026). /27 is the minimum for a consumption environment.
module environment 'modules/environment.bicep' = {
  name: 'aivera-environment'
  params: {
    location: location
    tags: tags
    vnetName: shared.vnet
    subnetPrefix: '10.20.5.0/27'
    logAnalyticsName: shared.logAnalytics
  }
}

module database 'modules/database.bicep' = {
  name: 'aivera-database'
  params: {
    location: location
    tags: tags
    postgresServerName: shared.postgresServer
    containerAppsEnvName: environment.outputs.environmentName
    cicdIdentityId: foundation.outputs.cicdIdentityId
    cicdIdentityClientId: foundation.outputs.cicdIdentityClientId
    migrateImage: '${images}/migrate:${imageTag}'
  }
}

module ai 'modules/ai.bicep' = {
  name: 'aivera-ai'
  scope: resourceGroup(aiResourceGroup)
  params: {
    tags: tags
    appIdentityPrincipalId: foundation.outputs.appIdentityPrincipalId
    aiEvalIdentityPrincipalId: foundation.outputs.aiEvalIdentityPrincipalId
  }
}

module web 'modules/web.bicep' = {
  name: 'aivera-web'
  params: {
    location: location
    tags: tags
    containerAppsEnvName: environment.outputs.environmentName
    appIdentityId: foundation.outputs.appIdentityId
    appIdentityClientId: foundation.outputs.appIdentityClientId
    appInsightsSecretUri: foundation.outputs.appInsightsSecretUri
    keyVaultUri: foundation.outputs.keyVaultUri
    databaseHost: database.outputs.databaseHost
    databaseName: database.outputs.databaseName
    webImage: '${images}/web:${imageTag}'
    aiResourceName: ai.outputs.resourceName
    commitSha: imageTag
    entraCandidateClientId: entraCandidateClientId
    googleClientId: googleClientId
  }
}

// Service Bus and the outbox relay's identity (AIV-P0-014).
module messaging 'modules/messaging.bicep' = {
  name: 'aivera-messaging'
  params: {
    location: location
    tags: tags
    appIdentityPrincipalId: foundation.outputs.appIdentityPrincipalId
  }
}

// Read for the Event Grid webhook URL key only; foundation.bicep creates the vault with this name.
resource vault 'Microsoft.KeyVault/vaults@2023-07-01' existing = {
  name: 'kv-aivera-dev-${take(uniqueString(resourceGroup().id), 6)}'
}

// Email through ACS and its delivery reports (AIV-P0-017).
module communication 'modules/communication.bicep' = {
  name: 'aivera-communication'
  params: {
    tags: tags
    appIdentityPrincipalId: foundation.outputs.appIdentityPrincipalId
    webFqdn: web.outputs.webFqdn
    webhookKey: vault.getSecret('acs-webhook-key')
  }
}

// The worker host: outbox relay and queue consumers (AIV-P0-015).
module worker 'modules/worker.bicep' = {
  name: 'aivera-worker'
  params: {
    location: location
    tags: tags
    containerAppsEnvName: environment.outputs.environmentName
    appIdentityId: foundation.outputs.appIdentityId
    appIdentityClientId: foundation.outputs.appIdentityClientId
    relayIdentityId: messaging.outputs.relayIdentityId
    relayIdentityClientId: messaging.outputs.relayIdentityClientId
    appInsightsSecretUri: foundation.outputs.appInsightsSecretUri
    databaseHost: database.outputs.databaseHost
    databaseName: database.outputs.databaseName
    serviceBusNamespace: messaging.outputs.serviceBusNamespace
    workerImage: '${images}/worker:${imageTag}'
    keyVaultUri: foundation.outputs.keyVaultUri
    acsEndpoint: communication.outputs.endpoint
    emailSender: communication.outputs.senderAddress
  }
}

module alerts 'modules/alerts.bicep' = {
  name: 'aivera-alerts'
  params: {
    tags: tags
    appInsightsId: foundation.outputs.appInsightsId
    alertEmail: alertEmail
    serviceBusNamespaceId: messaging.outputs.namespaceId
  }
}

module deployAccess 'modules/deploy-access.bicep' = {
  name: 'aivera-deploy-access'
  params: {
    cicdPrincipalId: foundation.outputs.cicdIdentityPrincipalId
    containerAppsEnvName: environment.outputs.environmentName
  }
  dependsOn: [database, web, worker, messaging]
}

output webFqdn string = web.outputs.webFqdn
output appIdentityClientId string = foundation.outputs.appIdentityClientId
output cicdIdentityClientId string = foundation.outputs.cicdIdentityClientId
output keyVaultName string = foundation.outputs.keyVaultName
output aiResourceName string = ai.outputs.resourceName
output relayIdentityClientId string = messaging.outputs.relayIdentityClientId
output serviceBusNamespace string = messaging.outputs.serviceBusNamespace
output aiEvalIdentityClientId string = foundation.outputs.aiEvalIdentityClientId
