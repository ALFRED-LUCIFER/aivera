// Credalent dev environment (epic AIV-P0-E02). Deployed into Medvya's dev resource group, Central India (ADR-008):
//   az deployment group create -g rg-medvya-dev-in -n aivera-dev --mode Incremental -f infra/main.bicep -p imageTag=<sha> alertEmail=<team address>
// Owner only (infra/README.md). Never --mode Complete: the resource group is Medvya's, and Complete deletes everything
// this template does not declare.
// The pilot (AIV-P1-096) is the same template with infra/pilot.bicepparam, in its own resource group in UAE North, with
// its own Log Analytics, VNet and PostgreSQL server (modules/network.bicep): docs/runbooks/pilot-environment.md.
targetScope = 'resourceGroup'

@description('dev or pilot: the suffix of every resource name. Only dev borrows Medvya\'s resources and holds synthetic data.')
@allowed(['dev', 'pilot'])
param env string = 'dev'

@description('Region of every regional resource. The pilot sets uaenorth (AGENTS.md 1.10); dev uses its resource group\'s.')
param location string = resourceGroup().location

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
@description('Defender for Storage malware scanning on uploads (AIV-P0-016). Off in dev because of its cost (owner, 20 Nov 2026); the pilot and production set it true.')
param malwareScanning bool = false

// The External ID tenant and recruiter app registration the web app signs in with (not secrets). Defaults are dev's.
param entraTenantSubdomain string = 'aiveradev'
param entraTenantId string = '88c795fc-1018-45f7-8904-75e1c2991b8f'
param entraRecruiterClientId string = '463fb57b-570d-4384-b914-1078df012bd8'

// Pilot only (modules/network.bicep): dev uses Medvya's VNet and server.
@description('Address space of the pilot\'s own VNet.')
param vnetPrefix string = ''
@description('The pilot PostgreSQL server\'s Burstable size.')
param postgresSku string = 'Standard_B1ms'
@description('Days of the pilot server\'s in-region point-in-time backups.')
param backupRetentionDays int = 7

var dev = env == 'dev'
// Dev keeps its live "aivera" names (renaming recreates them); everything new is named after the product (AIV-P0-035).
var brand = dev ? 'aivera' : 'credalent'
var suffix = take(uniqueString(resourceGroup().id), 6)
var tags = { product: brand, env: env, data: dev ? 'synthetic' : 'personal' }
// Key Vault names stop at 24 characters: dev's is 20, the pilot's is cut to 24.
var keyVaultName = take('kv-${brand}-${env}-${suffix}', 24)
var images = 'ghcr.io/${toLower(githubRepo)}'
// Dev: Credalent's own group in UAE North for the AI resource (ADR-011), since Medvya's group allows Indian regions only.
var aiResourceGroup = dev ? 'rg-aivera-ai-dev' : resourceGroup().name
// Uploads (AIV-P0-016): named here so the web app gets the endpoint and the account gets the web app's origin.
var storageName = 'stcredalent${env}${suffix}'
var blobUrl = 'https://${storageName}.blob.${az.environment().suffixes.storage}'

// Dev: shared Medvya dev resources, referenced with `existing` and never changed. Pilot: its own, from modules/network.bicep.
var shared = {
  logAnalytics: dev ? 'log-medvya-dev-3afs7i' : 'log-${brand}-${env}'
  postgresServer: dev ? 'psql-medvya-dev-3afs7i' : 'psql-${brand}-${env}-${suffix}'
  vnet: dev ? 'vnet-medvya-dev-3afs7i' : 'vnet-${brand}-${env}'
}

module network 'modules/network.bicep' = if (!dev) {
  name: '${brand}-network'
  params: {
    location: location
    tags: tags
    env: env
    brand: brand
    logAnalyticsName: shared.logAnalytics
    vnetName: shared.vnet
    vnetPrefix: vnetPrefix
    postgresServerName: shared.postgresServer
    postgresSku: postgresSku
    backupRetentionDays: backupRetentionDays
  }
}

module foundation 'modules/foundation.bicep' = {
  name: '${brand}-foundation'
  params: {
    env: env
    brand: brand
    location: location
    tags: tags
    logAnalyticsName: shared.logAnalytics
    githubOidcRepo: githubOidcRepo
    keyVaultName: keyVaultName
  }
  dependsOn: [network]
}

// Credalent's external environment on a new subnet of Medvya's VNet (10.20.5.0/27 is free: Medvya uses 10.20.1.0/24,
// 10.20.2.0/24 and 10.20.4.0/27 of 10.20.0.0/16, checked 18 Nov 2026). /27 is the minimum for a consumption environment.
// The pilot's VNet declares its subnet itself.
module environment 'modules/environment.bicep' = {
  name: '${brand}-environment'
  params: {
    env: env
    brand: brand
    location: location
    tags: tags
    vnetName: shared.vnet
    subnetPrefix: dev ? '10.20.5.0/27' : ''
    logAnalyticsName: shared.logAnalytics
  }
  dependsOn: [network]
}

module database 'modules/database.bicep' = {
  name: '${brand}-database'
  params: {
    env: env
    brand: brand
    location: location
    tags: tags
    postgresServerName: shared.postgresServer
    containerAppsEnvName: environment.outputs.environmentName
    cicdIdentityId: foundation.outputs.cicdIdentityId
    cicdIdentityClientId: foundation.outputs.cicdIdentityClientId
    migrateImage: '${images}/migrate:${imageTag}'
  }
  dependsOn: [network] // the server: referenced by name only
}

module ai 'modules/ai.bicep' = {
  name: '${brand}-ai'
  scope: resourceGroup(aiResourceGroup)
  params: {
    env: env
    brand: brand
    tags: tags
    appIdentityPrincipalId: foundation.outputs.appIdentityPrincipalId
    aiEvalIdentityPrincipalId: foundation.outputs.aiEvalIdentityPrincipalId
  }
}

module web 'modules/web.bicep' = {
  name: '${brand}-web'
  params: {
    env: env
    brand: brand
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
    entraTenantSubdomain: entraTenantSubdomain
    entraTenantId: entraTenantId
    entraRecruiterClientId: entraRecruiterClientId
    entraCandidateClientId: entraCandidateClientId
    googleClientId: googleClientId
    blobUrl: blobUrl
    malwareScanning: malwareScanning
  }
}

// Service Bus and the outbox relay's identity (AIV-P0-014).
module messaging 'modules/messaging.bicep' = {
  name: '${brand}-messaging'
  params: {
    env: env
    brand: brand
    location: location
    tags: tags
    appIdentityPrincipalId: foundation.outputs.appIdentityPrincipalId
  }
}

// Read for the Event Grid webhook URL key only; foundation.bicep creates the vault with this name.
resource vault 'Microsoft.KeyVault/vaults@2023-07-01' existing = {
  name: keyVaultName
}

// Email through ACS and its delivery reports (AIV-P0-017).
module communication 'modules/communication.bicep' = {
  name: '${brand}-communication'
  params: {
    env: env
    brand: brand
    tags: tags
    appIdentityPrincipalId: foundation.outputs.appIdentityPrincipalId
    webFqdn: web.outputs.webFqdn
    webhookKey: vault.getSecret('acs-webhook-key')
  }
}

// Blob storage for uploads, and malware scanning when on (AIV-P0-016).
module storage 'modules/storage.bicep' = {
  name: 'credalent-storage'
  params: {
    env: env
    location: location
    tags: tags
    storageName: storageName
    webFqdn: web.outputs.webFqdn
    appIdentityPrincipalId: foundation.outputs.appIdentityPrincipalId
    malwareScanning: malwareScanning
    serviceBusNamespaceName: split(messaging.outputs.serviceBusNamespace, '.')[0]
  }
}

// The worker host: outbox relay and queue consumers (AIV-P0-015).
module worker 'modules/worker.bicep' = {
  name: '${brand}-worker'
  params: {
    env: env
    brand: brand
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
    blobUrl: blobUrl
    malwareScanning: malwareScanning
    aiResourceName: ai.outputs.resourceName
  }
}

module alerts 'modules/alerts.bicep' = {
  name: '${brand}-alerts'
  params: {
    env: env
    brand: brand
    location: location
    tags: tags
    appInsightsId: foundation.outputs.appInsightsId
    alertEmail: alertEmail
    serviceBusNamespaceId: messaging.outputs.namespaceId
  }
}

module deployAccess 'modules/deploy-access.bicep' = {
  name: '${brand}-deploy-access'
  params: {
    env: env
    brand: brand
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
output storageAccountName string = storage.outputs.accountName
output postgresServerName string = shared.postgresServer
