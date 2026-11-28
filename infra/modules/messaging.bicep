// AIV-P0-014: Service Bus for the transactional outbox, and the relay's own identity (ADR-008: synthetic data only).
// AIV-P0-015: the app identity receives for the worker's consumers.
// shortcut: Basic tier (pay per operation, no base fee) has no duplicate detection; a resend after a relay crash
// (between send and commit) is dropped by the consumer's inbox on the message id (AIV-P0-015). Move to Standard and set
// requiresDuplicateDetection on each queue for the pilot (AIV-P5-E03, #34), or earlier if a consumer needs topics.
param env string
@description('aivera on dev (its live names), credalent elsewhere: the prefix of every name (main.bicep).')
param brand string
param location string
param tags object
@description('The app identity (id-aivera-dev): the worker consumers receive with it (AIV-P0-015).')
param appIdentityPrincipalId string

// The outbox relay signs in to PostgreSQL as aivera_relay (infra/sql/bootstrap-roles.sql) and sends to Service Bus.
// Its own identity: aivera_relay reads every workspace's outbox, which neither the web app nor the consumers may.
resource relayIdentity 'Microsoft.ManagedIdentity/userAssignedIdentities@2023-01-31' = {
  name: 'id-${brand}-relay-${env}'
  location: location
  tags: tags
}

resource namespace 'Microsoft.ServiceBus/namespaces@2024-01-01' = {
  name: 'sb-${brand}-${env}-${take(uniqueString(resourceGroup().id), 6)}'
  location: location
  tags: tags
  sku: { name: 'Basic', tier: 'Basic' }
  properties: {
    // Entra sign-in only: no shared access keys exist to leak.
    disableLocalAuth: true
    minimumTlsVersion: '1.2'
    // shortcut: public endpoint with Entra RBAC only; private endpoints need Premium, revisit for the pilot (AIV-P5-E03, #34)
    publicNetworkAccess: 'Enabled'
  }
}

// One queue per consuming module; the worker maps each event type to one (apps/backend/worker/src/main.ts).
// `candidates` takes the events nothing handles yet; the worker completes each on arrival (AIV-P1-165).
var queues = ['assessment', 'candidates', 'evidence', 'jobs', 'notifications']

resource queue 'Microsoft.ServiceBus/namespaces/queues@2024-01-01' = [
  for name in queues: {
    parent: namespace
    name: name
    properties: {
      // Basic allows at most 14 days; an unhandled event dead-letters instead of vanishing.
      defaultMessageTimeToLive: 'P14D'
      deadLetteringOnMessageExpiration: true
      // The worker host dead-letters after 10 deliveries (AIV-P0-015).
      maxDeliveryCount: 10
      lockDuration: 'PT1M'
    }
  }
]

var dataSender = subscriptionResourceId('Microsoft.Authorization/roleDefinitions', '69a216fc-b8fb-44d8-bc22-1f3c2cd27a39')

resource relaySends 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(namespace.id, relayIdentity.id, dataSender)
  scope: namespace
  properties: {
    roleDefinitionId: dataSender
    principalId: relayIdentity.properties.principalId
    principalType: 'ServicePrincipal'
  }
}

// The worker's consumers receive (and complete, abandon, dead-letter) with the app identity. Receive only: the web app
// shares this identity, and a sender could forge an envelope for any workspace past the outbox. Scheduling (AIV-P1-040)
// adds its send role, preferably on a worker-only identity.
var dataReceiver = subscriptionResourceId(
  'Microsoft.Authorization/roleDefinitions',
  '4f6d3b9b-027b-4f4c-9142-0e5a2a2247e0'
)

resource appReceives 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(namespace.id, appIdentityPrincipalId, dataReceiver)
  scope: namespace
  properties: { roleDefinitionId: dataReceiver, principalId: appIdentityPrincipalId, principalType: 'ServicePrincipal' }
}

output relayIdentityId string = relayIdentity.id
output namespaceId string = namespace.id
output relayIdentityClientId string = relayIdentity.properties.clientId
output serviceBusNamespace string = '${namespace.name}.servicebus.windows.net'
