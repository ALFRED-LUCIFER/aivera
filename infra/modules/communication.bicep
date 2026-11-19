// AIV-P0-017: email through Azure Communication Services, sent by the worker with the app identity, and delivery
// reports back to the web app through Event Grid (ADR-008: synthetic data only in dev).
// shortcut: the Azure-managed sender domain (DoNotReply@<guid>.azurecomm.net, low send limits) in dev; a verified
// custom domain comes with the pilot (AIV-P0-003 runbook follow-up, AIV-P5-E03 #34)
param tags object
param appIdentityPrincipalId string
@description('The web app FQDN that receives delivery reports (POST /api/webhooks/acs-email).')
param webFqdn string
@secure()
@description('Key Vault secret acs-webhook-key: the webhook URL key Event Grid sends (apps/web/src/app/api/webhooks/acs-email).')
param webhookKey string

// Email data stays in the UAE, as the pilot's will (AGENTS.md 1.10); ACS resources are global with a data location.
var dataLocation = 'UAE'

resource emailService 'Microsoft.Communication/emailServices@2023-04-01' = {
  name: 'acs-email-aivera-dev'
  location: 'global'
  tags: tags
  properties: { dataLocation: dataLocation }
}

resource domain 'Microsoft.Communication/emailServices/domains@2023-04-01' = {
  parent: emailService
  name: 'AzureManagedDomain'
  location: 'global'
  tags: tags
  properties: {
    domainManagement: 'AzureManaged'
    // No open or click tracking: candidates are not profiled (AGENTS.md 1.2).
    userEngagementTracking: 'Disabled'
  }
}

resource acs 'Microsoft.Communication/communicationServices@2023-04-01' = {
  name: 'acs-aivera-dev'
  location: 'global'
  tags: tags
  properties: {
    dataLocation: dataLocation
    linkedDomains: [domain.id]
  }
}

// "Communication and Email Service Owner": send email with an Entra token. Scoped to this one resource.
var emailSender = subscriptionResourceId('Microsoft.Authorization/roleDefinitions', '09976791-48a7-449e-bb21-39d1a415f350')

resource appSends 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(acs.id, appIdentityPrincipalId, emailSender)
  scope: acs
  properties: { roleDefinitionId: emailSender, principalId: appIdentityPrincipalId, principalType: 'ServicePrincipal' }
}

resource events 'Microsoft.EventGrid/systemTopics@2024-06-01-preview' = {
  name: 'evgt-aivera-acs-dev'
  location: 'global'
  tags: tags
  properties: {
    source: acs.id
    topicType: 'Microsoft.Communication.CommunicationServices'
  }
}

// Creating it runs Event Grid's handshake against the web app, so the deployed web image must have the route.
resource deliveryReports 'Microsoft.EventGrid/systemTopics/eventSubscriptions@2024-06-01-preview' = {
  parent: events
  name: 'email-delivery-reports'
  properties: {
    destination: {
      endpointType: 'WebHook'
      // The only secret part is webhookKey (@secure); the host is the web app's public name. Event Grid stores the URL
      // write-only.
      #disable-next-line use-secure-value-for-secure-inputs
      properties: { endpointUrl: 'https://${webFqdn}/api/webhooks/acs-email?key=${webhookKey}' }
    }
    filter: { includedEventTypes: ['Microsoft.Communication.EmailDeliveryReportReceived'] }
    eventDeliverySchema: 'EventGridSchema'
    retryPolicy: { maxDeliveryAttempts: 30, eventTimeToLiveInMinutes: 1440 }
  }
}

output endpoint string = 'https://${acs.properties.hostName}'
output senderAddress string = 'DoNotReply@${domain.properties.mailFromSenderDomain}'
