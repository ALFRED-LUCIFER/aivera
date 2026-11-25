// AIV-P0-015: the worker host in Credalent's environment: the outbox relay and the queue consumers (apps/backend/worker).
// No ingress; the probes reach its internal port. Two identities: id-aivera-dev (aivera_app, Service Bus receive)
// and id-aivera-relay-dev (aivera_relay, Service Bus send).
// shortcut: one replica always on, because the relay polls the outbox every second (smallest size, about $5 to $10 a
// month beyond the free grant); move the relay to PostgreSQL LISTEN/NOTIFY or a KEDA-scaled job if cost matters (AIV-P5-E03, #34)
param env string
@description('aivera on dev (its live names), credalent elsewhere: the prefix of every name (main.bicep).')
param brand string
param location string
param tags object
param containerAppsEnvName string
param appIdentityId string
param appIdentityClientId string
param relayIdentityId string
param relayIdentityClientId string
param appInsightsSecretUri string
param databaseHost string
param databaseName string
param serviceBusNamespace string
param workerImage string
@description('Credalent Key Vault URI (ends with a slash): notifications-encryption-key must exist before an apply.')
param keyVaultUri string
param acsEndpoint string
param emailSender string
@description('The uploads storage account\'s blob endpoint (modules/storage.bicep, AIV-P0-016).')
param blobUrl string
@description('Whether Defender scans uploads; off in dev only (owner, 20 Nov 2026).')
param malwareScanning bool
@description('The AI Foundry resource evidence mapping calls with the app identity (modules/ai.bicep, AIV-P1-027).')
param aiResourceName string
@description('The GitHub App that reads public repositories (AIV-P1-074, #406). Empty until the owner creates it and writes github-app-private-key to the vault: repository reads stay queued.')
param githubAppId string = ''
@description('The GitHub App installation id: the number at the end of https://github.com/settings/installations/<id>.')
param githubAppInstallationId string = ''

// GitHub repository reads (AIV-P1-074): added only once the app exists, because a secret reference to a missing vault
// secret fails the apply. Both ids or neither: with one set, none of the three settings is added.
var githubApp = !empty(githubAppId) && !empty(githubAppInstallationId)
var githubSecrets = githubApp
  ? [{ name: 'github-app-private-key', keyVaultUrl: '${keyVaultUri}secrets/github-app-private-key', identity: appIdentityId }]
  : []
var githubEnv = githubApp
  ? [
      { name: 'GITHUB_APP_ID', value: githubAppId }
      { name: 'GITHUB_APP_INSTALLATION_ID', value: githubAppInstallationId }
      { name: 'GITHUB_APP_PRIVATE_KEY', secretRef: 'github-app-private-key' }
    ]
  : []

resource environment 'Microsoft.App/managedEnvironments@2024-03-01' existing = {
  name: containerAppsEnvName
}

var probe = { port: 8080, scheme: 'HTTP' }
var database = '${databaseHost}:5432/${databaseName}?sslmode=verify-full'

resource worker 'Microsoft.App/containerApps@2024-03-01' = {
  name: 'ca-${brand}-worker-${env}'
  location: location
  tags: tags
  identity: {
    type: 'UserAssigned'
    userAssignedIdentities: { '${appIdentityId}': {}, '${relayIdentityId}': {} }
  }
  properties: {
    environmentId: environment.id
    workloadProfileName: 'Consumption'
    configuration: {
      activeRevisionsMode: 'Single'
      secrets: concat([
        { name: 'appinsights-connection-string', keyVaultUrl: appInsightsSecretUri, identity: appIdentityId }
        // The send log's column key (AIV-P0-017): the worker opens what the web app sealed.
        {
          name: 'notifications-encryption-key'
          keyVaultUrl: '${keyVaultUri}secrets/notifications-encryption-key'
          identity: appIdentityId
        }
      ], githubSecrets)
    }
    template: {
      containers: [
        {
          name: 'worker'
          image: workerImage
          env: concat([
            // No passwords: packages/db signs in with each identity's Entra token.
            { name: 'DATABASE_URL', value: 'postgres://aivera_app@${database}' }
            { name: 'RELAY_DATABASE_URL', value: 'postgres://aivera_relay@${database}' }
            { name: 'AZURE_CLIENT_ID', value: appIdentityClientId }
            { name: 'RELAY_CLIENT_ID', value: relayIdentityClientId }
            { name: 'AZURE_SERVICE_BUS_NAMESPACE', value: serviceBusNamespace }
            { name: 'APPLICATIONINSIGHTS_CONNECTION_STRING', secretRef: 'appinsights-connection-string' }
            { name: 'ACS_ENDPOINT', value: acsEndpoint }
            { name: 'EMAIL_SENDER', value: emailSender }
            { name: 'NOTIFICATIONS_ENCRYPTION_KEY', secretRef: 'notifications-encryption-key' }
            // Uploads (AIV-P0-016). With scanning off the web app settles uploads itself after re-checking the blob.
            { name: 'AZURE_STORAGE_BLOB_URL', value: blobUrl }
            { name: 'MALWARE_SCANNING', value: malwareScanning ? 'on' : 'off' }
            { name: 'AZURE_OPENAI_RESOURCE_NAME', value: aiResourceName }
            // CV parses, document reads and link reads (AIV-P1-135): Document Intelligence on the same AI resource, signed
            // in with the app identity (modules/ai.bicep). Without it the worker leaves those events in the outbox.
            {
              name: 'AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT'
              value: 'https://${aiResourceName}.cognitiveservices.azure.com'
            }
            // The catalogue draft eval (AIV-P2-048): on with the `jobs` queue this same apply creates (modules/messaging.bicep).
            { name: 'CATALOGUE_EVAL', value: 'on' }
          ], githubEnv)
          resources: { cpu: json('0.25'), memory: '0.5Gi' }
          probes: [
            { type: 'Liveness', httpGet: union(probe, { path: '/health' }), periodSeconds: 30 }
            { type: 'Readiness', httpGet: union(probe, { path: '/ready' }), periodSeconds: 10, timeoutSeconds: 3 }
          ]
        }
      ]
      // Container Apps sends SIGTERM and waits this long before SIGKILL: room for a handler to finish (AIV-P0-015).
      terminationGracePeriodSeconds: 60
      scale: { minReplicas: 1, maxReplicas: 1 }
    }
  }
}
