// AIV-P0-014: Service Bus for the transactional outbox, and the relay's own identity (ADR-008: synthetic data only).
// shortcut: Basic tier (pay per operation, no base fee) has no duplicate detection; a resend after a relay crash
// (between send and commit) is dropped by the consumer's inbox on the message id (AIV-P0-015). Move to Standard and set
// requiresDuplicateDetection on each queue for the pilot (AIV-P5-E03, #34), or earlier if a consumer needs topics.
param location string
param tags object

// The outbox relay signs in to PostgreSQL as aivera_relay (infra/sql/bootstrap-roles.sql) and sends to Service Bus.
// Its own identity: aivera_relay reads every workspace's outbox, which neither the web app nor the consumers may.
resource relayIdentity 'Microsoft.ManagedIdentity/userAssignedIdentities@2023-01-31' = {
  name: 'id-aivera-relay-dev'
  location: location
  tags: tags
}

resource namespace 'Microsoft.ServiceBus/namespaces@2024-01-01' = {
  name: 'sb-aivera-dev-${take(uniqueString(resourceGroup().id), 6)}'
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

// One queue per consuming module; the worker maps each event type to one (apps/worker/src/main.ts).
var queues = ['assessment', 'candidates']

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

output relayIdentityClientId string = relayIdentity.properties.clientId
output serviceBusNamespace string = '${namespace.name}.servicebus.windows.net'
