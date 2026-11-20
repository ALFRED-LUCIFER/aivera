// AIV-P0-015: the worker host in Credalent's environment: the outbox relay and the queue consumers (apps/worker).
// No ingress; the probes reach its internal port. Two identities: id-aivera-dev (aivera_app, Service Bus receive)
// and id-aivera-relay-dev (aivera_relay, Service Bus send).
// shortcut: one replica always on, because the relay polls the outbox every second (smallest size, about $5 to $10 a
// month beyond the free grant); move the relay to PostgreSQL LISTEN/NOTIFY or a KEDA-scaled job if cost matters (AIV-P5-E03, #34)
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

resource environment 'Microsoft.App/managedEnvironments@2024-03-01' existing = {
  name: containerAppsEnvName
}

var probe = { port: 8080, scheme: 'HTTP' }
var database = '${databaseHost}:5432/${databaseName}?sslmode=verify-full'

resource worker 'Microsoft.App/containerApps@2024-03-01' = {
  name: 'ca-aivera-worker-dev'
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
      secrets: [
        { name: 'appinsights-connection-string', keyVaultUrl: appInsightsSecretUri, identity: appIdentityId }
        // The send log's column key (AIV-P0-017): the worker opens what the web app sealed.
        {
          name: 'notifications-encryption-key'
          keyVaultUrl: '${keyVaultUri}secrets/notifications-encryption-key'
          identity: appIdentityId
        }
      ]
    }
    template: {
      containers: [
        {
          name: 'worker'
          image: workerImage
          env: [
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
          ]
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
